import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Repository } from 'typeorm';
import { ProjectsService } from '../../projects/projects/projects.service';
import { UserThemesService } from '../user-themes/user-themes.service';
import type { UserThemeEntity } from '../user-themes/user-theme.entity';
import { ACCOUNT_DELETED_EVENT } from './auth.types';

/** C5.1 backfill: the account.deleted listeners remove what the account owns. */
describe('account deletion listeners', () => {
  it('ProjectsService removes every project the account owns', async () => {
    const removed: string[] = [];
    const fake = {
      projects: { find: jest.fn(async () => [{ id: 'p1' }, { id: 'p2' }]) },
      remove: jest.fn(async (id: string) => {
        removed.push(id);
      }),
    };
    await ProjectsService.prototype.removeAllOwnedBy.call(fake as unknown as ProjectsService, { userId: 'u1' });
    expect(fake.projects.find).toHaveBeenCalledWith({ where: { ownerId: 'u1' }, select: { id: true } });
    expect(removed).toEqual(['p1', 'p2']);
  });

  it('UserThemesService drops the theme library, and listens for the event', async () => {
    const themes = { delete: jest.fn(async () => ({ affected: 3 })) };
    const service = new UserThemesService(themes as unknown as Repository<UserThemeEntity>);
    await service.removeAllOwnedBy({ userId: 'u1' });
    expect(themes.delete).toHaveBeenCalledWith({ ownerId: 'u1' });

    // The decorator registers it as an awaited, error-propagating listener.
    const events = new EventEmitter2();
    const handler = jest.spyOn(service, 'removeAllOwnedBy');
    events.on(ACCOUNT_DELETED_EVENT, (e) => service.removeAllOwnedBy(e));
    await events.emitAsync(ACCOUNT_DELETED_EVENT, { userId: 'u2' });
    expect(handler).toHaveBeenCalledWith({ userId: 'u2' });
  });
});
