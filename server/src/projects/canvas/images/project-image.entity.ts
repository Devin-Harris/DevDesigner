import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from '../../projects/project.entity';

/**
 * An image uploaded for use by image elements on a project's canvas. The bytes
 * live in this table (referenced by `ElementEntity.fileId`) rather than inline in
 * element JSON, so realtime syncs and project loads stay small. Deleting the
 * project cascades to its images.
 */
@Entity('project_images')
@Index('idx_project_images_hash', ['projectId', 'sha256'])
export class ProjectImageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project!: Project;

  @Column({ type: 'varchar' })
  mimeType!: string;

  @Column({ type: 'blob' })
  data!: Buffer;

  /** Hex SHA-256 of `data`: the same bytes uploaded or imported twice share one row. */
  @Column({ type: 'varchar', nullable: true })
  sha256!: string | null;

  /** Size of the file in bytes (media quotas sum it). Null only on rows from before it existed. */
  @Column({ type: 'integer', nullable: true })
  byteSize!: number | null;

  @CreateDateColumn()
  createdAt!: Date;
}
