import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { SequenceMessageModel } from '@devdesigner/shared';
import { Project } from '../../projects/project.entity';
import { SequenceDiagramEntity } from './sequence-diagram.entity';

/**
 * A horizontal message (row) between two lifelines. References lifelines by id
 * rather than FK so a lifeline delete is handled explicitly by the service
 * (removing its messages). Belongs to one diagram; cascades from the diagram
 * (and the parent project).
 */
@Entity('sequence_messages')
export class SequenceMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project!: Project;

  // Nullable so the column can be added to pre-existing rows during dev schema
  // sync; every message the app creates always sets it.
  @Index()
  @Column({ type: 'varchar', nullable: true })
  diagramId!: string;

  @ManyToOne(() => SequenceDiagramEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'diagramId' })
  diagram!: SequenceDiagramEntity | null;

  @Column({ type: 'varchar' })
  fromLifelineId!: string;

  @Column({ type: 'varchar' })
  toLifelineId!: string;

  @Column({ type: 'varchar', nullable: true })
  label!: string | null;

  @Column({ type: 'float', default: 0 })
  y!: number;

  @Column({ type: 'varchar', default: 'solid' })
  style!: SequenceMessageModel['style'];

  @Column({ type: 'varchar', default: 'forward' })
  direction!: SequenceMessageModel['direction'];

  @Column({ type: 'varchar', default: 'arrow' })
  arrowhead!: SequenceMessageModel['arrowhead'];

  @Column({ type: 'varchar', nullable: true })
  color!: string | null;

  /** Wrap the label to the message span (null = no wrapping). */
  @Column({ type: 'boolean', nullable: true })
  wrap!: boolean | null;

  /** Morph tag (`tag:<name>`) pairing this message across slides; null = matched by wording. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  morphId!: string | null;
}
