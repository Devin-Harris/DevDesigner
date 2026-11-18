import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { User } from '../auth/user.entity';
import { AdminBootstrapService } from './admin-bootstrap.service';

function setup(adminEmails: string, pending: Partial<User>[] = []) {
  const users = {
    find: jest.fn(async () => pending),
    update: jest.fn(async () => ({ affected: pending.length })),
  };
  const config = { get: () => adminEmails } as unknown as ConfigService;
  const service = new AdminBootstrapService(users as unknown as Repository<User>, config);
  return { service, users };
}

describe('AdminBootstrapService', () => {
  it('matches emails case-insensitively', () => {
    const { service } = setup('ada@example.com');
    expect(service.isAllowlisted(' ADA@Example.com ')).toBe(true);
    expect(service.isAllowlisted('bob@example.com')).toBe(false);
    expect(service.isAllowlisted(null)).toBe(false);
  });

  it('promotes allowlisted users on boot and skips the DB when the list is empty', async () => {
    const empty = setup('');
    await empty.service.onApplicationBootstrap();
    expect(empty.users.find).not.toHaveBeenCalled();

    const { service, users } = setup('ada@example.com', [{ id: 'u1', email: 'ada@example.com' }]);
    await service.onApplicationBootstrap();
    expect(users.update).toHaveBeenCalledWith(expect.anything(), { role: 'admin' });
  });

  it('promotes on login only when allowlisted and never demotes', async () => {
    const { service, users } = setup('ada@example.com');
    const ada = { id: 'u1', email: 'ada@example.com', role: 'user' } as User;
    await service.promoteIfAllowlisted(ada);
    expect(ada.role).toBe('admin');

    const formerAdmin = { id: 'u2', email: 'old@example.com', role: 'admin' } as User;
    await service.promoteIfAllowlisted(formerAdmin);
    expect(formerAdmin.role).toBe('admin');
    expect(users.update).toHaveBeenCalledTimes(1);
  });
});

describe('AdminBootstrapService on a self-hosted server', () => {
  function selfHosted(admins: number, adminEmails = '') {
    const users = { count: jest.fn(async () => admins), find: jest.fn(async () => []), update: jest.fn() };
    const env: Record<string, string> = { ADMIN_EMAILS: adminEmails, SELF_HOSTED: 'true' };
    const config = { get: (k: string) => env[k] } as unknown as ConfigService;
    return new AdminBootstrapService(users as unknown as Repository<User>, config);
  }

  it('makes the first account the admin when there is none', async () => {
    const service = selfHosted(0);
    await service.onApplicationBootstrap();
    expect(await service.roleForNewAccount('a@example.com')).toBe('admin');
    expect(await service.roleForNewAccount('b@example.com')).toBe('user');
  });

  it('leaves roles alone once an admin exists or ADMIN_EMAILS is set', async () => {
    const withAdmin = selfHosted(1);
    await withAdmin.onApplicationBootstrap();
    expect(await withAdmin.roleForNewAccount('a@example.com')).toBe('user');
    const listed = selfHosted(0, 'boss@example.com');
    await listed.onApplicationBootstrap();
    expect(await listed.roleForNewAccount('a@example.com')).toBe('user');
    expect(await listed.roleForNewAccount('boss@example.com')).toBe('admin');
  });
});
