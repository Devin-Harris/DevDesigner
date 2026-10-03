import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds bespoke styling fields to canvas elements: `cornerRadius` (rectangle
 * corner override, px) and `bold` / `italic` (text/label weight + slant). All
 * nullable — null means "auto"/off. In dev these columns are created by TypeORM
 * synchronize; this migration is the deploy-safe equivalent.
 */
export class AddElementStyleFields1790600000000 implements MigrationInterface {
  name = 'AddElementStyleFields1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'cornerRadius', type: 'float', isNullable: true }),
    );
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'bold', type: 'boolean', isNullable: true }),
    );
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'italic', type: 'boolean', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'italic');
    await queryRunner.dropColumn('elements', 'bold');
    await queryRunner.dropColumn('elements', 'cornerRadius');
  }
}
