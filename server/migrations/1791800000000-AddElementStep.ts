import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds slide build steps: `step` on elements is the presentation step the
 * element is revealed on. In dev this is created by TypeORM synchronize; this is
 * the deploy-safe equivalent.
 */
export class AddElementStep1791800000000 implements MigrationInterface {
  name = 'AddElementStep1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'step', type: 'integer', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'step');
  }
}
