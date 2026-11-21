#!/usr/bin/env python3
"""Only report allowlisted operational metric categories, NEVER values/records."""
import sys
from pathlib import Path

SAFE_COUNTS = {"organizations", "profiles", "memberships", "accounts",
               "account_organizations", "account_users", "product_access",
               "payment_checkouts", "payments"}
SAFE_LINKS = {"profiles_org_missing", "membership_org_missing",
              "account_org_link_missing", "account_user_link_missing",
              "product_org_missing", "access_ref_missing"}
SAFE_KINDS = {"count", "link_integrity", "state"}

def parse(path):
    metrics = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        kind, sep, remaining = line.partition("|")
        metric, delim, raw_count = remaining.rpartition("|")
        if not sep or not delim or kind not in SAFE_KINDS:
            raise ValueError("Malformed metric type")
        count = int(raw_count)
        if count < 0 or (kind, metric) in metrics:
            raise ValueError("Invalid metric count")
        metrics[(kind, metric)] = count
    if not metrics:
        raise ValueError("No metrics")
    return metrics

def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: central-integrity-safe-diagnostics.py source.csv target.csv")
    try:
        source, target = parse(sys.argv[1]), parse(sys.argv[2])
    except (OSError, ValueError, TypeError):
        print("integrity_mismatch_diagnostic=unavailable")
        return
    keys = set(source) | set(target)
    changed = {key for key in keys if source.get(key) != target.get(key)}
    groups = sorted({key[0] for key in changed})
    print("integrity_mismatch_groups=" + (",".join(groups) if groups else "none"))
    print("integrity_mismatched_metric_count=" + str(len(changed)))
    print("integrity_changed_count_metrics=" + (",".join(sorted({
        metric for kind, metric in changed if kind == "count" and metric in SAFE_COUNTS
    })) or "none"))
    print("integrity_changed_link_metrics=" + (",".join(sorted({
        metric for kind, metric in changed if kind == "link_integrity" and metric in SAFE_LINKS
    })) or "none"))
    print("integrity_changed_state_metric_count=" +
          str(sum(1 for kind, _ in changed if kind == "state")))

if __name__ == "__main__":
    main()
