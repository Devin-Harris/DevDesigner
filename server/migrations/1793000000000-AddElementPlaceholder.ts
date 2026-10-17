import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Slide layouts: `placeholderJson` (a PlaceholderConfig) marks a layout's text box
 * slot, or a slide's copy of one. In dev this is created by TypeORM synchronize;
 * this is the deploy-safe equivalent.
 */
export class AddElementPlaceholder1793000000000 implements MigrationInterface {
  name = 'AddElementPlaceholder1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'placeholderJson', type: 'text', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'placeholderJson');
  }
}
