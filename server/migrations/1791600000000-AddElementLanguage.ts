import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds code-block elements: `language` on elements holds the highlight language
 * of a `code` element's `text`. In dev this is created by TypeORM synchronize;
 * this is the deploy-safe equivalent.
 */
export class AddElementLanguage1791600000000 implements MigrationInterface {
  name = 'AddElementLanguage1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'language', type: 'varchar', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'language');
  }
}
