import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `scale` to tables: a uniform display scale set by dragging the corners of
 * the table's selection box. Null means natural size (1). In dev this column is
 * created by TypeORM synchronize; this migration is the deploy-safe equivalent.
 */
export class AddTableScale1792500000000 implements MigrationInterface {
  name = 'AddTableScale1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'tables',
      new TableColumn({ name: 'scale', type: 'float', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('tables', 'scale');
  }
}
