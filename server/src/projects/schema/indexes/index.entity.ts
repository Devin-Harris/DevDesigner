import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { TableEntity } from '../tables/table.entity';

/**
 * A named secondary index on a table, over one or more of its columns. The
 * covered column ids are stored as a JSON-encoded string[] (like element
 * `pointsJson`) rather than a join table, since they are always read/written as
 * a whole set. Deleting the parent table cascades to its indexes.
 */
@Entity('indexes')
export class IndexEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  tableId!: string;

  @ManyToOne(() => TableEntity, (table) => table.indexes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tableId' })
  table!: Relation<TableEntity>;

  @Column({ type: 'varchar' })
  name!: string;

  // JSON-encoded string[] of the covered column ids, in order.
  @Column({ type: 'text' })
  columnIdsJson!: string;

  @Column({ type: 'boolean', default: false })
  isUnique!: boolean;

  @Column({ type: 'integer', default: 0 })
  orderIndex!: number;
}
