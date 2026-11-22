#!/usr/bin/env python3
"""Read back an encrypted-source Storage archive into a REAL local Supabase API.

Privileged, MAIN-only GitHub Actions workflow is responsible for decrypting the
already stored backup. This script neither reads production nor any cloud host.
Only an isolated local loopback Supabase instance is a permitted destination.
No archive data, paths, tokens or identifiers are logged.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "central_storage_restore", ROOT / "scripts/central-storage-api-restore.py"
)
dr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dr)


def local_config():
    if os.environ.get("CENTRAL_DR_REAL_LOCAL_ONLY") != "1":
        raise ValueError("real local gate not approved")
    if os.environ.get("CENTRAL_SOURCE_DATABASE_URL") or os.environ.get("CENTRAL_STORAGE_RESTORE_TOKEN"):
        raise ValueError("production or hosted secret is forbidden")
    workdir = Path(os.environ["CENTRAL_DR_LOCAL_WORKDIR"])
    if not (workdir / "supabase" / "config.toml").is_file():
        raise ValueError("local-only Supabase config unavailable")
    raw = subprocess.check_output(
        ["supabase", "status", "--output", "json"],
        cwd=str(workdir), stderr=subprocess.DEVNULL, text=True, timeout=45
    )
    data = json.loads(raw)
    url = data.get("API_URL") or data.get("api_url")
    service = data.get("SERVICE_ROLE_KEY") or data.get("service_role_key")
    anon = data.get("ANON_KEY") or data.get("anon_key")
    if not all(isinstance(v, str) and len(v) > 5 for v in (url, service, anon)):
        raise ValueError("local instance incomplete")
    parsed = urlparse(url)
    if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost")
            or not parsed.port or parsed.username or parsed.password
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        raise ValueError("network target is not local")
    return url.rstrip("/"), service, anon


def req(url, token=None, method="GET", data=None):
    h = {"cache-control": "no-store"}
    if token:
        h.update({"authorization": "Bearer " + token, "apikey": token})
    if data is not None:
        h["content-type"] = "application/json"
    with urlopen(Request(url, headers=h, data=data, method=method), timeout=30) as resp:
        return resp.status, resp.read(65536)


def unauthorized(url, token=None):
    try:
        req(url, token)
    except HTTPError as e:
        if e.code in (400, 401, 403, 404):
            return
        raise AssertionError("unexpected private object response") from None
    raise AssertionError("unauthorized private object download succeeded")


def main():
    url, service, anon = local_config()
    root = Path(os.environ["CENTRAL_DR_RECOVERED_STORAGE_DIR"])
    started = time.monotonic()
    records, total = dr.verified_files(root)
    if not records or not total:
        raise ValueError("recovered archive contains no private objects")

    bucket = b'{"id":"sst-documents","name":"sst-documents","public":false}'
    status, _ = req(url + "/storage/v1/bucket", service, "POST", bucket)
    if status not in (200, 201):
        raise ValueError("failed to create local private bucket")

    # Exercise the SAME verified upload/readback implementation used for the
    # hosted restore script, but ONLY after validating the target is loopback.
    dr.restore(records, url, service)
    for name, path, digest, size in records:
        safe_name = "/".join(quote(seg, safe="") for seg in name.split("/"))
        address = url + "/storage/v1/object/authenticated/sst-documents/" + safe_name
        unauthorized(address)
        unauthorized(address, anon)
        # dr.restore already authenticated-readbacks every object byte by byte.
    print("PASS: stored Central private files reimported through REAL local Storage API")
    print("objects_verified=" + str(len(records)))
    print("bytes_verified=" + str(total))
    print("unauthorized_object_access=denied")
    print("local_storage_lab_seconds=" + str(round(time.monotonic() - started, 1)))
    print("scope=local-only; no hosted restoration or full-service RTO/RPO certification")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, AssertionError, OSError, HTTPError, KeyError, TypeError,
            subprocess.CalledProcessError, subprocess.TimeoutExpired, json.JSONDecodeError):
        print("FAIL: local encrypted backup Storage API rehearsal rejected (details suppressed)")
        sys.exit(1)
