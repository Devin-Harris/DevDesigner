import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity';
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
  project!: Project;

  // Nullable so the column can be added to pre-existing rows during dev schema
  // sync; every lifeline the app creates always sets it.
  @Index()
  @Column({ type: 'varchar', nullable: true })
  diagramId!: string;

  @ManyToOne(() => SequenceDiagramEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'diagramId' })
  diagram!: SequenceDiagramEntity | null;

  @Column({ type: 'varchar' })
  label!: string;

  @Column({ type: 'varchar', nullable: true })
  color!: string | null;

  @Column({ type: 'float', default: 0 })
  x!: number;

  @Column({ type: 'float', default: 120 })
  width!: number;

  @Column({ type: 'integer', default: 0 })
  orderIndex!: number;
}
