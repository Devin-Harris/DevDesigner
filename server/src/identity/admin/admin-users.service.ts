import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type {
  AdminPage,
  AdminProjectRow,
  AdminProjectSort,
  AdminSortDir,
  AdminUserDetail,
  AdminUserRow,
  AdminUserSort,
} from '@devdesigner/shared';
import { AdminAnalyticsService } from './admin-analytics.service';
import {
  IMAGE_BYTES,
  NOT_SANDBOX,
  PROJECT_AGGREGATE_SQL,
  type ProjectAggregateRow,
  likePattern,
  num,
  ownerKindOf,
} from './admin-sql';
import { DAY_MS, isoOrNull, sqlDatetime, utcDayOf, windowOf } from './admin-window';

type Row = Record<string, unknown>;

export interface PageQuery<S> {
  q?: string;
  sort?: S;
  dir?: AdminSortDir;
  page?: number;
  pageSize?: number;
}

/** ORDER BY expressions per sort key (whitelisted, never built from input). */
const USER_ORDER: Record<AdminUserSort, string> = {
  createdAt: 'u.createdAt',
  lastSeenAt: 'u.lastSeenAt',
  projects: 'projects',
  bytes: 'imageBytes',
  email: 'u.email',
};

/** Projects a user (or the list) holds, aggregated once per query. */
const USER_SQL = `
  SELECT u.id, u.email, u.displayName, u.provider, (u.passwordHash IS NOT NULL) AS hasPassword, u.role,
    u.createdAt, u.lastSeenAt, u.lastLoginAt,
    COALESCE(pc.n, 0) AS projects, COALESCE(img.bytes, 0) AS imageBytes, COALESCE(tk.n, 0) AS activeTokens
  FROM users u
  LEFT JOIN (SELECT p.ownerId, COUNT(*) AS n FROM projects p WHERE ${NOT_SANDBOX} GROUP BY p.ownerId) pc ON pc.ownerId = u.id
  LEFT JOIN (
    SELECT p.ownerId, SUM(${IMAGE_BYTES}) AS bytes FROM project_images i JOIN projects p ON p.id = i.projectId
    GROUP BY p.ownerId
  ) img ON img.ownerId = u.id
  LEFT JOIN (SELECT userId, COUNT(*) AS n FROM api_tokens WHERE revokedAt IS NULL GROUP BY userId) tk ON tk.userId = u.id`;

