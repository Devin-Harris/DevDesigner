#!/bin/sh
# Entry point of the self-hosted image (Dockerfile.selfhost). Everything lives in
# /data: the database, uploaded media and, unless JWT_SECRET is set, a session
# secret generated on first start (so sign-ins survive restarts).
set -e
mkdir -p /data
if [ -z "$JWT_SECRET" ]; then
  if [ ! -s /data/jwt-secret ]; then
    node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" > /data/jwt-secret
    chmod 600 /data/jwt-secret
  fi
  JWT_SECRET="$(cat /data/jwt-secret)"
  export JWT_SECRET
fi
# Same-origin by default; set PUBLIC_APP_URL / CORS_ORIGIN when serving on a public domain.
export CORS_ORIGIN="${CORS_ORIGIN:-${PUBLIC_APP_URL:-http://localhost:${PORT:-3000}}}"
exec node dist/src/main.js
