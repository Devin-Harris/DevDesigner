import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type {
  ArrowheadType,
  CodeLanguage,
  ElementType,
  FillStyle,
  StrokeStyle,
  TextAlign,
  VerticalAlign,
} from '@dbdesigner/shared';
import { Project } from '../projects/project.entity';

/**
 * A free-form drawing element on the canvas: the excalidraw-style layer that sits
 * alongside the ERD (shapes, lines/arrows, freehand strokes, text). Stored in its
 * own table, separate from ERD `tables`. Scalar fields are real columns; only the
 * variable-length vertex array lives in `pointsJson` (the same technique the
 * relationships table uses for `waypointsJson`). Deleting the parent project
 * cascades to its elements.
 */
@Entity('elements')
export class ElementEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project!: Project;

  // Stored as varchar, typed in code against the shared ElementType union.
  @Column({ type: 'varchar' })
  type!: ElementType;

  @Column({ type: 'float', default: 0 })
  x!: number;

  @Column({ type: 'float', default: 0 })
  y!: number;

  @Column({ type: 'float', default: 0 })
  width!: number;

  @Column({ type: 'float', default: 0 })
  height!: number;

  @Column({ type: 'float', default: 0 })
  angle!: number;

  @Column({ type: 'varchar' })
  strokeColor!: string;

  @Column({ type: 'varchar', nullable: true })
  backgroundColor!: string | null;

  @Column({ type: 'varchar' })
  fillStyle!: FillStyle;

  @Column({ type: 'float', default: 2 })
  strokeWidth!: number;

  @Column({ type: 'varchar' })
  strokeStyle!: StrokeStyle;

  @Column({ type: 'float', default: 100 })
  opacity!: number;

  @Column({ type: 'integer', default: 0 })
  zIndex!: number;

  // Rectangle corner radius override (px); null = auto.
  @Column({ type: 'float', nullable: true })
  cornerRadius!: number | null;

  // JSON-encoded PointModel[] for line/arrow/freedraw vertices, relative to x/y.
  @Column({ type: 'text', nullable: true })
  pointsJson!: string | null;

  @Column({ type: 'text', nullable: true })
  text!: string | null;

  @Column({ type: 'float', nullable: true })
  fontSize!: number | null;

  @Column({ type: 'varchar', nullable: true })
  fontFamily!: string | null;

  @Column({ type: 'boolean', nullable: true })
  bold!: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  italic!: boolean | null;

  @Column({ type: 'varchar', nullable: true })
  textAlign!: TextAlign | null;

  @Column({ type: 'varchar', nullable: true })
  verticalAlign!: VerticalAlign | null;

  // Line/arrow endpoint bindings, split into kind + target id (see ElementBinding).
  @Column({ type: 'varchar', nullable: true })
  startBindingKind!: 'element' | 'table' | 'message' | null;

  @Column({ type: 'varchar', nullable: true })
  startBindingId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  endBindingKind!: 'element' | 'table' | 'message' | null;

  @Column({ type: 'varchar', nullable: true })
  endBindingId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  startArrowhead!: ArrowheadType | null;

  @Column({ type: 'varchar', nullable: true })
  endArrowhead!: ArrowheadType | null;

  // Line/arrow curve bend (px, perpendicular offset of the midpoint); null = straight.
  @Column({ type: 'float', nullable: true })
  curvature!: number | null;

  /** Image elements: id of the ProjectImageEntity this element displays. */
  @Column({ type: 'varchar', nullable: true })
  fileId!: string | null;

  /** Code elements: the highlight language of `text`. */
  @Column({ type: 'varchar', nullable: true })
  language!: CodeLanguage | null;

  /** Group membership (shared id across tables/elements/diagrams); null = ungrouped. */
  @Column({ type: 'varchar', nullable: true })
  groupId!: string | null;

  /** Frame elements: JSON-encoded SlideConfig (sequence order, transition, notes); null = not a slide. */
  @Column({ type: 'text', nullable: true })
  slideJson!: string | null;

  /** Morph lineage shared with the element this was copied from; null = its own id. */
  @Column({ type: 'varchar', nullable: true })
  morphId!: string | null;

  /** Build step the element is revealed on while presenting; null = always visible. */
  @Column({ type: 'integer', nullable: true })
  step!: number | null;
}
