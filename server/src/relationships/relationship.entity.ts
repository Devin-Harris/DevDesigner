import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { ConnectorSide, RelationshipType } from '@dbdesigner/shared';
import { Project } from '../projects/project.entity';
import { ColumnEntity } from '../columns/column.entity';

/**
 * A relationship between two columns (BUILD_INSTRUCTIONS.md section 4.1).
 * Deleting either endpoint column, or the parent project, cascades to the
 * relationship so no dangling edges remain.
 */
@Entity('relationships')
export class RelationshipEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project!: Project;

  @Index()
  @Column({ type: 'varchar' })
  sourceColumnId!: string;

  @ManyToOne(() => ColumnEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sourceColumnId' })
  sourceColumn!: ColumnEntity;

  @Index()
  @Column({ type: 'varchar' })
  targetColumnId!: string;

  @ManyToOne(() => ColumnEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'targetColumnId' })
  targetColumn!: ColumnEntity;

  // Stored as varchar, typed in code against the shared RelationshipType union.
  @Column({ type: 'varchar' })
  type!: RelationshipType;

  @Column({ type: 'varchar', nullable: true })
  onDelete!: string | null;

  @Column({ type: 'varchar', nullable: true })
  onUpdate!: string | null;

  // JSON-encoded PointModel[] for manual line routing.
  @Column({ type: 'text', nullable: true })
  waypointsJson!: string | null;

  // Pinned exit/entry sides for manual routing; null lets the router choose.
  @Column({ type: 'varchar', nullable: true })
  sourceSide!: ConnectorSide | null;

  @Column({ type: 'varchar', nullable: true })
  targetSide!: ConnectorSide | null;

  // Null (legacy rows) means auto: best-path routing.
  @Column({ type: 'boolean', nullable: true })
  autoRoute!: boolean | null;
}
