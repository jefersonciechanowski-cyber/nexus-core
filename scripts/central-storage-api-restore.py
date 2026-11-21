#!/usr/bin/env python3
"""Fail-closed private Supabase Storage API recovery into a *different* project.

Read encrypted bundle only after approved external decryption. This command never
decrypts secrets, never reads the production source, never creates public URLs,
and never changes the Central's original project.

Use:
  CENTRAL_STORAGE_RESTORE_TOKEN=<TARGET_PROJECT_SECRET_KEY> python3 \
    scripts/central-storage-api-restore.py restore \
    --storage-dir /secure/recovered/storage \
    --target-ref <TEMPORARY_PROJECT_REF> \
    --confirm-target <TEMPORARY_PROJECT_REF>

The temporary target must have a PRIVATE bucket 'sst-documents' and RLS already
configured. This script must never be run on a production destination.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sys
from urllib.parse import quote
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError

SOURCE_REF = "svphwbccqeoakpmcpvhy"
BUCKET = "sst-documents"
MAX_FILES = 1000
MAX_BYTES = 256 * 1024 * 1024
MAX_FILE = 64 * 1024 * 1024

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def validate_target(ref, confirmation):
    if not re.fullmatch(r"[a-z0-9]{20}", ref or ""):
        raise ValueError("invalid destination project reference")
    if ref == SOURCE_REF:
        raise ValueError("original Central is forbidden as restore target")
    if ref != confirmation:
        raise ValueError("target project confirmation mismatch")
    return "https://" + ref + ".supabase.co"

def valid_path(name):
    return (isinstance(name, str) and 0 < len(name) <= 800
            and not name.startswith("/") and not name.endswith("/")
            and all(s not in ("", ".", "..") for s in name.split("/"))
            and not any(ord(x) < 32 or ord(x) == 127 or x == "\\" for x in name))

def verified_files(storage_dir):
    base = Path(storage_dir)
    if base.is_symlink() or (base / "manifest.json").is_symlink() or (base / "blobs").is_symlink():
        raise ValueError("symlinks forbidden")
    manifest = json.loads((base / "manifest.json").read_text(encoding="utf-8"))
    if (not isinstance(manifest, dict) or manifest.get("version") != 1
            or manifest.get("bucket") != BUCKET or not isinstance(manifest.get("objects"), list)
            or len(manifest["objects"]) > MAX_FILES):
        raise ValueError("invalid private Storage manifest")
    seen = set()
    records = []
    total = 0
    for entry in manifest["objects"]:
        if not isinstance(entry, dict):
            raise ValueError("malformed manifest object")
        name, digest, size, blob = (entry.get(k) for k in ("name", "sha256", "bytes", "blob"))
        if (not valid_path(name) or name in seen or not isinstance(size, int)
                or isinstance(size, bool) or not 0 <= size <= MAX_FILE or
                not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None):
            raise ValueError("invalid object metadata")
        expected_blob = hashlib.sha256((BUCKET + "\0" + name).encode("utf-8")).hexdigest()
        if blob != expected_blob:
            raise ValueError("invalid opaque storage path")
        path = base / "blobs" / expected_blob
        if path.is_symlink() or not path.is_file() or path.stat().st_size != size:
            raise ValueError("object not available or size mismatch")
        sha = hashlib.sha256()
        with path.open("rb") as f:
            for part in iter(lambda: f.read(65536), b""):
                sha.update(part)
        if sha.hexdigest() != digest:
            raise ValueError("object checksum mismatch")
        total += size
        if total > MAX_BYTES:
            raise ValueError("object count or total exceeds safe limit")
        seen.add(name)
        records.append((name, path, digest, size))
    if set(p.name for p in (base / "blobs").iterdir()) != {
        hashlib.sha256((BUCKET + "\0" + n).encode("utf-8")).hexdigest()
        for n in seen
    }:
        raise ValueError("unexpected files in Storage archive")
    if total != manifest.get("total_bytes"):
        raise ValueError("manifest aggregate byte mismatch")
    return records, total

def _request(url, method, token, body=None, content_type=None):
    headers = {
        "authorization": "Bearer " + token,
        "apikey": token,
        "cache-control": "no-store",
        "x-upsert": "false",
    }
    if content_type:
        headers["content-type"] = content_type
    request = Request(url, headers=headers, method=method, data=body)
    # No redirected authenticated requests, even if the target is compromised.
    with build_opener(NoRedirect).open(request, timeout=45) as response:
        if method == "POST" and response.status not in (200, 201):
            raise ValueError("object upload rejected")
        if method == "GET" and response.status != 200:
            raise ValueError("object read-back rejected")
        return response.read(MAX_FILE + 1)

def _multipart(content):
    boundary = "central-recovery-" + secrets.token_hex(16)
    body = (
        ("--" + boundary + "\r\n"
         + 'Content-Disposition: form-data; name="file"; filename="recovered.bin"\r\n'
         + "Content-Type: application/octet-stream\r\n\r\n").encode()
        + content + ("\r\n--" + boundary + "--\r\n").encode()
    )
    return body, "multipart/form-data; boundary=" + boundary

def restore(records, target_url, token):
    if not token or len(token) < 16:
        raise ValueError("target credential unavailable")
    for name, path, digest, size in records:
        encoded = "/".join(quote(p, safe="") for p in name.split("/"))
        write = target_url + "/storage/v1/object/" + BUCKET + "/" + encoded
        read = target_url + "/storage/v1/object/authenticated/" + BUCKET + "/" + encoded
        data = path.read_bytes()
        if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
            raise ValueError("object modified after validation")
        body, content_type = _multipart(data)
        _request(write, "POST", token, body=body, content_type=content_type)
        received = _request(read, "GET", token)
        if len(received) != size or hashlib.sha256(received).hexdigest() != digest:
            raise ValueError("destination file hash mismatch")
    print("PASS: isolated destination Storage API upload and read-back checks")
    print("objects_verified=" + str(len(records)))

def main():
    parser = argparse.ArgumentParser(description="Restore private Storage only to an explicitly approved temporary Supabase project")
    parser.add_argument("command", choices=["validate", "restore"])
    parser.add_argument("--storage-dir", required=True)
    parser.add_argument("--target-ref")
    parser.add_argument("--confirm-target")
    args = parser.parse_args()
    try:
        records, total = verified_files(args.storage_dir)
        print("PASS: private backup manifest and file digests validated")
        print("objects=" + str(len(records)))
        print("bytes=" + str(total))
        if args.command == "validate":
            return
        target = validate_target(args.target_ref, args.confirm_target)
        token = os.environ.get("CENTRAL_STORAGE_RESTORE_TOKEN", "")
        restore(records, target, token)
    except (ValueError, OSError, HTTPError, URLError, TypeError, json.JSONDecodeError):
        # Never print response bodies, names, tokens, paths or original URL.
        print("FAIL: isolated Storage recovery rejected; details suppressed")
        raise SystemExit(1)

if __name__ == "__main__":
    main()
