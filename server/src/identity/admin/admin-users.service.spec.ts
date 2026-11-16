import { NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { DbAnalyticsSink } from '../../platform/analytics/sinks/db.sink';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminUsersService } from './admin-users.service';
import {
  DAY,
  NOW,
  event,
  insertElement,
  insertImage,
  insertProject,
  insertToken,
  insertUser,
  openDatabases,
} from './testing/admin-fixtures';

describe('AdminUsersService', () => {
  let app: DataSource;
  let analytics: DataSource;
  let sink: DbAnalyticsSink;
  let service: AdminUsersService;

  beforeEach(async () => {
    ({ app, analytics, sink } = await openDatabases());
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    service = new AdminUsersService(app, new AdminAnalyticsService(app, analytics));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([app.destroy(), analytics.destroy()]);
  });

  it('pages, searches and sorts users with their project counts, bytes and tokens', async () => {
    const ada = await insertUser(app, { email: 'ada@example.com', displayName: 'Ada', createdAt: NOW - 3 * DAY });
    await insertUser(app, { email: 'bob@example.com', createdAt: NOW - 2 * DAY });
    await insertUser(app, { email: 'cy_100%@example.com', createdAt: NOW - DAY });
    const project = await insertProject(app, { ownerId: ada });
    await insertProject(app, { ownerId: ada });
    await insertProject(app, { ownerId: ada, description: 'dd-guide-sandbox' });
    await insertImage(app, project, { byteSize: 2048 });
    await insertToken(app, ada);

    const page = await service.list({ sort: 'projects', pageSize: 2 });
    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(page.items[0]).toMatchObject({ id: ada, projects: 2, imageBytes: 2048, activeTokens: 1, method: 'password' });
    expect(page.items[0]).not.toHaveProperty('passwordHash');

    const byEmail = await service.list({ sort: 'email', dir: 'asc', page: 2, pageSize: 2 });
    expect(byEmail.items.map((u) => u.email)).toEqual(['cy_100%@example.com']);

    // LIKE wildcards in the term are literal.
    expect((await service.list({ q: '_100%' })).items.map((u) => u.email)).toEqual(['cy_100%@example.com']);
    expect((await service.list({ q: '%' })).total).toBe(1);
  });

  it('returns one user with projects, tokens, a 90-day activity series and top features', async () => {
    const ada = await insertUser(app, { email: 'ada@example.com' });
    const project = await insertProject(app, { ownerId: ada, name: 'Schema' });
    await insertElement(app, project);
    await insertToken(app, ada, { revoked: true });
    sink.write([
      event({ actorId: ada, name: 'entity.write', props: '{"kind":"table.created"}', count: 4 }),
      event({ actorId: ada, name: 'share.created', props: '{"access":"VIEW","hasExpiry":false}' }),
      event({ actorId: ada }),
    ]);
    const detail = await service.detail(ada, NOW);
    expect(detail.projectList).toEqual([expect.objectContaining({ name: 'Schema', elements: 1, archived: false })]);
    expect(detail.tokens).toHaveLength(1);
    expect(detail.activeTokens).toBe(0);
    expect(detail.activity).toHaveLength(90);
    expect(detail.activity.at(-1)?.value).toBe(6);
    expect(detail.topFeatures).toEqual([
      { key: 'table.created', count: 4 },
      { key: 'share.created', count: 1 },
    ]);
  });

  it('404s for an unknown user', async () => {
    await expect(service.detail('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists real projects sorted by size or by writes over 30 days', async () => {
    const ada = await insertUser(app, { email: 'ada@example.com' });
    const heavy = await insertProject(app, { ownerId: ada, name: 'Heavy' });
    const busy = await insertProject(app, { ownerId: 'guest:g1', name: 'Busy' });
    await insertProject(app, { ownerId: ada, name: 'Sandbox', description: 'dbd-guide-sandbox' });
    await insertImage(app, heavy, { byteSize: 10_000 });
    sink.write([event({ name: 'entity.write', projectId: busy, props: '{"kind":"element.moved"}', count: 50 })]);

    const bySize = await service.projects({ sort: 'size' }, NOW);
    expect(bySize.total).toBe(2);
    expect(bySize.items.map((p) => p.name)).toEqual(['Heavy', 'Busy']);
    expect(bySize.items[0]).toMatchObject({ ownerKind: 'user', ownerEmail: 'ada@example.com', imageBytes: 10_000 });

    const byWrites = await service.projects({ sort: 'writes' }, NOW);
    expect(byWrites.items[0]).toMatchObject({ name: 'Busy', ownerKind: 'guest', writes30d: 50 });
    expect((await service.projects({ q: 'heav' }, NOW)).items.map((p) => p.name)).toEqual(['Heavy']);
  });
});
