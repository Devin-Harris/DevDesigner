import type { DataSource } from 'typeorm';
import { AdminStorageService, STORAGE_CACHE_MS } from './admin-storage.service';
import {
  DAY,
  NOW,
  insertElement,
  insertImage,
  insertProject,
  insertShareLink,
  insertToken,
  insertUser,
  openDatabases,
} from './testing/admin-fixtures';

describe('AdminStorageService', () => {
  let app: DataSource;
  let analytics: DataSource;

  beforeEach(async () => {
    ({ app, analytics } = await openDatabases());
  });

  afterEach(() => Promise.all([app.destroy(), analytics.destroy()]));

  async function seed(): Promise<{ big: string }> {
    const ada = await insertUser(app, { email: 'ada@example.com' });
    await insertUser(app, { email: 'nopw@example.com', password: false });
    const big = await insertProject(app, { ownerId: ada, name: 'Big', lastOpenedAt: NOW - DAY });
    const small = await insertProject(app, { ownerId: ada, name: 'Small', lastOpenedAt: NOW - 60 * DAY });
    await insertProject(app, { ownerId: 'guest:g1', name: 'Guest' });
    await insertProject(app, { ownerId: ada, name: 'Sandbox', description: 'dd-guide-sandbox' });
    const used = await insertImage(app, big, { byteSize: 5000 });
    await insertImage(app, big, { mimeType: 'image/svg+xml', blob: Buffer.alloc(300) });
    await insertElement(app, big, { type: 'image', fileId: used });
    await insertElement(app, big, { type: 'text', text: 'hello' });
    await insertElement(app, small, { type: 'frame', slide: true });
    await insertShareLink(app, big, { access: 'EDIT' });
    await insertShareLink(app, big, { revoked: true });
    await insertShareLink(app, small, { expiresAt: NOW - DAY });
    await insertToken(app, ada, { lastUsedAt: NOW - DAY });
    await insertToken(app, ada, { scope: 'read', revoked: true });
    return { big };
  }

  it('counts rows, media bytes (byteSize or blob length) and orphaned images', async () => {
    await seed();
    const report = await new AdminStorageService(app, analytics).report(NOW);
    expect(report.rows).toEqual(
      expect.arrayContaining([
        { key: 'users', count: 2 },
        { key: 'projects', count: 4 },
        { key: 'project_images', count: 2 },
      ]),
    );
    expect(report.images).toEqual([
      { mimeType: 'image/png', count: 1, bytes: 5000, unique: 1 },
      { mimeType: 'image/svg+xml', count: 1, bytes: 300, unique: 1 },
    ]);
    expect(report.orphanImages).toEqual({ count: 1, bytes: 300 });
    expect(report.slides).toBe(1);
    expect(report.elementsByType).toEqual(expect.arrayContaining([{ key: 'text', count: 1, textBytes: 5 }]));
    expect(report.database.pageSize).toBeGreaterThan(0);
  });

  it('ranks the largest real projects and buckets activity without guide sandboxes', async () => {
    const { big } = await seed();
    const report = await new AdminStorageService(app, analytics).report(NOW);
    expect(report.largestProjects[0]).toMatchObject({ id: big, name: 'Big', ownerKind: 'user', imageBytes: 5300 });
    expect(report.largestProjects.map((p) => p.name)).not.toContain('Sandbox');
    expect(report.projectActivity).toEqual([
      { key: 'active_7d', count: 2 },
      { key: 'active_30d', count: 0 },
      { key: 'idle', count: 1 },
      { key: 'dormant', count: 0 },
    ]);
    expect(report.projectActivityApprox).toBe(true);
    expect(report.guests).toEqual({ owners: 1, projects: 1 });
    expect(report.projectsPerUser).toEqual(expect.arrayContaining([{ key: '2-5', count: 1 }]));
  });

  it('reports auth methods, live share links by level and token usage by scope', async () => {
    await seed();
    const report = await new AdminStorageService(app, analytics).report(NOW);
    expect(report.authMethods).toEqual(
      expect.arrayContaining([
        { key: 'password', count: 1 },
        { key: 'unknown', count: 1 },
      ]),
    );
    expect(report.activeShareLinks).toEqual([{ key: 'EDIT', count: 1 }]);
    expect(report.apiTokens).toEqual(
      expect.arrayContaining([
        { scope: 'write', total: 1, active: 1, used7d: 1 },
        { scope: 'read', total: 1, active: 0, used7d: 0 },
      ]),
    );
  });

  it('serves the cached report until it is older than the cache window', async () => {
    const service = new AdminStorageService(app, analytics);
    const first = await service.report(NOW);
    await insertUser(app, { email: 'late@example.com' });
    expect(await service.report(NOW + 1000)).toBe(first);
    const fresh = await service.report(NOW + STORAGE_CACHE_MS + 1);
    expect(fresh.rows.find((r) => r.key === 'users')?.count).toBe(1);
  });
});
