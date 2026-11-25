#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
if [[ ! -x "$PG_BIN/initdb" ]]; then
  echo 'PostgreSQL 16 test binaries are required, or run pnpm test with an isolated TEST_DATABASE_URL.' >&2
  exit 1
fi
TEMP_ROOT="$(mktemp -d /tmp/mulch-fee-test.XXXXXX)"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$TEMP_ROOT/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT
"$PG_BIN/initdb" -D "$TEMP_ROOT/data" -U ubuntu -A trust --no-locale >/dev/null
"$PG_BIN/pg_ctl" -D "$TEMP_ROOT/data" -l "$TEMP_ROOT/postgres.log" -o "-h 127.0.0.1 -p 55432 -k $TEMP_ROOT -c shared_buffers=16MB" -w start >/dev/null
"$PG_BIN/createdb" -h 127.0.0.1 -p 55432 -U ubuntu mulch_fee_test
export TEST_DATABASE_URL='postgresql://ubuntu@127.0.0.1:55432/mulch_fee_test'
pnpm test
