import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Master overrides: `overrides` on a slide's or layout's element names the master
 * element it replaces there. In dev this is created by TypeORM synchronize; this is
 * the deploy-safe equivalent.
 */
export class AddElementOverrides1793600000000 implements MigrationInterface {
  name = 'AddElementOverrides1793600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn('elements', new TableColumn({ name: 'overrides', type: 'varchar', isNullable: true }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'overrides');
  }
}
