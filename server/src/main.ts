import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import 'reflect-metadata';
import compression from 'compression';
import { AppModule } from './app.module';
import { WriteRevisionInterceptor } from './common/write-revision';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Project import posts a whole exported diagram; Express's 100kb default is too small.
  app.useBodyParser('json', { limit: '200mb' });
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

  // Write counter behind the project graph's ETag (see common/write-revision.ts).
  app.useGlobalInterceptors(new WriteRevisionInterceptor());

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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Share-Token', 'X-Client-Id', 'X-Guest-Id'],
    credentials: true,
  });

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);

  console.log(`DevDesigner API listening on http://localhost:${port}/api`);
}

void bootstrap();
