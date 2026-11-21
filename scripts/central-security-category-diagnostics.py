#!/usr/bin/env python3
"""Safe diagnostics: compare ONLY named hashes of security metadata categories.

Never print SQL definitions, object names, policy bodies, customer data or raw digests.
"""
import json
import sys
from collections import Counter
from pathlib import Path

CATEGORIES = ("objects", "table_grants", "policies", "functions",
              "function_grants", "schema_owners", "schema_grants")

def generate(src_path, dest_path):
    source = Path(src_path).read_text(encoding="utf-8")
    old_start = "SELECT md5(jsonb_build_object("
    old_end = ")::text) AS security_digest;"
    if source.count(old_start) != 1 or source.count(old_end) != 1:
        raise SystemExit("Invalid reviewed fingerprint SQL structure")
    target = source.replace(old_start, "WITH category_parts AS (SELECT jsonb_build_object(", 1)
    target = target.replace(old_end,
        ") AS payload) SELECT jsonb_object_agg(k, md5(v::text))::text "
        "FROM category_parts CROSS JOIN LATERAL jsonb_each(payload) AS parts(k, v);", 1)
    Path(dest_path).write_text(target, encoding="utf-8")

def compare(source_path, restore_path):
    try:
        src = json.loads(Path(source_path).read_text(encoding="utf-8").strip())
        dst = json.loads(Path(restore_path).read_text(encoding="utf-8").strip())
        if (not isinstance(src, dict) or not isinstance(dst, dict)
                or set(src) != set(CATEGORIES) or set(dst) != set(CATEGORIES)):
            raise ValueError("category keys mismatch")
        for value in list(src.values()) + list(dst.values()):
            if (not isinstance(value, str) or len(value) != 32
                    or any(c not in "0123456789abcdef" for c in value)):
                raise ValueError("invalid hash format")
    except (ValueError, OSError, json.JSONDecodeError):
        print("security_mismatch_categories=diagnostic_unavailable")
        return
    failed = [key for key in CATEGORIES if src[key] != dst[key]]
    print("security_mismatch_categories=" + (",".join(failed) if failed else "none"))

def generate_acl(src_path, dest_path):
    source = Path(src_path).read_text(encoding="utf-8")
    old_start, old_end = "SELECT md5(jsonb_build_object(", ")::text) AS security_digest;"
    if source.count(old_start) != 1 or source.count(old_end) != 1:
        raise SystemExit("Invalid reviewed fingerprint SQL structure")
    query = source.replace(old_start, "WITH category_parts AS (SELECT jsonb_build_object(", 1)
    query = query.replace(old_end,
        ") AS payload) SELECT (payload->'table_grants')::text FROM category_parts;", 1)
    Path(dest_path).write_text(query, encoding="utf-8")

def compare_acl(source_path, restore_path):
    try:
        def load(path):
            data = json.loads(Path(path).read_text(encoding="utf-8").strip())
            if not isinstance(data, list):
                raise ValueError("Expected grant rows")
            result = []
            for row in data:
                if (not isinstance(row, list) or len(row) != 5 or
                    not all(isinstance(x, str) for x in row[:4]) or
                    not isinstance(row[4], bool)):
                    raise ValueError("Invalid grant row")
                result.append(tuple(row))
            return Counter(result)
        source = load(source_path)
        restored = load(restore_path)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        print("acl_diagnostic=unavailable")
        return
    missing, extra = source - restored, restored - source
    changed_rows = list(missing) + list(extra)
    schemas = sorted({row[0] for row in changed_rows})
    safe_schemas = {"auth", "storage", "public", "private"}
    schema_classes = [s if s in safe_schemas else "other" for s in schemas]
    objects = {(row[0], row[1]) for row in changed_rows}
    print("acl_missing_grants=" + str(sum(missing.values())))
    print("acl_extra_grants=" + str(sum(extra.values())))
    print("acl_changed_objects=" + str(len(objects)))
    print("acl_impacted_schemas=" + (",".join(sorted(set(schema_classes))) if schemas else "none"))

def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ("generate", "compare", "generate-acl", "compare-acl"):
        raise SystemExit("usage: central-security-category-diagnostics.py generate|compare|generate-acl|compare-acl path path")
    if sys.argv[1] == "generate":
        generate(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "compare":
        compare(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "generate-acl":
        generate_acl(sys.argv[2], sys.argv[3])
    else:
        compare_acl(sys.argv[2], sys.argv[3])

if __name__ == "__main__":
    main()
