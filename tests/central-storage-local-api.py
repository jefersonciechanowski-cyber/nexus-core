#!/usr/bin/env python3
"""Exercise real local Supabase Storage HTTP API with *only synthetic* files.

No project tokens, no client backup, and no external Supabase endpoints.
This uses the existing protected restore() function, without weakening the
production-only validate_target() command path.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "central_storage_restore", ROOT / "scripts" / "central-storage-api-restore.py"
)
restore_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore_module)

def local_stack():
    if os.environ.get("CENTRAL_DR_LOCAL_ONLY") != "1":
        raise ValueError("local-only integration gate not enabled")
    workdir = os.environ.get("CENTRAL_DR_LOCAL_WORKDIR")
    if not workdir or not (Path(workdir) / "supabase" / "config.toml").is_file():
        raise ValueError("missing isolated local Supabase stack")
    raw = subprocess.check_output(
        ["supabase", "status", "--output", "json"],
        cwd=workdir, stderr=subprocess.DEVNULL, text=True, timeout=45
    )
    config = json.loads(raw)
    api_url = config.get("API_URL") or config.get("api_url")
    secret = config.get("SERVICE_ROLE_KEY") or config.get("service_role_key")
    anon = config.get("ANON_KEY") or config.get("anon_key")
    if not all(isinstance(v, str) and v for v in (api_url, secret, anon)):
        raise ValueError("local API credentials unavailable")
    u = urlparse(api_url)
    if u.scheme != "http" or u.hostname not in ("localhost", "127.0.0.1") or not u.port:
        raise ValueError("never send test credentials to non-loopback API")
    if len(secret) < 16:
        raise ValueError("unexpected local credential")
    return api_url.rstrip("/"), secret, anon

def call(url, method="GET", token=None, body=None, content_type=None):
    headers = {"cache-control": "no-store"}
    if token:
        headers.update({"Authorization": "Bearer " + token, "apikey": token})
    if content_type:
        headers["Content-Type"] = content_type
    req = Request(url, method=method, data=body, headers=headers)
    with urlopen(req, timeout=30) as response:
        return response.status, response.read()

def fake_archive(root):
    base = root / "storage"
    (base / "blobs").mkdir(parents=True)
    examples = (
        ("test/recovery-first.bin", b"Central DR synthetic alpha" * 3),
        ("test/file with spaces.txt", b"Central DR synthetic beta" * 5),
        ("other/synthetic-third.pdf", b"%PDF-1.4 synthetic only; not a customer document"),
    )
    entries = []
    for name, data in examples:
        blob = hashlib.sha256(("sst-documents\\0" + name).encode()).hexdigest()
        (base / "blobs" / blob).write_bytes(data)
        entries.append({
            "name": name, "blob": blob, "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "updated_at": "2026-11-21T00:00:00Z",
        })
    (base / "manifest.json").write_text(json.dumps({
        "version": 1, "bucket": "sst-documents",
        "total_bytes": sum(e["bytes"] for e in entries), "objects": entries
    }), encoding="utf-8")
    return base, examples

def assert_denied(url, token):
    try:
        status, _ = call(url, token=token)
    except HTTPError as exc:
        if exc.code in (400, 401, 403, 404):
            return
        raise AssertionError("unexpected access-denial response") from None
    raise AssertionError("private file was served to unauthorized caller: " + str(status))

def main():
    api_url, service_key, anon_key = local_stack()
    body = json.dumps({"id": "sst-documents", "name": "sst-documents", "public": False}).encode()
    status, _ = call(api_url + "/storage/v1/bucket", method="POST", token=service_key,
                     body=body, content_type="application/json")
    if status not in (200, 201):
        raise AssertionError("could not create private fixture bucket")
    with tempfile.TemporaryDirectory(prefix="central-storage-api-synthetic-") as temp:
        base, examples = fake_archive(Path(temp))
        records, total = restore_module.verified_files(base)
        if len(records) != 3 or total != sum(len(data) for _, data in examples):
            raise AssertionError("synthetic archive mismatch")
        # This calls the production restore algorithm against localhost ONLY.
        # Its command-line validate_target remains restricted to hosted non-prod refs.
        restore_module.restore(records, api_url, service_key)
        for name, data in examples:
            encoded = "/".join(quote(p, safe="") for p in name.split("/"))
            private_url = api_url + "/storage/v1/object/authenticated/sst-documents/" + encoded
            assert_denied(private_url, None)
            assert_denied(private_url, anon_key)
            status, downloaded = call(private_url, token=service_key)
            if status != 200 or hashlib.sha256(downloaded).digest() != hashlib.sha256(data).digest():
                raise AssertionError("authenticated download integrity failure")
        # No upsert: a second restore MUST reject existing object upload.
        try:
            restore_module.restore(records, api_url, service_key)
        except HTTPError as exc:
            if exc.code not in (400, 409):
                raise AssertionError("duplicate upload failed unexpectedly") from None
        else:
            raise AssertionError("duplicate upload unexpectedly overwrote object")
    print("PASS: real LOCAL Supabase Storage API 3/3 synthetic files")
    print("PASS: service credential readback; anonymous and anon-role access denied")
    print("PASS: no-upsert rejects duplicate upload")
    print("Scope: no production, no customer bytes, no hosted project, no credentials persisted")

if __name__ == "__main__":
    main()
