import { request as httpRequest } from 'node:http';
import type { Request, Response } from 'express';

/** Public path the database GUI is served under (must match sqlite-web's --url-prefix). */
export const DB_ADMIN_PATH = '/_db';

/**
 * Reverse proxy for the optional sqlite-web sidecar (server/scripts/start.sh).
 * The sidecar only listens on loopback, and Railway gives a service one public
 * port, so the app forwards `/_db/*` to it. sqlite-web enforces its own password
 * (SQLITE_WEB_PASSWORD); this is only mounted when DB_ADMIN_PASSWORD is set.
 *
 * Mounted before helmet and the body parsers so the request streams through
 * untouched and the GUI keeps its own headers (our API CSP would block its UI).
 */
export function dbAdminProxy(port: number) {
  return (req: Request, res: Response): void => {
    // Express strips the mount path; sqlite-web expects it (it runs with --url-prefix).
    const path = DB_ADMIN_PATH + (req.url === '/' ? '/' : req.url);
    const upstream = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: req.method,
        path,
        headers: { ...req.headers, host: req.headers.host ?? `127.0.0.1:${port}` },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      res.status(502).type('text/plain').send('Database admin is not running.');
    });
    req.pipe(upstream);
  };
}
