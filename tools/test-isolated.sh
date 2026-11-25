#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
[[ -x "$PG_BIN/initdb" ]] || { echo 'PostgreSQL 16 test binaries are required.' >&2; exit 1; }
TEMP_ROOT="$(mktemp -d /tmp/mulch-app-test.XXXXXX)"
PORT="${TEST_PG_PORT:-55434}"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$TEMP_ROOT/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT
"$PG_BIN/initdb" -D "$TEMP_ROOT/data" -U ubuntu -A trust --no-locale >/dev/null
"$PG_BIN/pg_ctl" -D "$TEMP_ROOT/data" -l "$TEMP_ROOT/postgres.log" -o "-h 127.0.0.1 -p $PORT -k $TEMP_ROOT -c shared_buffers=16MB" -w start >/dev/null
"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U ubuntu mulch_app_test
export TEST_ALLOW_ISOLATED_DATABASE=yes
export DATABASE_URL="postgresql://ubuntu@127.0.0.1:$PORT/mulch_app_test"
export TEST_DATABASE_URL="$DATABASE_URL"
if [[ "$#" -gt 0 ]]; then
  # Each supplied test owns any schema it needs; no production DSN is accepted.
  node --test --test-concurrency=1 "$@"
  exit 0
fi
"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U ubuntu mulch_fee_test
export TEST_DATABASE_URL="postgresql://ubuntu@127.0.0.1:$PORT/mulch_fee_test"
pnpm --filter @mulch/merchant-fees test
export TEST_DATABASE_URL="$DATABASE_URL"
APPLY_MULCH_SCHEMA=yes pnpm migrate
pnpm --filter @mulch/merchant-server test
pnpm --filter @mulch/merchant-client test
pnpm check
pnpm build
