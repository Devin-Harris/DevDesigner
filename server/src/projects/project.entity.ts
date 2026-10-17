import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ProjectType } from '@dbdesigner/shared';

/**
 * A diagram project. Canvas viewport state lives here (viewportX/Y/zoom) rather
 * than on a separate diagram record; node positions live on their own rows
 * (BUILD_INSTRUCTIONS.md section 4.1).
 *
 * `ownerId` is nullable so anonymously-created diagrams can exist. Owner auth
 * and ancestry-aware authorization land in later phases; for now every caller
 * has full access.
 */
@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // FK to User once auth lands. Nullable for anonymous projects.
  @Column({ type: 'varchar', nullable: true })
  ownerId!: string | null;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  description!: string | null;

  @Column({ type: 'boolean', default: false })
  archived!: boolean;

  // Organizational diagram kind (ERD / FLOW / SCRATCH). Stored as varchar since
  // SQLite has no enum; typed against the shared ProjectType union in code.
  @Column({ type: 'varchar', default: 'ERD' })
  type!: ProjectType;

  // Canvas viewport (persisted via PATCH /projects/:id/viewport in Phase 2).
  @Column({ type: 'float', default: 0 })
  viewportX!: number;

  @Column({ type: 'float', default: 0 })
  viewportY!: number;

  @Column({ type: 'float', default: 1 })
  zoom!: number;

  // User-defined "home" view (reset-view target). All three null = no home set.
  @Column({ type: 'float', nullable: true })
  homeX!: number | null;

  @Column({ type: 'float', nullable: true })
  homeY!: number | null;

  @Column({ type: 'float', nullable: true })
  homeZoom!: number | null;

  // The project's custom presentation themes (JSON array of SlideTheme).
  @Column({ type: 'text', nullable: true })
  themesJson!: string | null;

  // Sequence-diagram layout config (one row per project; see SequenceConfigModel).
  @Column({ type: 'float', default: 160 })
  seqLifelineSpacing!: number;

  @Column({ type: 'float', default: 48 })
  seqRowSpacing!: number;

  @Column({ type: 'float', default: 42 })
  seqHeaderHeight!: number;

  @Column({ type: 'float', nullable: true })
  seqOriginY!: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
