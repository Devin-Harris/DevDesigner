import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { Project } from '../../projects/project.entity';

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
  project!: Relation<Project>;

  @Column({ type: 'float', default: 160 })
  lifelineSpacing!: number;

  @Column({ type: 'float', default: 48 })
  rowSpacing!: number;

  @Column({ type: 'float', default: 42 })
  headerHeight!: number;

  /** Text size multiple (Ctrl + resize); null = 1. */
  @Column({ type: 'float', nullable: true })
  scale!: number | null;

  /** Box bounds beyond the content (plain resize); null = hug the content. */
  @Column({ type: 'float', nullable: true })
  padLeft!: number | null;

  @Column({ type: 'float', nullable: true })
  padTop!: number | null;

  @Column({ type: 'float', nullable: true })
  boxWidth!: number | null;

  @Column({ type: 'float', nullable: true })
  boxHeight!: number | null;

  @Column({ type: 'float', default: 0 })
  originY!: number;

  /** Group membership (shared id across tables/elements/diagrams); null = ungrouped. */
  @Column({ type: 'varchar', nullable: true })
  groupId!: string | null;

  /** The slide (frame element id) this diagram belongs to; null = none. */
  @Column({ type: 'varchar', nullable: true })
  slideId!: string | null;

  /**
   * Stacking order against elements: sits above elements ranked below it. The
   * default (-1) keeps a new diagram under every drawing element.
   */
  @Column({ type: 'float', default: -1 })
  zIndex!: number;

  /** Box background color (hex); null = theme surface. */
  @Column({ type: 'varchar', nullable: true })
  backgroundColor!: string | null;

  /** Diagram box border color; null = theme border. */
  @Column({ type: 'varchar', nullable: true })
  borderColor!: string | null;

  /** Title drawn at the diagram's top-left; null = untitled. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  title!: string | null;

  /** Morph tag (`tag:<name>`) pairing this diagram across slides; null = matched by participants. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  morphId!: string | null;
}
