import './instrument';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import 'reflect-metadata';
import compression from 'compression';
import { json, urlencoded } from 'body-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { REQUEST_ID_HEADER } from './platform/http/request-context';

/**
 * JSON body limits. Body parsing runs before guards, so the global cap stays small;
 * only routes that legitimately carry big payloads get more. Compressed request
 * bodies are refused (inflate: false) so the limit is the real in-memory size.
 */
const GLOBAL_BODY_LIMIT = '2mb';
const LARGE_BODY_ROUTES: Array<{ path: string; limit: string }> = [
  // Export files embed every image/video as base64 (round-trips the old 200 MB cap).
  { path: '/api/projects/import', limit: '200mb' },
  { path: '/api/projects/:projectId/import-content', limit: '200mb' },
  // 40 MB video is ~54 MB of base64 (UploadImageDto caps data at 56M chars).
  { path: '/api/projects/:projectId/images', limit: '60mb' },
  // Up to 2000 batch entries / 5000 clone rows, each element up to ~50k chars of text.
  { path: '/api/projects/:projectId/batch', limit: '20mb' },
  { path: '/api/projects/:projectId/clone', limit: '20mb' },
  // Theme libraries (up to 100 themes with master items).
  { path: '/api/projects/:projectId/themes', limit: '10mb' },
  { path: '/api/me/themes', limit: '10mb' },
];

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  // Railway terminates TLS one proxy hop in front of us: trust exactly that many
  // X-Forwarded-For entries so req.ip (the rate-limit key) is the real client.
  app.set('trust proxy', config.get<number>('TRUST_PROXY_HOPS', 1));

  // Route-scoped parsers first: once one has parsed a body, the global one skips it.
  for (const { path, limit } of LARGE_BODY_ROUTES) {
    app.use(path, json({ limit, inflate: false }));
  }
  app.use(json({ limit: GLOBAL_BODY_LIMIT, inflate: false }));
  app.use(urlencoded({ extended: true, limit: GLOBAL_BODY_LIMIT, inflate: false }));
  // Project graphs and export files are large, repetitive JSON; gzip cuts them 5-10x.
  // Raster images are already compressed, so they are skipped (SVG is text and is not).
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) =>
        !/^image\/(?!svg)/.test(String(res.getHeader('Content-Type') ?? '')) && compression.filter(req, res),
    }),
  );

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

  const corsOrigin = config.get<string>('CORS_ORIGIN', 'http://localhost:4242');
  app.enableCors({
    origin: corsOrigin.split(',').map((o) => o.trim()),
    // Share tokens travel in X-Share-Token for anonymous link-based access;
    // X-Client-Id tags each write so its realtime broadcast can skip the origin tab.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Share-Token', 'X-Client-Id', 'X-Guest-Id', REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER],
    credentials: true,
  });

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);

  app.get(Logger).log(`DevDesigner API listening on http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
