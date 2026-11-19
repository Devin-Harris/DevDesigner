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
import { SequenceDiagramEntity } from './sequence-diagram.entity';

/**
 * A sequence-diagram participant (vertical column / lifeline). Belongs to one
 * sequence diagram; deleting that diagram (or the project) cascades to it. The
 * service also deletes any messages referencing a lifeline when it is removed.
 */
@Entity('lifelines')
export class LifelineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project!: Relation<Project>;

  // Nullable so the column can be added to pre-existing rows during dev schema
  // sync; every lifeline the app creates always sets it.
  @Index()
  @Column({ type: 'varchar', nullable: true })
  diagramId!: string;

  @ManyToOne(() => SequenceDiagramEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'diagramId' })
  diagram!: Relation<SequenceDiagramEntity | null>;

  @Column({ type: 'varchar' })
  label!: string;

  @Column({ type: 'varchar', nullable: true })
  color!: string | null;

  @Column({ type: 'varchar', nullable: true })
  lineColor!: string | null;

  /** Header border color; null = no border on a colored header. */
  @Column({ type: 'varchar', nullable: true })
  strokeColor!: string | null;

  /** Header label color; null = automatic (theme text or contrast). */
  @Column({ type: 'varchar', nullable: true })
  textColor!: string | null;

  @Column({ type: 'float', default: 0 })
  x!: number;

  @Column({ type: 'float', default: 120 })
  width!: number;

  @Column({ type: 'integer', default: 0 })
  orderIndex!: number;

  /** Morph tag (`tag:<name>`) pairing this participant across slides; null = matched by label. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  morphId!: string | null;
}
