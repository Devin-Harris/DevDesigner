import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { DESKTOP_CONTROL_HEADER, DesktopController } from './desktop.controller';

const TOKEN = 't'.repeat(40);

function controller(env: Record<string, string>, db: DataSource): DesktopController {
  const config = {
    get: (key: string, fallback?: string) => env[key] ?? fallback,
  } as unknown as ConfigService;
  return new DesktopController(config, db);
}

function request(token: string | undefined, address = '127.0.0.1'): Request {
  return {
    header: (name: string) => (name === DESKTOP_CONTROL_HEADER ? token : undefined),
    socket: { remoteAddress: address },
  } as unknown as Request;
}

describe('DesktopController', () => {
  let db: DataSource;
  beforeAll(async () => {
    db = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await db.initialize();
    await db.query('CREATE TABLE t (x integer)');
    await db.query('INSERT INTO t VALUES (1)');
  });
  afterAll(() => db.destroy());

  const desktopEnv = { DESKTOP: 'true', DESKTOP_CONTROL_TOKEN: TOKEN };

  it('writes a backup for the main process', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dd-backup-')), 'copy.sqlite');
    await controller(desktopEnv, db).backup(request(TOKEN), { path });
    expect(existsSync(path)).toBe(true);
  });

  it.each([
    ['a web server', { DESKTOP: 'false', DESKTOP_CONTROL_TOKEN: TOKEN }, TOKEN, '127.0.0.1'],
    ['a wrong token', desktopEnv, 'x'.repeat(40), '127.0.0.1'],
    ['no token', desktopEnv, undefined, '127.0.0.1'],
    ['a remote caller', desktopEnv, TOKEN, '10.0.0.5'],
  ])('is a 404 for %s', async (_name, env, token, address) => {
    await expect(
      controller(env, db).backup(request(token, address), { path: join(tmpdir(), 'never.sqlite') }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
