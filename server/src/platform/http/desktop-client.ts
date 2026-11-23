import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type RequestHandler } from 'express';

/**
 * CLIENT_DIR set (desktop app, self-hosted image): the server also hosts the built
 * Angular client, so the page loads from the same origin as the API (no CORS, httpOnly
 * cookies just work, and Angular's path routing gets an index.html fallback).
 * Registered before helmet, which keeps its deny-all CSP for /api only.
 */
export function desktopClientMiddleware(clientDir: string): RequestHandler {
  const index = join(clientDir, 'index.html');
  if (!existsSync(index)) {
    throw new Error(`CLIENT_DIR has no index.html: ${clientDir}`);
  }
  const files = express.static(clientDir, { index: false, fallthrough: true, maxAge: 0 });
  return (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/api' || req.path.startsWith('/socket.io')) {
      next();
      return;
    }
    // Page CSP: the Angular build adds a hash-based script-src meta tag; this header
    // only adds what a meta tag can't (framing) plus plugin/base restrictions.
    res.setHeader(
      'Content-Security-Policy',
      "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    files(req, res, () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      // dotfiles: 'allow' — sendFile checks the whole absolute path, and the Linux AppImage
      // runs from a hidden mount (/tmp/.mount_*), which would otherwise 404 every page.
      res.sendFile(index, { dotfiles: 'allow' });
    });
  };
}
