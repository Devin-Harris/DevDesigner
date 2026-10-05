import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `width` to tables: a manual width override (px) so a table can be stretched
 * or squeezed to fit a frame. Null means auto-fit to content. In dev this column
 * is created by TypeORM synchronize; this migration is the deploy-safe equivalent.
 */
export class AddTableWidth1790900000000 implements MigrationInterface {
  name = 'AddTableWidth1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'tables',
      new TableColumn({ name: 'width', type: 'float', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('tables', 'width');
  }
}
