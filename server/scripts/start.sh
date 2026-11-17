#!/bin/sh
# Container entrypoint (server/Dockerfile). Starts the optional sqlite-web GUI on
# loopback when DB_ADMIN_PASSWORD is set; the app proxies /_db to it (main.ts).
set -e

DB_FILE="${DATABASE_PATH:-devdesigner.sqlite}"

if [ -n "$DB_ADMIN_PASSWORD" ]; then
  READ_ONLY=""
  [ "$DB_ADMIN_READ_ONLY" = "true" ] && READ_ONLY="--read-only"
  SQLITE_WEB_PASSWORD="$DB_ADMIN_PASSWORD" /opt/sqlite-web/bin/sqlite_web "$DB_FILE" \
    --host 127.0.0.1 --port "${DB_ADMIN_PORT:-8081}" --url-prefix /_db \
    --password --no-browser $READ_ONLY &
fi

exec node dist/src/main.js
