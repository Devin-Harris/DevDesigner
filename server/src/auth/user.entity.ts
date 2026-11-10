import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { UserRole } from './auth.types';

/**
 * An account owner (BUILD_INSTRUCTIONS.md section 4.1). Email and passwordHash
 * are nullable so OAuth-only users (Phase 8) can exist without a local password,
 * and so the same table serves both auth methods. Email is uniquely indexed;
 * SQLite treats multiple NULLs as distinct, so provider-only users are fine.
 *
 * Owner identity is the only thing accounts affect: link-based sharing stays
 * anonymous regardless (sections 6 and 8).
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_users_email', { unique: true })
  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', nullable: true })
  passwordHash!: string | null;

  // OAuth provider identity (Phase 8). Null for email/password accounts.
  @Column({ type: 'varchar', nullable: true })
  provider!: string | null;

  @Column({ type: 'varchar', nullable: true })
  providerId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  displayName!: string | null;

  // Authoritative role; ADMIN_EMAILS only promotes (see AdminBootstrapService).
  @Column({ type: 'varchar', length: 16, default: 'user' })
  role!: UserRole;

  @Column({ type: 'datetime', nullable: true })
  lastLoginAt!: Date | null;

  // Throttled activity touch (analytics Phase 1); not written yet.
  @Column({ type: 'datetime', nullable: true })
  lastSeenAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
