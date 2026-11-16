import { BeforeApplicationShutdown, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { User } from '../../identity/auth/user.entity';
import { Project } from '../../projects/projects/project.entity';
import { hashShareToken } from '../../collaboration/sharing/share-token';
import { ShareLink } from '../../collaboration/sharing/share-link.entity';
import { TouchThrottle } from './touch-throttle';

const SEEN_INTERVAL_MS = 10 * 60_000;
const OPENED_INTERVAL_MS = 10 * 60_000;
const SHARE_FLUSH_MS = 30_000;

/**
 * Throttled, fire-and-forget activity columns on the APP database (columns added
 * in Wave 3): `users.lastSeenAt`, `projects.lastOpenedAt`, and
 * `share_links.lastUsedAt` / `useCount`. Nothing is awaited by a request; at most
 * one UPDATE per row per 10 minutes, and share-link uses are summed in memory and
 * written as one `useCount = useCount + n` per link every 30 s (and on shutdown).
 */
@Injectable()
export class ActivityTouchService implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown {
  private readonly logger = new Logger(ActivityTouchService.name);
  private readonly seen = new TouchThrottle(SEEN_INTERVAL_MS);
  private readonly opened = new TouchThrottle(OPENED_INTERVAL_MS);
  /** share token -> uses since the last flush. */
  private shareUses = new Map<string, { count: number; at: number }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flushShareUses(), SHARE_FLUSH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.onModuleDestroy();
    await this.flushShareUses();
  }

  userSeen(userId: string, now = Date.now()): void {
    if (!this.seen.take(userId, now)) return;
    this.write(this.dataSource.getRepository(User).update({ id: userId }, { lastSeenAt: new Date(now) }));
  }

  projectOpened(projectId: string, now = Date.now()): void {
    if (!this.opened.take(projectId, now)) return;
    this.write(this.dataSource.getRepository(Project).update({ id: projectId }, { lastOpenedAt: new Date(now) }));
  }

  /** Count one use of a share link (written in the next 30 s flush). */
  shareLinkUsed(token: string, now = Date.now()): void {
    const entry = this.shareUses.get(token);
    if (entry) {
      entry.count++;
      entry.at = now;
    } else {
      this.shareUses.set(token, { count: 1, at: now });
    }
  }

  async flushShareUses(): Promise<void> {
    if (this.shareUses.size === 0) return;
    const uses = this.shareUses;
    this.shareUses = new Map();
    const repo = this.dataSource.getRepository(ShareLink);
    for (const [token, { count, at }] of uses) {
      try {
        await repo
          .createQueryBuilder()
          .update(ShareLink)
          .set({ lastUsedAt: new Date(at), useCount: () => `useCount + ${Math.floor(count)}` })
          .where('token = :hash', { hash: hashShareToken(token) })
          .execute();
      } catch (err) {
        this.logger.warn({ err }, 'Share link activity update failed');
      }
    }
  }

  private write(update: Promise<unknown>): void {
    void update.catch((err: unknown) => this.logger.debug({ err }, 'Activity touch failed'));
  }
}