/**
 * Users and projects for the admin pages. Only account metadata, counts and sizes
 * are returned: never password hashes, project content or share tokens.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    @InjectDataSource() private readonly app: DataSource,
    private readonly analytics: AdminAnalyticsService,
  ) {}

  async list(query: PageQuery<AdminUserSort>): Promise<AdminPage<AdminUserRow>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const term = query.q?.trim();
    const where = term ? `WHERE (u.email LIKE ? ESCAPE '\\' OR u.displayName LIKE ? ESCAPE '\\')` : '';
    const params = term ? [likePattern(term), likePattern(term)] : [];
    const dir = query.dir === 'asc' ? 'ASC' : 'DESC';
    const order = USER_ORDER[query.sort ?? 'createdAt'];
    const rows = (await this.app.query(
      `${USER_SQL} ${where} ORDER BY ${order} ${dir} NULLS LAST, u.id LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    )) as Row[];
    const [total] = (await this.app.query(`SELECT COUNT(*) AS n FROM users u ${where}`, params)) as Row[];
    return { items: rows.map(toUserRow), total: num(total?.['n']), page, pageSize };
  }

  async detail(id: string, now = Date.now()): Promise<AdminUserDetail> {
    const [row] = (await this.app.query(`${USER_SQL} WHERE u.id = ?`, [id])) as Row[];
    if (!row) throw new NotFoundException('User not found');
    const projects = (await this.app.query(`${PROJECT_AGGREGATE_SQL} WHERE p.ownerId = ? ORDER BY p.updatedAt DESC LIMIT 200`, [
      sqlDatetime(now),
      id,
    ])) as unknown as ProjectAggregateRow[];
    const tokens = (await this.app.query(
      `SELECT id, name, prefix, scope, createdAt, lastUsedAt, revokedAt FROM api_tokens WHERE userId = ? ORDER BY createdAt DESC`,
      [id],
    )) as Row[];
    const window = windowOf(utcDayOf(now - 89 * DAY_MS), utcDayOf(now));
    const [activity, topFeatures] = await Promise.all([
      this.analytics.userActivity(id, window),
      this.analytics.userTopFeatures(id, window.startMs),
    ]);
    return {
      ...toUserRow(row),
      projectList: projects.map((p) => ({
        id: p.id,
        name: p.name,
        archived: !!num(p.archived),
        createdAt: isoOrNull(p.createdAt) ?? '',
        updatedAt: isoOrNull(p.updatedAt) ?? '',
        lastOpenedAt: isoOrNull(p.lastOpenedAt),
        tables: num(p.tables),
        elements: num(p.elements),
        imageBytes: num(p.imageBytes),
        activeShareLinks: num(p.activeShareLinks),
      })),
      tokens: tokens.map((t) => ({
        id: String(t['id']),
        name: String(t['name']),
        prefix: String(t['prefix']),
        scope: String(t['scope']),
        createdAt: isoOrNull(t['createdAt']) ?? '',
        lastUsedAt: isoOrNull(t['lastUsedAt']),
        revokedAt: isoOrNull(t['revokedAt']),
      })),
      activity,
      topFeatures,
    };
  }

  /**
   * Projects with live sizes. The aggregate runs over all real projects and is sorted
   * in memory, because `writes` comes from the analytics database (the Phase 4
   * snapshot will make this a single indexed read).
   */
  async projects(query: PageQuery<AdminProjectSort>, now = Date.now()): Promise<AdminPage<AdminProjectRow>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const term = query.q?.trim();
    const rows = (await this.app.query(
      `${PROJECT_AGGREGATE_SQL} WHERE ${NOT_SANDBOX}${term ? ` AND p.name LIKE ? ESCAPE '\\'` : ''}`,
      term ? [sqlDatetime(now), likePattern(term)] : [sqlDatetime(now)],
    )) as unknown as ProjectAggregateRow[];
    const writes = await this.analytics.writesByProject(now - 30 * DAY_MS);
    const items: AdminProjectRow[] = rows.map((p) => ({
      id: p.id,
      name: p.name,
      ownerKind: ownerKindOf(p.ownerId),
      ownerEmail: p.ownerEmail ?? null,
      archived: !!num(p.archived),
      createdAt: isoOrNull(p.createdAt) ?? '',
      lastOpenedAt: isoOrNull(p.lastOpenedAt),
      updatedAt: isoOrNull(p.updatedAt) ?? '',
      tables: num(p.tables),
      elements: num(p.elements),
      textBytes: num(p.textBytes),
      imageBytes: num(p.imageBytes),
      activeShareLinks: num(p.activeShareLinks),
      writes30d: writes.get(p.id) ?? 0,
    }));
    const key = PROJECT_SORT_KEY[query.sort ?? 'size'];
    const sign = query.dir === 'asc' ? 1 : -1;
    items.sort((a, b) => sign * (key(a) - key(b)) || a.id.localeCompare(b.id));
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
  }
}

const time = (iso: string | null): number => (iso ? Date.parse(iso) : 0);

const PROJECT_SORT_KEY: Record<AdminProjectSort, (p: AdminProjectRow) => number> = {
  size: (p) => p.imageBytes + p.textBytes,
  lastOpened: (p) => time(p.lastOpenedAt ?? p.updatedAt),
  writes: (p) => p.writes30d,
  createdAt: (p) => time(p.createdAt),
};

function toUserRow(r: Row): AdminUserRow {
  const provider = (r['provider'] as string | null) ?? null;
  return {
    id: String(r['id']),
    email: (r['email'] as string | null) ?? null,
    displayName: (r['displayName'] as string | null) ?? null,
    method: provider ?? (num(r['hasPassword']) ? 'password' : 'unknown'),
    role: r['role'] === 'admin' ? 'admin' : 'user',
    createdAt: isoOrNull(r['createdAt']) ?? '',
    lastSeenAt: isoOrNull(r['lastSeenAt']),
    lastLoginAt: isoOrNull(r['lastLoginAt']),
    projects: num(r['projects']),
    imageBytes: num(r['imageBytes']),
    activeTokens: num(r['activeTokens']),
  };
}
