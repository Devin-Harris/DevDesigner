import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Project } from '../projects/project.entity';

/** A horizontal message arrow between two lifelines in a sequence diagram. */
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

  @Column({ type: 'varchar' })
  fromLifelineId!: string;

  @Column({ type: 'varchar' })
  toLifelineId!: string;

  @Column({ type: 'text', nullable: true })
  label!: string | null;

  @Column({ type: 'float', default: 0 })
  y!: number;

  @Column({ type: 'varchar', default: 'solid' })
  style!: 'solid' | 'dashed';

  @Column({ type: 'varchar', default: 'forward' })
  direction!: 'forward' | 'reverse';

  @Column({ type: 'varchar', default: 'arrow' })
  arrowhead!: 'arrow' | 'open' | 'none';
}
