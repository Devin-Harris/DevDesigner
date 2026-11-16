import { UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { ACCOUNT_DELETED_EVENT, AUTH_COOKIE } from './auth.types';
import type { User } from './user.entity';
import type { AdminBootstrapService } from '../admin/admin-bootstrap.service';

type TxDelete = (entity: { name: string }, where: unknown) => Promise<void>;

/** Session versions (log out everywhere) and account deletion, on an in-memory user table. */
describe('AuthService sessions', () => {
  const jwt = new JwtService({ secret: 'test-secret-test-secret-test-secret', signOptions: { expiresIn: '1h' } });
  let rows: Map<string, User>;
  let deleted: string[];
  let events: EventEmitter2;
  let service: AuthService;

  const cookie = (token: string): string => `${AUTH_COOKIE}=${encodeURIComponent(token)}`;

  beforeEach(async () => {
    rows = new Map();
    deleted = [];
    const users = {
      findOne: jest.fn(
        async ({ where }: { where: { id?: string; email?: string } }) =>
          [...rows.values()].find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null,
      ),
      find: jest.fn(async () => [...rows.values()].filter((u) => u.tokenVersion > 0)),
      create: jest.fn((v: Partial<User>) => ({ tokenVersion: 0, ...v })),
      save: jest.fn(async (u: User) => {
        const saved = { ...u, id: u.id ?? `u${rows.size + 1}` } as User;
        rows.set(saved.id, saved);
        return saved;
      }),
      update: jest.fn(async () => ({ affected: 1 })),
      increment: jest.fn(async ({ id }: { id: string }, _col: string, by: number) => {
        const u = rows.get(id);
        if (u) u.tokenVersion += by;
      }),
      manager: {
        transaction: async (fn: (tx: { delete: TxDelete }) => Promise<void>) =>
          fn({
            delete: async (entity, where) => {
              deleted.push(entity.name);
              if (entity.name === 'User') rows.delete((where as { id: string }).id);
            },
          }),
      },
    };
    const admin = { isAllowlisted: () => false, promoteIfAllowlisted: async () => undefined };
    events = new EventEmitter2();
    service = new AuthService(users as unknown as Repository<User>, jwt, admin as unknown as AdminBootstrapService, events);
    await service.onModuleInit();
  });

  async function registered(): Promise<{ id: string; token: string }> {
    const { user, token } = await service.register({ email: 'A@Example.com', password: 'correct horse battery' });
    return { id: user.id, token };
  }

  it('verifies a fresh session cookie', async () => {
    const { id, token } = await registered();
    expect(service.verifySession(cookie(token))?.id).toBe(id);
  });

  it('log out everywhere invalidates every earlier session, not later ones', async () => {
    const { id, token } = await registered();
    rows.get(id)!.passwordHash = await bcrypt.hash('correct horse battery', 4);
    await service.revokeSessions(id);
    expect(service.verifySession(cookie(token))).toBeNull();
    const { token: fresh } = await service.login({ email: 'a@example.com', password: 'correct horse battery' });
    expect(service.verifySession(cookie(fresh))?.id).toBe(id);
  });

  it('remembers bumped versions across a restart (loaded on boot)', async () => {
    const { id, token } = await registered();
    await service.revokeSessions(id);
    await service.onModuleInit();
    expect(service.verifySession(cookie(token))).toBeNull();
  });

  it('does not echo whether an email is registered', async () => {
    await registered();
    await expect(service.register({ email: 'a@example.com', password: 'whatever12345' })).rejects.toThrow(
      /Could not create an account/,
    );
  });

  it('deleting an account needs the password, then drops sessions, tokens and owned data', async () => {
    const { id, token } = await registered();
    rows.get(id)!.passwordHash = await bcrypt.hash('pw-123456789', 4);
    const listener = jest.fn();
    events.on(ACCOUNT_DELETED_EVENT, listener);

    await expect(service.deleteAccount(id, 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(rows.has(id)).toBe(true);
    expect(listener).not.toHaveBeenCalled();

    await service.deleteAccount(id, 'pw-123456789');
    expect(listener).toHaveBeenCalledWith({ userId: id });
    expect(deleted).toEqual(['ApiToken', 'User']);
    expect(rows.has(id)).toBe(false);
    expect(service.verifySession(cookie(token))).toBeNull();
  });
});
