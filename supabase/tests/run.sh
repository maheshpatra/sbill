#!/usr/bin/env bash
# Apply the auth stub, every migration, and the seed, then run the RLS proof.
# Requires local Postgres (superuser via sudo -u postgres) and an empty database.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="${BILLFLOW_TEST_DB:-billflow_rls_test}"

cd "$ROOT"
cat supabase/migrations/*.sql > supabase/apply_all.sql

sudo -u postgres psql -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB}' AND pid <> pg_backend_pid();" >/dev/null
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${DB};"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB};"

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/00_stub_auth.sql
# Prove the first migration supersedes the earlier draft objects.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/01_draft.sql
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" -f supabase/apply_all.sql
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" -f supabase/seed.sql
# Seed must be idempotent.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" -f supabase/seed.sql
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/rls_test.sql

echo "RLS tests passed against ${DB}"
