#!/usr/bin/env python3
"""Classify pg_restore failures without printing SQL, identifiers or customer data."""
import re
import sys
from pathlib import Path

RULES = [
    ("extension_unavailable", r"could not open extension control file|extension .* does not exist|extension .* is not available"),
    ("missing_database_role", r"role .* does not exist|must be member of role|permission denied to set role"),
    ("missing_schema", r"schema .* does not exist|no schema has been selected"),
    ("missing_function", r"function .* does not exist|procedure .* does not exist"),
    ("missing_type_or_operator", r"type .* does not exist|operator .* does not exist"),
    ("missing_relation", r"relation .* does not exist|table .* does not exist"),
    ("duplicate_object", r"already exists|duplicate key value"),
    ("insufficient_privileges", r"permission denied|must be owner|not owner of"),
    ("unsupported_sql_or_setting", r"unrecognized configuration parameter|syntax error|feature not supported"),
    ("dependency_order_or_data", r"violates foreign key constraint|depends on|not-null constraint|invalid input syntax"),
    ("connection_or_network", r"connection refused|could not connect|connection timed out|no pg_hba.conf entry"),
]

def classify(log):
    # Use only ERROR lines. Never emit full lines, object names or raw SQL.
    lines = [s.lower() for s in log.splitlines()
             if "error:" in s.lower() or "fatal:" in s.lower()]
    joined = "\n".join(lines)
    for label, pattern in RULES:
        if re.search(pattern, joined):
            return label
    return "unknown_restore_error"

def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: classify-central-restore-error.py <local-restore-log>")
    try:
        raw = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
    except OSError:
        print("restore_failure_class=log_unavailable")
        return
    category = classify(raw)
    print("restore_failure_class=" + category)
    if category == "missing_schema":
        # Names are strictly allowlisted platform schema identifiers.
        # Never echo arbitrary schema names, log excerpts or SQL.
        known_schemas = {"vault", "extensions", "net", "cron", "auth",
                         "storage", "public", "graphql", "realtime",
                         "pgsodium", "pgmq", "supabase_functions"}
        match = re.search(r'ERROR:\\s+schema\\s+["\\x27]?([A-Za-z_][A-Za-z_0-9]*)["\\x27]?\\s+does not exist', raw, re.I)
        found = (match.group(1).lower() if match else "")
        print("restore_missing_schema_category=" + (
            found if found in known_schemas else "other_or_unspecified"
        ))

if __name__ == "__main__":
    main()
