import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TableEntity } from '../tables/table.entity';

/**
 * A column belonging to a table. The data type is stored as real columns
 * (dataTypeName / dataTypeLength / dataTypeArgs) rather than a JSON blob, mapped
 * in code to the shared DataType (BUILD_INSTRUCTIONS.md section 4.1). Deleting
 * the parent table cascades to its columns.
 */
@Entity('columns')
export class ColumnEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  tableId!: string;

  @ManyToOne(() => TableEntity, (table) => table.columns, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tableId' })
  table!: TableEntity;

  @Column({ type: 'varchar' })
  name!: string;

  // Data type split into queryable columns.
  @Column({ type: 'varchar' })
  dataTypeName!: string;

  @Column({ type: 'integer', nullable: true })
  dataTypeLength!: number | null;

  // JSON-encoded string[] for ENUM values / DECIMAL(p,s) args.
  @Column({ type: 'varchar', nullable: true })
  dataTypeArgs!: string | null;

  @Column({ type: 'boolean', default: false })
  isPrimaryKey!: boolean;

  @Column({ type: 'boolean', default: true })
  isNullable!: boolean;

  @Column({ type: 'boolean', default: false })
  isUnique!: boolean;

  @Column({ type: 'boolean', default: false })
  isAutoIncrement!: boolean;

  @Column({ type: 'boolean', default: false })
  isUnsigned!: boolean;

  @Column({ type: 'varchar', nullable: true })
  defaultValue!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'integer', default: 0 })
  orderIndex!: number;
}
