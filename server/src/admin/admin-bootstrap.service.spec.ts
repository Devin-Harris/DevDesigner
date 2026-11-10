import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { User } from '../identity/auth/user.entity';
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
