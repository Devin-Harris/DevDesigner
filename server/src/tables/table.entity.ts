import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity';
import { ColumnEntity } from '../columns/column.entity';
import { IndexEntity } from '../indexes/index.entity';

/**
 * A table node on the canvas (BUILD_INSTRUCTIONS.md section 4.1). Position lives
 * in its own x/y columns, not a JSON blob. Deleting the parent project cascades
 * to its tables; deleting a table cascades to its columns.
 */
@Entity('tables')
export class TableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project!: Project;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'float', default: 0 })
  x!: number;

  @Column({ type: 'float', default: 0 })
  y!: number;

  @Column({ type: 'varchar', nullable: true })
  color!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /** Manual width override in px; null = auto-fit to content. */
  @Column({ type: 'float', nullable: true })
  width!: number | null;

  /** Uniform display scale; null = natural size (1). */
  @Column({ type: 'float', nullable: true })
  scale!: number | null;

  /** Group membership (shared id across tables/elements/diagrams); null = ungrouped. */
  @Column({ type: 'varchar', nullable: true })
  groupId!: string | null;

  /** The slide (frame element id) this table belongs to; null = none. */
  @Column({ type: 'varchar', nullable: true })
  slideId!: string | null;

  /** Morph tag (`tag:<name>`) pairing this table across slides; null = untagged. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  morphId!: string | null;

  @OneToMany(() => ColumnEntity, (column) => column.table)
  columns!: ColumnEntity[];

  @OneToMany(() => IndexEntity, (index) => index.table)
  indexes!: IndexEntity[];
}
