#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
[[ -x "$PG_BIN/initdb" ]] || { echo 'PostgreSQL 16 test binaries are required.' >&2; exit 1; }
TEMP_ROOT="$(mktemp -d /tmp/mulch-server-test.XXXXXX)"
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$TEMP_ROOT/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT
printf 'Creating finite isolated PostgreSQL merchant API test cluster.\n'
"$PG_BIN/initdb" -D "$TEMP_ROOT/data" -U ubuntu -A trust --no-locale >/dev/null
"$PG_BIN/pg_ctl" -D "$TEMP_ROOT/data" -l "$TEMP_ROOT/postgres.log" -o "-h 127.0.0.1 -p $PORT -k $TEMP_ROOT -c shared_buffers=16MB" -w start >/dev/null
"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U ubuntu mulch_server_test
export TEST_DATABASE_URL="postgresql://ubuntu@127.0.0.1:$PORT/mulch_server_test"
unset DATABASE_URL TEST_ALLOW_ISOLATED_DATABASE
node --test --test-concurrency=1 tests/api.test.mjs tests/validation.test.mjs tests/postgres.test.mjs
printf 'Isolated merchant API tests finished; removing temporary cluster.\n'
