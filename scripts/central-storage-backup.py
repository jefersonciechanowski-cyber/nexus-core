#!/usr/bin/env python3
"""Encrypted Central backup: export/verify *bytes* of private Supabase Storage.

Usage:
  export <source-inventory.json> <storage-dir>
  verify <source-inventory.json> <restored-inventory.json> <storage-dir>
Never prints file names, customer identifiers, tokens or downloaded bytes.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.parse
import urllib.request

BUCKET = "sst-documents"
FUNCTION = "https://svphwbccqeoakpmcpvhy.supabase.co/functions/v1/nexus-central-storage-backup"
MAX_FILES = 1000
MAX_BYTES = 256 * 1024 * 1024
MAX_FILE = 64 * 1024 * 1024

def valid_path(value):
    return isinstance(value, str) and 0 < len(value) <= 800 and all(
        s not in ("", ".", "..") for s in value.split("/")
    ) and not any(ord(c) < 32 or ord(c) == 127 or c == "\\" for c in value)

def load_inventory(file):
    data = json.loads(Path(file).read_text(encoding="utf-8").strip())
    if not isinstance(data, dict) or data.get("version") != 1 or data.get("bucket") != BUCKET or (
        data.get("bucket_present") != 1 or data.get("total_buckets") != 1
        or data.get("bucket_private") is not True
    ):
        raise ValueError("unexpected Storage bucket inventory")
    objects = data.get("objects")
    if not isinstance(objects, list) or len(objects) > MAX_FILES:
        raise ValueError("invalid object inventory")
    seen, total = set(), 0
    for entry in objects:
        if not isinstance(entry, dict) or not valid_path(entry.get("name")) or (
            not isinstance(entry.get("bytes"), int) or isinstance(entry.get("bytes"), bool)
            or entry["bytes"] < 0 or entry["bytes"] > MAX_FILE
            or not isinstance(entry.get("updated_at"), str)
        ):
            raise ValueError("invalid inventory entry")
        if entry["name"] in seen:
            raise ValueError("duplicate Storage metadata entry")
        seen.add(entry["name"])
        total += entry["bytes"]
    if total > MAX_BYTES:
        raise ValueError("Storage backup exceeds safety threshold")
    return objects, total

def oidc_token():
    request_url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", "")
    secret = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
    if not request_url.startswith("https://") or not secret:
        raise ValueError("GitHub OIDC environment unavailable")
    sep = "&" if "?" in request_url else "?"
    url = request_url + sep + urllib.parse.urlencode({"audience": FUNCTION})
    req = urllib.request.Request(url, headers={"Authorization": "bearer " + secret, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=12) as response:
        token = json.loads(response.read(20000)).get("value")
    if not isinstance(token, str) or len(token) > 12000 or token.count(".") != 2:
        raise ValueError("OIDC provider did not return a JWT")
    return token

def blob_key(name):
    return hashlib.sha256((BUCKET + "\\0" + name).encode("utf-8")).hexdigest()

def export(inventory, folder):
    objects, total = load_inventory(inventory)
    base = Path(folder)
    blobs = base / "blobs"
    blobs.mkdir(parents=True, exist_ok=False)
    manifest = {"version": 1, "bucket": BUCKET, "total_bytes": total, "objects": []}
    for meta in objects:
        name = meta["name"]
        key = blob_key(name)
        target = blobs / key
        body = json.dumps({"bucket": BUCKET, "name": name}).encode("utf-8")
        request = urllib.request.Request(FUNCTION, method="POST", data=body, headers={
            "Authorization": "Bearer " + oidc_token(),
            "Content-Type": "application/json", "Accept": "application/octet-stream"
        })
        with urllib.request.urlopen(request, timeout=45) as response:
            if response.status != 200:
                raise ValueError("Storage download rejected")
            size, digest = 0, hashlib.sha256()
            with target.open("xb") as stream:
                while True:
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_FILE or size > meta["bytes"]:
                        raise ValueError("Storage bytes exceed metadata")
                    stream.write(chunk)
                    digest.update(chunk)
        if size != meta["bytes"]:
            raise ValueError("Storage size changed during backup")
        manifest["objects"].append({
            "name": name,
            "bytes": size,
            "updated_at": meta["updated_at"],
            "blob": key,
            "sha256": digest.hexdigest()
        })
    (base / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    print("PASS: private Storage object bytes downloaded and hashed without public links")
    print("storage_objects=" + str(len(objects)))
    print("storage_total_bytes=" + str(total))

def verify(source_inventory, restored_inventory, folder):
    original, original_bytes = load_inventory(source_inventory)
    restored, restored_bytes = load_inventory(restored_inventory)
    if original != restored or original_bytes != restored_bytes:
        raise ValueError("Storage metadata differs in restored PostgreSQL")
    base = Path(folder)
    data = json.loads((base / "manifest.json").read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("version") != 1 or data.get("bucket") != BUCKET or (
        data.get("total_bytes") != original_bytes or not isinstance(data.get("objects"), list)
        or len(data["objects"]) != len(original)
    ):
        raise ValueError("invalid stored Storage manifest")
    expected_blobs = set()
    for metadata, entry in zip(original, data["objects"]):
        if not isinstance(entry, dict) or any(entry.get(k) != metadata.get(k) for k in ("name", "bytes", "updated_at")):
            raise ValueError("stored private file metadata mismatch")
        digest = entry.get("sha256")
        key = blob_key(metadata["name"])
        if entry.get("blob") != key or not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("stored private file checksum invalid")
        target = base / "blobs" / key
        if not target.is_file() or target.is_symlink() or target.stat().st_size != metadata["bytes"]:
            raise ValueError("stored private file missing or truncated")
        hasher = hashlib.sha256()
        with target.open("rb") as stream:
            for chunk in iter(lambda: stream.read(65536), b""):
                hasher.update(chunk)
        if hasher.hexdigest() != digest:
            raise ValueError("stored private file corrupted")
        expected_blobs.add(key)
    actual = {p.name for p in (base / "blobs").iterdir()} if (base / "blobs").is_dir() else set()
    if actual != expected_blobs:
        raise ValueError("unexpected private backup files")
    print("PASS: independently recovered private Storage bytes and restored metadata match")
    print("storage_verified_objects=" + str(len(original)))
    print("storage_verified_bytes=" + str(original_bytes))

def main():
    try:
        if len(sys.argv) == 4 and sys.argv[1] == "export":
            export(sys.argv[2], sys.argv[3])
        elif len(sys.argv) == 5 and sys.argv[1] == "verify":
            verify(sys.argv[2], sys.argv[3], sys.argv[4])
        else:
            raise ValueError("invalid command")
    except Exception:
        # Never include filenames, HTTP bodies, paths, tokens or object contents in logs.
        print("FAIL: private Storage backup or validation failed; details suppressed")
        raise SystemExit(1)

if __name__ == "__main__":
    main()
