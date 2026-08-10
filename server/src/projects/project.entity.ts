import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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

  // Canvas viewport (persisted via PATCH /projects/:id/viewport in Phase 2).
  @Column({ type: 'float', default: 0 })
  viewportX!: number;

  @Column({ type: 'float', default: 0 })
  viewportY!: number;

  @Column({ type: 'float', default: 1 })
  zoom!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
