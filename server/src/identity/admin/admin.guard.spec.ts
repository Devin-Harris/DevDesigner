import { ExecutionContext, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { User } from '../auth/user.entity';
import type { AuthUser } from '../auth/auth.types';
import { AdminGuard } from './admin.guard';

function contextFor(user: AuthUser | null): ExecutionContext {
  const request = { user, method: 'GET', originalUrl: '/api/admin/ping', url: '/api/admin/ping' };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const roles: Record<string, User['role']> = { 'admin-id': 'admin', 'user-id': 'user' };
  const findOne = jest.fn(async ({ where }: { where: { id: string } }) =>
    roles[where.id] ? ({ id: where.id, role: roles[where.id] } as User) : null,
  );
  const guard = new AdminGuard({ findOne } as unknown as Repository<User>);

  beforeEach(() => findOne.mockClear());

  it('lets an admin session through, reading the role from the DB', async () => {
    await expect(guard.canActivate(contextFor({ id: 'admin-id', email: 'a@x.io' }))).resolves.toBe(true);
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for a signed-in non-admin', async () => {
    await expect(guard.canActivate(contextFor({ id: 'user-id', email: 'u@x.io' }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns 404 for an unknown user id', async () => {
    await expect(guard.canActivate(contextFor({ id: 'gone', email: null }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 for anonymous callers without touching the DB', async () => {
    await expect(guard.canActivate(contextFor(null))).rejects.toBeInstanceOf(NotFoundException);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('returns 404 for API-token auth, even when the token belongs to an admin', async () => {
    const viaToken = { id: 'admin-id', email: 'a@x.io', viaToken: { id: 't1', scope: 'write' as const } };
    await expect(guard.canActivate(contextFor(viaToken))).rejects.toBeInstanceOf(NotFoundException);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('uses the same body as an unmatched route', async () => {
    const error = await guard.canActivate(contextFor(null)).catch((e: NotFoundException) => e);
    expect((error as NotFoundException).getResponse()).toEqual({
      message: 'Cannot GET /api/admin/ping',
      error: 'Not Found',
      statusCode: 404,
    });
  });
});
