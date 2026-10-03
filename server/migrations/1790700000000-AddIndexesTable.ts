import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Creates the `indexes` table: named secondary indexes on a table, over one or
 * more columns (ids stored as JSON in `columnIdsJson`). Mirrors the `columns`
 * table's shape (tableId FK with cascade delete, orderIndex for ordering). In
 * dev these are created by TypeORM synchronize; this migration is the
 * deploy-safe equivalent.
 */
export class AddIndexesTable1790700000000 implements MigrationInterface {
  name = 'AddIndexesTable1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'indexes',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'tableId', type: 'varchar', isNullable: false },
          { name: 'name', type: 'varchar', isNullable: false },
          { name: 'columnIdsJson', type: 'text', isNullable: false },
          { name: 'isUnique', type: 'boolean', isNullable: false, default: 0 },
          { name: 'orderIndex', type: 'integer', isNullable: false, default: 0 },
        ],
        foreignKeys: [
          {
            columnNames: ['tableId'],
            referencedTableName: 'tables',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'indexes',
      new TableIndex({ name: 'IDX_indexes_tableId', columnNames: ['tableId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('indexes');
  }
}
