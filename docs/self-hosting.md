# Self-hosting a DevDesigner server

A self-hosted server is the full web app plus the API in one process. All of its
state is one folder: the SQLite database, uploaded media and a session secret it
generates on first start. Desktop apps can sync projects with it.

## Run it with Docker

Each release publishes an image to GitHub Container Registry
(`.github/workflows/selfhost-image.yml`):

```sh
docker run -d --name devdesigner -p 3000:3000 -v devdesigner-data:/data ghcr.io/devin-harris/devdesigner:latest
```

Or build it yourself: `docker build -f Dockerfile.selfhost -t devdesigner .`
To use your own folder instead of a named volume: `-v /path/to/devdesigner-data:/data`.

## Run it without Docker

From a checkout of this repo (Node 22):

```sh
npm ci
npm run build:selfhost
npx devdesigner-server --data ./devdesigner-data --port 3000
```

Options: `--data <folder>`, `--port <port>`, `--url <public url>` (also read from
`DEVDESIGNER_DATA`, `PORT`, `PUBLIC_APP_URL`). The package is not on npm yet, so
`npx devdesigner-server` works inside the repo only.

## First start

The server log prints a setup box. Open the server in a browser and create an
account: on a server with no admin (and no `ADMIN_EMAILS`), **the first account
created becomes the admin**. Do this right away on a server reachable by others.

Upgrading: pull the new image (or `git pull` + `npm run build:selfhost`) and
restart. Database migrations run on start; copy the data folder first if you want
a rollback point (it is just files).

## Use it from the desktop app

1. On the server: Account → API tokens → create a token.
2. In the desktop app: Settings → Sync servers → Add server, paste the server URL and the token.
   (A server can be edited there later: name, URL or a new token.)
3. Per project: ⋮ → "Move to <server>", or Sync servers → Projects → Download for
   projects that already live on the server.

A synced project lives on the server: edits made on the desktop go straight to it,
and other people's changes (and their cursors) show up live. Offline, the desktop
keeps editing its own copy; on reconnect the two are merged item by item. Only
items changed on both sides need a choice, made in the compare view.

## Options (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Listen port. |
| `PUBLIC_APP_URL` | `http://localhost:3000` | Public URL when served on a domain (also used as the CORS origin). |
| `JWT_SECRET` | generated into `<data>/jwt-secret` | Session signing secret (≥ 32 chars). |
| `COOKIE_SECURE` | `false` | Set `true` when serving over HTTPS. |
| `TRUST_PROXY_HOPS` | `0` | Reverse proxies in front (e.g. `1` behind nginx/Caddy). |
| `ADMIN_EMAILS` | — | Accounts promoted to admin (turns off "first account is admin"). |
| `SELF_HOSTED` | `true` in the image / launcher | Enables the first-account-is-admin setup. |
| `QUOTA_*`, `RATE_LIMIT_*` | web defaults | See `server/src/platform/config/env.validation.ts`. |

Behind HTTPS (recommended for anything beyond your LAN), put a reverse proxy such
as Caddy in front and set `PUBLIC_APP_URL=https://your.domain`,
`COOKIE_SECURE=true`, `TRUST_PROXY_HOPS=1`.
