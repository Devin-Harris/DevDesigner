import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Project } from '../projects/project.entity';

/**
 * One sequence diagram (a group of lifelines + messages with its own origin and
 * spacing). A project may hold several. Deleting the project cascades to its
 * diagrams; deleting a diagram cascades to its lifelines + messages (they carry
 * an onDelete CASCADE FK to this row).
 */
@Entity('sequence_diagrams')
export class SequenceDiagramEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project!: Project;

  @Column({ type: 'float', default: 160 })
  lifelineSpacing!: number;

  @Column({ type: 'float', default: 48 })
  rowSpacing!: number;

  @Column({ type: 'float', default: 42 })
  headerHeight!: number;

  @Column({ type: 'float', default: 0 })
  originY!: number;

  /** Group membership (shared id across tables/elements/diagrams); null = ungrouped. */
  @Column({ type: 'varchar', nullable: true })
  groupId!: string | null;

  /** The slide (frame element id) this diagram belongs to; null = none. */
  @Column({ type: 'varchar', nullable: true })
  slideId!: string | null;

  /** Box background color (hex); null = theme surface. */
  @Column({ type: 'varchar', nullable: true })
  backgroundColor!: string | null;
}
