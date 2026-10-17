import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import 'reflect-metadata';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
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

  console.log(`DBDesigner API listening on http://localhost:${port}/api`);
}

void bootstrap();
