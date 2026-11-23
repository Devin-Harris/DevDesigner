import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { ShareLink } from './share-link.entity';

/**
 * A signed-in user opened a project through a share link. Lets the projects dialog
 * list "Shared with me" so the user does not need the link again. The row goes
 * with its link (cascade), and the list hides links that are revoked or expired.
 * The token is kept sealed (AES-GCM, like share_links.tokenSealed) so the client
 * can reopen /shared/:token.
 */
@Entity('shared_project_visits')
@Index('uq_shared_project_visits_user_link', ['userId', 'shareLinkId'], { unique: true })
export class SharedProjectVisit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  userId!: string;

  @Column({ type: 'varchar' })
  shareLinkId!: string;

  @ManyToOne(() => ShareLink, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shareLinkId' })
  shareLink!: Relation<ShareLink>;

  @Column({ type: 'text' })
  tokenSealed!: string;

  @Column({ type: 'datetime' })
  lastOpenedAt!: Date;
}
