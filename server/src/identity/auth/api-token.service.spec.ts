import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { ApiTokenService } from './api-token.service';
import type { ApiToken } from './api-token.entity';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** verify(): current `dd_` tokens, legacy `dbd_` tokens, and rejection of anything else. */
describe('ApiTokenService.verify', () => {
  let tokens: { findOne: jest.Mock; update: jest.Mock; save: jest.Mock; create: jest.Mock };
  let service: ApiTokenService;
  const rows = new Map<string, Partial<ApiToken>>();

  beforeEach(() => {
    rows.clear();
    tokens = {
      findOne: jest.fn(async ({ where }: { where: { tokenHash: string } }) => rows.get(where.tokenHash) ?? null),
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn(async (v) => ({ id: 'new', createdAt: new Date('2026-01-01T00:00:00Z'), ...v })),
      create: jest.fn((v) => v),
    };
    service = new ApiTokenService(
      tokens as unknown as Repository<ApiToken>,
      new ConfigService({ API_TOKEN_RATE_LIMIT: 600 }),
    );
  });

  const store = (raw: string, extra: Partial<ApiToken> = {}): void => {
    rows.set(sha256(raw), { id: `t-${raw}`, userId: 'u1', scope: 'write', revokedAt: null, ...extra });
  };

  it('accepts a current dd_ token', async () => {
    store('dd_current');
    await expect(service.verify('dd_current')).resolves.toMatchObject({ id: 'u1', viaToken: { id: 't-dd_current' } });
  });

  it('accepts a legacy dbd_ token hashed with its prefix', async () => {
    store('dbd_legacy');
    await expect(service.verify('dbd_legacy')).resolves.toMatchObject({ id: 'u1', viaToken: { id: 't-dbd_legacy' } });
    expect(tokens.findOne).toHaveBeenCalledWith({ where: { tokenHash: sha256('dbd_legacy') } });
  });

  it('rejects revoked legacy tokens', async () => {
    store('dbd_revoked', { revokedAt: new Date() });
    await expect(service.verify('dbd_revoked')).resolves.toBeNull();
  });

  it('rejects unknown prefixes without a lookup', async () => {
    await expect(service.verify('xyz_abc')).resolves.toBeNull();
    expect(tokens.findOne).not.toHaveBeenCalled();
  });

  it('creates new tokens with the dd_ prefix', async () => {
    const created = await service.create('u1', { name: 'cli' } as never);
    expect(created.token.startsWith('dd_')).toBe(true);
    expect(created).toMatchObject({ expiresAt: null, projectId: null });
  });

  it('rejects an expired token and accepts one that has not expired yet', async () => {
    store('dd_old', { expiresAt: new Date(Date.now() - 1000) });
    store('dd_fresh', { expiresAt: new Date(Date.now() + 60_000) });
    await expect(service.verify('dd_old')).resolves.toBeNull();
    await expect(service.verify('dd_fresh')).resolves.toMatchObject({ id: 'u1' });
  });

  it('carries a project restriction on the verified caller', async () => {
    store('dd_one', { projectId: 'p1' });
    await expect(service.verify('dd_one')).resolves.toMatchObject({ viaToken: { projectId: 'p1' } });
  });

  it('sets an expiry and only limits a token to a project its owner owns', async () => {
    const query = jest.fn(async (_sql: string, [projectId]: string[]) => (projectId === 'mine' ? [{}] : []));
    (tokens as unknown as { manager: unknown }).manager = { query };
    const created = await service.create('u1', { name: 'ci', expiresInDays: 30, projectId: 'mine' } as never);
    expect(created.projectId).toBe('mine');
    expect(new Date(created.expiresAt!).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    await expect(service.create('u1', { name: 'x', projectId: 'theirs' } as never)).rejects.toThrow(/project you own/);
  });
});
