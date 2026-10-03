import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Project } from '../projects/project.entity';

/** A named vertical participant column in a sequence diagram. */
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

  @Column({ type: 'varchar' })
  label!: string;

  @Column({ type: 'varchar', nullable: true })
  color!: string | null;

  @Column({ type: 'float', default: 0 })
  x!: number;

  @Column({ type: 'float', default: 120 })
  width!: number;

  @Column({ type: 'integer', default: 0 })
  order!: number;
}
