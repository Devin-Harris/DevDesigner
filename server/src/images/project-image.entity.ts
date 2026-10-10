import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity';

/**
 * An image uploaded for use by image elements on a project's canvas. The bytes
 * live in this table (referenced by `ElementEntity.fileId`) rather than inline in
 * element JSON, so realtime syncs and project loads stay small. Deleting the
 * project cascades to its images.
 */
@Entity('project_images')
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

  @CreateDateColumn()
  createdAt!: Date;
}
