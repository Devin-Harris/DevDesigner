import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Rich text on elements: `lineHeight` (multiple of the font size) and `runsJson`
 * (styled runs that concatenate to `text`) and `wrap` (fixed-width text). In dev these are created by TypeORM
 * synchronize; this is the deploy-safe equivalent.
 */
export class AddElementRichText1792000000000 implements MigrationInterface {
  name = 'AddElementRichText1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'lineHeight', type: 'float', isNullable: true }),
    );
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'runsJson', type: 'text', isNullable: true }),
    );
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'wrap', type: 'boolean', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'wrap');
    await queryRunner.dropColumn('elements', 'runsJson');
    await queryRunner.dropColumn('elements', 'lineHeight');
  }
}
