import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from '../../projects/projects/project.entity';

/**
 * A DevDesigner server this desktop install syncs with. The API token lives in the
 * local database file, which only this machine's user can read (desktop data dir).
 */
@Entity('sync_remotes')
export class SyncRemoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_sync_remotes_owner')
  @Column({ type: 'varchar' })
  ownerId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  /** API base without a trailing slash, e.g. https://host/api */
  @Column({ type: 'varchar' })
  url!: string;

  @Column({ type: 'text' })
  token!: string;

  @Column({ type: 'varchar', nullable: true })
  account!: string | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;
}

/**
 * A project whose real copy lives on a remote server. The local project is a mirror
 * with the SAME project id and item ids as the server's.
 */
@Entity('sync_links')
export class SyncLinkEntity {
  @PrimaryColumn({ type: 'varchar' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project?: Project;

  @Index('idx_sync_links_remote')
  @Column({ type: 'varchar' })
  remoteId!: string;

  @ManyToOne(() => SyncRemoteEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'remoteId' })
  remote?: SyncRemoteEntity;

  /** The server's revision of the project that the local mirror currently reflects. */
  @Column({ type: 'integer', default: 0 })
  mirroredRevision!: number;

  /** The local revision right after the mirror was last written: moved since = offline edits. */
  @Column({ type: 'integer', default: 0 })
  localRevisionAtMirror!: number;

  /** Off: the project is edited locally and only synced on request ("Sync now"). */
  @Column({ type: 'boolean', default: true })
  autoSync!: boolean;

  /** live | offline | conflict | error | paused */
  @Column({ type: 'varchar', length: 16, default: 'offline' })
  status!: string;

  @Column({ type: 'datetime', nullable: true })
  lastSyncedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;
}
