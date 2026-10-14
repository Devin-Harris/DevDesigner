import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Tables get an optional morph tag so a morph transition can pair them across slides
 * by tag instead of by name. In dev this is created by TypeORM synchronize; this is
 * the deploy-safe equivalent.
 */
export class AddTableMorphId1792800000000 implements MigrationInterface {
  name = 'AddTableMorphId1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'tables',
      new TableColumn({ name: 'morphId', type: 'varchar', length: '100', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('tables', 'morphId');
  }
}
