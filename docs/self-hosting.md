# Self-hosting a DevDesigner server

A self-hosted server is the full web app plus the API in one container. All of its
state is one folder (`/data`): the SQLite database, uploaded media and a session
secret it generates on first start. Desktop apps can sync projects with it.

## Run it

```sh
docker build -f Dockerfile.selfhost -t devdesigner .
docker run -d --name devdesigner -p 3000:3000 -v devdesigner-data:/data devdesigner
```

Open http://localhost:3000, create an account, and you're done. To use your own
folder instead of a named volume: `-v /path/to/devdesigner-data:/data`.

Upgrading: rebuild/pull the new image and restart the container. Database
migrations run on start; back up the data folder first if you want a rollback
point (it is just files).

## Use it from the desktop app

1. On the server: Account → API tokens → create a token.
2. In the desktop app: Projects → Sync → Add server, paste the server URL and the token.
3. Per project: ⋮ → "Sync to <server>", or Sync → Projects → Download for projects
   that already live on the server.

Synced projects are checked every 20 seconds while online. If only one side
changed it is copied to the other; if both changed, the desktop copy wins and the
server's version is saved on the desktop as "<name> (<server> copy <time>)".

## Options (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Listen port inside the container. |
| `PUBLIC_APP_URL` | `http://localhost:3000` | Public URL when served on a domain (also used as the CORS origin). |
| `JWT_SECRET` | generated into `/data/jwt-secret` | Session signing secret (≥ 32 chars). |
| `COOKIE_SECURE` | `false` | Set `true` when serving over HTTPS. |
| `TRUST_PROXY_HOPS` | `0` | Reverse proxies in front (e.g. `1` behind nginx/Caddy). |
| `ADMIN_EMAILS` | — | Accounts promoted to admin. |
| `QUOTA_*`, `RATE_LIMIT_*` | web defaults | See `server/src/platform/config/env.validation.ts`. |

Behind HTTPS (recommended for anything beyond your LAN), put a reverse proxy such
as Caddy in front and set `PUBLIC_APP_URL=https://your.domain`,
`COOKIE_SECURE=true`, `TRUST_PROXY_HOPS=1`.
