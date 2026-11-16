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
 * An image or video uploaded for use by image elements on a project's canvas
 * (referenced by `ElementEntity.fileId`). The bytes live in the content-addressed
 * media store under `sha256` (`location = 'media'`); rows written before that store
 * existed still carry them in `data` (`location = 'db'`) until they are moved, lazily
 * on first read or by `npm run media:migrate`. Deleting the project cascades to these
 * rows; files no row references any more are removed by the orphan pruning / GC.
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

  /** Legacy in-database bytes; null once the file lives in the media store. */
  @Column({ type: 'blob', nullable: true })
  data!: Buffer | null;

  /** Where the bytes are: 'media' (media store, by sha256) or 'db' (legacy `data`). */
  @Column({ type: 'varchar', default: 'db' })
  location!: 'db' | 'media';

  /** Hex SHA-256 of `data`: the same bytes uploaded or imported twice share one row. */
  @Column({ type: 'varchar', nullable: true })
  sha256!: string | null;

  /** Size of the file in bytes (media quotas sum it). Null only on rows from before it existed. */
  @Column({ type: 'integer', nullable: true })
  byteSize!: number | null;

  @CreateDateColumn()
  createdAt!: Date;
}
