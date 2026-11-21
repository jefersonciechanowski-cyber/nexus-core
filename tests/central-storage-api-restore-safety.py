#!/usr/bin/env python3
"""Synthetic-only assertions for protected Storage reimport; no external calls."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "central-storage-api-restore.py"
spec = importlib.util.spec_from_file_location("central_storage_api_restore", SCRIPT)
dr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dr)

DATA = b"private fictional test file: alpha-beta-gamma"

def fixture(root):
    base = Path(root) / "storage"
    (base / "blobs").mkdir(parents=True)
    name = "test/fictional client document.bin"
    blob = hashlib.sha256(("sst-documents\0" + name).encode()).hexdigest()
    digest = hashlib.sha256(DATA).hexdigest()
    (base / "blobs" / blob).write_bytes(DATA)
    (base / "manifest.json").write_text(json.dumps({
        "version": 1, "bucket": "sst-documents", "total_bytes": len(DATA),
        "objects": [{"name": name, "bytes": len(DATA), "blob": blob,
                     "sha256": digest, "updated_at": "2026-11-21T00:00:00Z"}]
    }))
    return base

class StorageRestoreSafetyTests(unittest.TestCase):
    def test_reject_production_target_or_mismatch(self):
        for production_ref in ("svphwbccqeoakpmcpvhy", "hpnblrmejcddaturaeno", "ngxqtztfotkpdvynstae"):
            with self.assertRaises(ValueError):
                dr.validate_target(production_ref, production_ref)
        with self.assertRaises(ValueError):
            dr.validate_target("abcdefghijklmnopqrst", "different-reference")
        self.assertEqual(dr.validate_target("abcdefghijklmnopqrst", "abcdefghijklmnopqrst"),
                         "https://abcdefghijklmnopqrst.supabase.co")

    def test_rejects_corrupted_private_file_before_any_upload(self):
        with tempfile.TemporaryDirectory() as temp:
            base = fixture(temp)
            path = next((base / "blobs").iterdir())
            path.write_bytes(b"x" * len(DATA))
            with self.assertRaises(ValueError):
                dr.verified_files(base)

    def test_rejects_path_traversal_and_extra_files(self):
        with tempfile.TemporaryDirectory() as temp:
            base = fixture(temp)
            metadata = json.loads((base / "manifest.json").read_text())
            metadata["objects"][0]["name"] = "../sensitive"
            (base / "manifest.json").write_text(json.dumps(metadata))
            with self.assertRaises(ValueError):
                dr.verified_files(base)
        with tempfile.TemporaryDirectory() as temp:
            base = fixture(temp)
            (base / "blobs" / "unrecognized").write_bytes(b"unauthorized")
            with self.assertRaises(ValueError):
                dr.verified_files(base)

    def test_upload_readback_matches_and_request_targets_are_scoped(self):
        with tempfile.TemporaryDirectory() as temp:
            base = fixture(temp)
            records, total = dr.verified_files(base)
            self.assertEqual(total, len(DATA))
            calls = []
            def fake_request(url, method, token, body=None, content_type=None):
                calls.append((url, method, content_type))
                self.assertTrue(url.startswith("https://abcdefghijklmnopqrst.supabase.co/storage/v1/"))
                self.assertEqual(token, "test_credential_1234567890")
                if url.endswith("/storage/v1/bucket/sst-documents"):
                    self.assertEqual(method, "GET")
                    return b'{"id":"sst-documents","public":false}'
                if method == "POST":
                    self.assertIn(b"Content-Disposition: form-data", body)
                    self.assertIn(DATA, body)
                    self.assertEqual(url.count("/authenticated/"), 0)
                    return b'{"Key":"test"}'
                self.assertIn("/authenticated/", url)
                return DATA
            with patch.object(dr, "_request", fake_request):
                dr.restore(records, dr.validate_target("abcdefghijklmnopqrst","abcdefghijklmnopqrst"), "test_credential_1234567890")
            self.assertEqual([x[1] for x in calls], ["GET", "POST", "GET"])

    def test_readback_hash_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            base = fixture(temp)
            records, _ = dr.verified_files(base)
            def fake_request(url, method, token, body=None, content_type=None):
                if url.endswith("/storage/v1/bucket/sst-documents"):
                    return b'{"id":"sst-documents","public":false}'
                return b'{"Key":"test"}' if method == "POST" else b"x" * len(DATA)
            with patch.object(dr, "_request", fake_request):
                with self.assertRaises(ValueError):
                    dr.restore(records, "https://abcdefghijklmnopqrst.supabase.co", "test_credential_1234567890")

    def test_public_bucket_is_rejected_before_any_object_upload(self):
        with tempfile.TemporaryDirectory() as temp:
            base = fixture(temp)
            records, _ = dr.verified_files(base)
            calls = []
            def fake_request(url, method, token, body=None, content_type=None):
                calls.append((url, method))
                return b'{"id":"sst-documents","public":true}'
            with patch.object(dr, "_request", fake_request):
                with self.assertRaises(ValueError):
                    dr.restore(records, "https://abcdefghijklmnopqrst.supabase.co", "test_credential_1234567890")
            self.assertEqual(len(calls), 1, "must refuse PUBLIC bucket before uploading any file")

if __name__ == "__main__":
    unittest.main()
