import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

export interface StartServerOptions {
  /** Interface to bind. Defaults to all interfaces; the desktop app passes 127.0.0.1 unless sharing. */
  host?: string;
  /** Overrides the PORT config value. */
  port?: number;
}

/**
 * Creates and starts the API. Shared by the standalone server (main.ts) and the
 * Electron shell, which starts/stops it in-process. When STATIC_DIR points at a
 * built Angular app, it is served from the same origin (with SPA fallback) so the
 * client can use relative /api and socket URLs, which is what lets a peer open the
 * host's address directly.
 */
export async function startServer(
  options: StartServerOptions = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Project import posts a whole exported diagram; Express's 100kb default is too small.
  app.useBodyParser('json', { limit: '25mb' });

  // All routes are served under /api (see BUILD_INSTRUCTIONS.md section 5).
  app.setGlobalPrefix('api');

  // Global DTO validation. Controllers only parse/validate; logic lives in services.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const corsOrigin = config.get<string>('CORS_ORIGIN', 'http://localhost:4200');
  app.enableCors({
    origin: corsOrigin.split(',').map((o) => o.trim()),
    // Share tokens travel in X-Share-Token for anonymous link-based access;
    // X-Client-Id tags each write so its realtime broadcast can skip the origin tab.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Share-Token', 'X-Client-Id'],
    credentials: true,
  });

  const staticDir = config.get<string>('STATIC_DIR');
  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    app.useStaticAssets(staticDir, { index: false });
    // SPA fallback: any non-API GET that is not a file serves index.html.
    app.use((req: Request, res: Response, next: NextFunction) => {
      const isApi = req.path.startsWith('/api') || req.path.startsWith('/socket.io');
      if (req.method !== 'GET' || isApi) return next();
      res.sendFile(join(staticDir, 'index.html'));
    });
  }

  const port = options.port ?? config.get<number>('PORT', 3000);
  if (options.host) {
    await app.listen(port, options.host);
  } else {
    await app.listen(port);
  }
  return app;
}
