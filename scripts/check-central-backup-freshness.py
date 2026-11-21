#!/usr/bin/env python3
"""Fails closed when Central GitHub backup or independent recovery is stale.

Only public GitHub Actions metadata is parsed. No database, secrets, object names
or customer data are used. Designed for daily scheduled runs.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

MAX_AGE_HOURS = 27

def when(value):
    if not isinstance(value, str):
        raise ValueError("timestamp absent")
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)

def verified_run(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("workflow_runs"), list):
        raise ValueError("workflow run list missing")
    for item in data["workflow_runs"]:
        if (item.get("status") == "completed"
                and item.get("conclusion") == "success"
                and item.get("head_branch") == "main"):
            return item
    raise ValueError("no successful run on main")

def main():
    if len(sys.argv) not in (4, 5):
        raise SystemExit("usage: check-central-backup-freshness.py backups.json restores.json artifacts.json [now_utc]")
    try:
        now = when(sys.argv[4]) if len(sys.argv) == 5 else datetime.now(timezone.utc)
        backup = verified_run(sys.argv[1])
        restore = verified_run(sys.argv[2])
        backup_time = when(backup.get("updated_at"))
        restore_time = when(restore.get("updated_at"))
        if backup_time > now or restore_time > now:
            raise ValueError("future time in GitHub run")
        backup_age = (now - backup_time).total_seconds() / 3600
        restore_age = (now - restore_time).total_seconds() / 3600
        if backup_age > MAX_AGE_HOURS:
            raise ValueError("backup too old")
        if restore_age > MAX_AGE_HOURS:
            raise ValueError("independent restore too old")
        if restore_time < backup_time:
            raise ValueError("independent restore precedes latest backup")
        data = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
        candidates = data.get("artifacts", [])
        expected = "central-validated-encrypted-backup-" + str(backup.get("id"))
        if not any(a.get("name") == expected and a.get("expired") is False
                   and a.get("size_in_bytes", 0) > 0 for a in candidates):
            raise ValueError("no current unexpired encrypted artifact")
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        print("FAIL: Central backup freshness or cold-recovery evidence missing, stale or inconsistent")
        raise SystemExit(1)
    print("PASS: Central backup, ciphertext artifact and independent recovery are recent")
    print("backup_age_hours=" + str(round(backup_age, 2)))
    print("independent_restore_age_hours=" + str(round(restore_age, 2)))
    print("freshness_limit_hours=" + str(MAX_AGE_HOURS))

if __name__ == "__main__":
    main()
