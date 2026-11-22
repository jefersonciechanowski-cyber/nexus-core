#!/usr/bin/env python3
"""Extract only strictly validated private Storage members of encrypted DR tar.

Input is an already decrypted archive in a protected ephemeral runner directory.
Never print archive names, private object paths or restored bytes.
"""
from pathlib import Path
import json
import re
import sys
import tarfile

FIXED = {
    "central.dump", "sequence-acl.sql", "source-integrity.csv",
    "security-digest.txt", "captured-utc.txt",
    "source-storage-inventory.json", "storage/manifest.json",
}

def extract(archive, destination):
    with tarfile.open(archive, "r:gz") as tar:
        members = tar.getmembers()
        names = [m.name for m in members]
        if len(names) > 1010 or len(names) != len(set(names)):
            raise ValueError("invalid count or duplicated archive member")
        entries = {m.name: m for m in members}
        mf = entries.get("storage/manifest.json")
        if not mf or not mf.isfile() or mf.size > 1024 * 1024:
            raise ValueError("missing or invalid manifest")
        manifest = json.loads(tar.extractfile(mf).read())
        objects = manifest.get("objects")
        if (manifest.get("version") != 1 or manifest.get("bucket") != "sst-documents"
                or not isinstance(objects, list) or not 0 < len(objects) <= 1000):
            raise ValueError("invalid object manifest")
        blobs = set()
        for obj in objects:
            if not isinstance(obj, dict) or not isinstance(obj.get("blob"), str):
                raise ValueError("invalid object metadata")
            member = "storage/blobs/" + obj["blob"]
            if not re.fullmatch(r"storage/blobs/[0-9a-f]{64}", member) or member in blobs:
                raise ValueError("invalid or duplicate opaque object name")
            blobs.add(member)
        file_members = {m.name for m in members if m.isfile()}
        directory_members = {m.name for m in members if m.isdir()}
        if (file_members != FIXED | blobs
                or not directory_members.issubset({"storage", "storage/blobs"})
                or any(not (m.isfile() or m.isdir()) for m in members)
                or sum(m.size for m in members) > 300 * 1024 * 1024):
            raise ValueError("unexpected archive member or excessive data")
        for member_name in sorted(blobs | {"storage/manifest.json"}):
            m = entries[member_name]
            if not m.isfile() or m.size > 64 * 1024 * 1024:
                raise ValueError("invalid object size")
            out = destination / member_name.removeprefix("storage/")
            out.parent.mkdir(parents=True, exist_ok=True)
            source = tar.extractfile(m)
            if source is None:
                raise ValueError("missing object stream")
            with out.open("xb") as dest:
                remaining = m.size
                while remaining > 0:
                    part = source.read(min(65536, remaining))
                    if not part:
                        raise ValueError("truncated private object")
                    dest.write(part)
                    remaining -= len(part)

if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("invalid arguments")
        extract(Path(sys.argv[1]), Path(sys.argv[2]))
        print("PASS: stored encrypted archive members strictly validated and Storage objects extracted")
    except (ValueError, TypeError, KeyError, OSError, tarfile.TarError,
            json.JSONDecodeError, AttributeError):
        print("FAIL: invalid DR archive (details suppressed)")
        sys.exit(1)
