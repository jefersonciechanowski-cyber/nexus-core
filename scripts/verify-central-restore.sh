#!/usr/bin/env bash
set -euo pipefail
# Local-only and deliberately read-only: reject remote production database endpoints.
if [[ "${NEXUS_ISOLATED_RESTORE:-}" != "1" ]]; then
  echo "Blocked: isolated restore verification must be explicitly enabled." >&2
  exit 2
fi
if [[ -z "${RESTORE_DB_URL:-}" ]]; then
  echo "Blocked: RESTORE_DB_URL is required." >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to validate the database URL." >&2
  exit 2
fi
# Parse the real URL hostname, never a substring that could be in credentials.
if ! db_host="$(node -e 'try { const u = new URL(process.env.RESTORE_DB_URL); if (!["postgres:", "postgresql:"].includes(u.protocol)) process.exit(2); process.stdout.write(u.hostname); } catch { process.exit(2); }')"; then
  echo "Blocked: invalid PostgreSQL URL; only local PostgreSQL supported." >&2
  exit 2
fi
case "$db_host" in
  localhost|127.0.0.1) ;;
  *) echo "Blocked: only localhost/127.0.0.1 PostgreSQL is supported." >&2; exit 2 ;;
esac
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for isolated verification." >&2
  exit 2
fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
psql "$RESTORE_DB_URL" -X -v ON_ERROR_STOP=1 --csv --file "$script_dir/central-restore-integrity.sql"
