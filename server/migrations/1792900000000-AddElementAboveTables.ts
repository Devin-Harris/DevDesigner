import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Elements get an optional `aboveTables` flag so a shape brought to the front can
 * draw over the ERD table nodes. In dev this is created by TypeORM synchronize; this
 * is the deploy-safe equivalent.
 */
export class AddElementAboveTables1792900000000 implements MigrationInterface {
  name = 'AddElementAboveTables1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'aboveTables', type: 'boolean', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'aboveTables');
  }
}
