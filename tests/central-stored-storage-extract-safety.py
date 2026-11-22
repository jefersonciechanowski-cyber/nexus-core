#!/usr/bin/env python3
"""Synthetic-only security tests for recovery archive strict extraction."""
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

P = Path(__file__).resolve().parents[1] / "scripts" / "central-stored-storage-extract.py"
sp = importlib.util.spec_from_file_location("safe_archive", P)
mod = importlib.util.module_from_spec(sp)
sp.loader.exec_module(mod)

BLOB = "a" * 64
BASE = {
    "central.dump": b"PGDMP",
    "sequence-acl.sql": b"-- test",
    "source-integrity.csv": b"synthetic",
    "security-digest.txt": b"f" * 32,
    "captured-utc.txt": b"2026-11-21T00:00:00Z",
    "source-storage-inventory.json": b"{}",
    "storage/blobs/" + BLOB: b"FICTITIOUS ONLY",
}
MANIFEST = {"version": 1, "bucket": "sst-documents",
            "objects": [{"blob": BLOB}]}

def fixture(path, extra=None, manifest=None, symlink=None):
    entries = dict(BASE)
    entries["storage/manifest.json"] = json.dumps(
        MANIFEST if manifest is None else manifest).encode()
    entries.update(extra or {})
    with tarfile.open(path, "w:gz") as tf:
        for name, data in entries.items():
            record = tarfile.TarInfo(name)
            record.size = len(data)
            tf.addfile(record, io.BytesIO(data))
        if symlink is not None:
            entry = tarfile.TarInfo(symlink)
            entry.type = tarfile.SYMTYPE
            entry.linkname = "storage/manifest.json"
            tf.addfile(entry)

class EncryptedStoredArchiveSafetyTests(unittest.TestCase):
    def test_accepts_only_approved_private_members(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / "fixture.tar.gz"
            out = Path(temp) / "recovered"
            fixture(archive)
            mod.extract(archive, out)
            self.assertEqual((out / "blobs" / BLOB).read_bytes(), b"FICTITIOUS ONLY")
            self.assertEqual(json.loads((out / "manifest.json").read_text())["bucket"],
                             "sst-documents")
            self.assertFalse((out / "central.dump").exists())

    def test_refuses_unexpected_member_and_path_traversal(self):
        for name in ("../../unexpected", "storage/blobs/extra.txt", ".secret"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                archive = Path(temp) / "fixture.tar.gz"
                fixture(archive, extra={name: b"do not write"})
                with self.assertRaises(ValueError):
                    mod.extract(archive, Path(temp) / "recovered")

    def test_refuses_symlink_and_public_or_invalid_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / "fixture.tar.gz"
            fixture(archive, symlink="storage/malicious")
            with self.assertRaises(ValueError):
                mod.extract(archive, Path(temp) / "recovered")
        for mf in ({"version": 1, "bucket": "public-bucket", "objects": [{"blob": BLOB}]},
                   {"version": 1, "bucket": "sst-documents", "objects": []},
                   {"version": 1, "bucket": "sst-documents", "objects": [{"blob": "../x"}]}):
            with tempfile.TemporaryDirectory() as temp:
                archive = Path(temp) / "fixture.tar.gz"
                fixture(archive, manifest=mf)
                with self.assertRaises(ValueError):
                    mod.extract(archive, Path(temp) / "recovered")

if __name__ == "__main__":
    unittest.main()
