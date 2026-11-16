import { Column, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

/*
 * Tables of the separate analytics database (`analytics.sqlite`, connection
 * 'analytics'; audit 04 §4.4). The file name deliberately does not end in
 * `.entity.ts`, so the application DataSource's entity glob never picks these up.
 * The schema is created by the analytics migrations (./migrations).
 */

/** One raw (or pre-aggregated, count > 1) event. Purged after ANALYTICS_RAW_RETENTION_DAYS. */
@Entity('analytics_event')
@Index('idx_ae_ts', ['ts'])
@Index('idx_ae_name_ts', ['name', 'ts'])
@Index('idx_ae_actor_ts', ['actorId', 'ts'])
@Index('idx_ae_project_ts', ['projectId', 'ts'])
export class AnalyticsEventRecord {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Epoch ms (minute start for aggregated rows). */
  @Column({ type: 'integer' })
  ts!: number;

  @Column({ type: 'varchar', length: 48 })
  name!: string;

  /** web | mcp | api | server | client */
  @Column({ type: 'varchar', length: 8 })
  source!: string;

  /** user | token | guest | share | anon | system */
  @Column({ type: 'varchar', length: 8 })
  actorType!: string;

  /** User id, or the keyed hash of a guest id / share token. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  actorId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  tokenId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  projectId!: string | null;

  /** Route template (`PATCH /api/projects/:projectId/batch`), never a concrete path. */
  @Column({ type: 'varchar', length: 96, nullable: true })
  route!: string | null;

  @Column({ type: 'smallint', nullable: true })
  status!: number | null;

  @Column({ type: 'integer', nullable: true })
  durationMs!: number | null;

  @Column({ type: 'integer', default: 1 })
  count!: number;

  /** Allow-listed props as JSON (<= 1 KB), see shared/src/analytics/events.ts. */
  @Column({ type: 'text', nullable: true })
  props!: string | null;

  @Column({ type: 'varchar', length: 48, nullable: true })
  mcpTool!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  ipHash!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  ua!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  requestId!: string | null;
}

/** Daily rollup per event name and dimension (kept forever; filled by the Phase 4 rollup). */
@Entity('analytics_daily')
export class AnalyticsDailyRecord {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  day!: string;

  @PrimaryColumn({ type: 'varchar', length: 48 })
  name!: string;

  @PrimaryColumn({ type: 'varchar', length: 96, default: '' })
  dim!: string;

  @PrimaryColumn({ type: 'varchar', length: 8, default: '' })
  source!: string;

  @Column({ type: 'integer' })
  events!: number;

  @Column({ type: 'integer' })
  actors!: number;

  @Column({ type: 'integer', default: 0 })
  errors!: number;

  @Column({ type: 'integer', nullable: true })
  p50Ms!: number | null;

  @Column({ type: 'integer', nullable: true })
  p95Ms!: number | null;
}

/** One row per active actor per day and source (DAU/WAU/MAU, cohorts); written on every flush. */
@Entity('analytics_actor_day')
export class AnalyticsActorDayRecord {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  day!: string;

  @PrimaryColumn({ type: 'varchar', length: 8 })
  actorType!: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  actorId!: string;

  @PrimaryColumn({ type: 'varchar', length: 8 })
  source!: string;
}

/** Nightly per-project storage snapshot (filled by the Phase 4 rollup). */
@Entity('analytics_project_snapshot')
export class AnalyticsProjectSnapshotRecord {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  day!: string;

  @PrimaryColumn({ type: 'varchar', length: 36 })
  projectId!: string;

  @Column({ type: 'varchar', length: 8 })
  ownerKind!: string;

  @Column({ type: 'integer', nullable: true }) tables!: number | null;
  @Column({ type: 'integer', nullable: true }) columns!: number | null;
  @Column({ type: 'integer', nullable: true }) relationships!: number | null;
  @Column({ type: 'integer', nullable: true }) elements!: number | null;
  @Column({ type: 'text', nullable: true }) elementsByType!: string | null;
  @Column({ type: 'integer', nullable: true }) sequenceItems!: number | null;
  @Column({ type: 'integer', nullable: true }) slides!: number | null;
  @Column({ type: 'integer', nullable: true }) images!: number | null;
  @Column({ type: 'integer', nullable: true }) imageBytes!: number | null;
  @Column({ type: 'integer', nullable: true }) textBytes!: number | null;
  @Column({ type: 'integer', nullable: true }) approxBytes!: number | null;
  @Column({ type: 'integer', nullable: true }) lastOpenedAt!: number | null;
  @Column({ type: 'integer', nullable: true }) shareLinksActive!: number | null;
}

export const ANALYTICS_ENTITIES = [
  AnalyticsEventRecord,
  AnalyticsDailyRecord,
  AnalyticsActorDayRecord,
  AnalyticsProjectSnapshotRecord,
];
