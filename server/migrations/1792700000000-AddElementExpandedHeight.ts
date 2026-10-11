import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** Adds `expandedHeight` to elements: a collapsed `code` element's height to restore. */
export class AddElementExpandedHeight1792700000000 implements MigrationInterface {
  name = 'AddElementExpandedHeight1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'expandedHeight', type: 'float', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'expandedHeight');
  }
}
