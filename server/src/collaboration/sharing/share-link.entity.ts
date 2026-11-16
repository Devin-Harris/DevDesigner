import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { ShareAccessLevel } from '@devdesigner/shared';
import { Project } from '../../projects/projects/project.entity';

/**
 * A link-based share grant for a project (BUILD_INSTRUCTIONS.md sections 4.1 and
 * 6). Anyone with the unguessable token can open the diagram without an account
 * at the token's access level. Included in the schema now; the share-link CRUD
 * routes and the token-resolving guard land in Phase 5.
 *
 * A project may have several active links (e.g. one VIEW and one EDIT). Revoking
 * sets revokedAt; an expiresAt in the past is also rejected at resolve time.
 */
@Entity('share_links')
export class ShareLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project!: Project;

  /**
   * SHA-256 (hex) of the share token; the token itself is never stored in clear
   * (security L-9, see share-token.ts). The column keeps its original name so the
   * schema does not change; rows written before hashing are converted on boot.
   */
  @Index('uq_share_links_token', { unique: true })
  @Column({ name: 'token', type: 'varchar' })
  tokenHash!: string;

  /** The token sealed for the owner's share dialog (AES-GCM); null when unknown. */
  @Column({ type: 'text', nullable: true })
  tokenSealed!: string | null;

  // Stored as varchar, typed in code against the shared ShareAccessLevel union.
  @Column({ type: 'varchar' })
  accessLevel!: ShareAccessLevel;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  expiresAt!: Date | null;

  // Activity counters (analytics Phase 1, buffered); not written yet.
  @Column({ type: 'datetime', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ type: 'integer', default: 0 })
  useCount!: number;
}
