import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { ApiTokenScope } from '@devdesigner/shared';

/**
 * A per-user API token for programmatic clients such as the MCP server. Only a
 * SHA-256 hash of the secret is stored (the secret is high-entropy, so a fast
 * hash is sufficient); the raw token is shown once at creation. Revoking sets
 * `revokedAt`, which is checked on every request.
 */
@Entity('api_tokens')
export class ApiToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_api_tokens_user')
  @Column({ type: 'varchar' })
  userId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** 'read' tokens may only issue GET requests. */
  @Column({ type: 'varchar', length: 8, default: 'write' })
  scope!: ApiTokenScope;

  @Index('uq_api_tokens_hash', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string;

  /** Leading characters of the token, so a user can tell tokens apart. */
  @Column({ type: 'varchar', length: 16 })
  prefix!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  revokedAt!: Date | null;
}
