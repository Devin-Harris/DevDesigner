import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Slides are stacked in one spot, so a slide's contents are tied to it explicitly:
 * `slideId` (a frame element id) on elements, tables and sequence diagrams. In dev
 * this is created by TypeORM synchronize; this is the deploy-safe equivalent.
 */
export class AddSlideOwnership1791900000000 implements MigrationInterface {
  name = 'AddSlideOwnership1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['elements', 'tables', 'sequence_diagrams']) {
      await queryRunner.addColumn(
        table,
        new TableColumn({ name: 'slideId', type: 'varchar', isNullable: true }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['elements', 'tables', 'sequence_diagrams']) {
      await queryRunner.dropColumn(table, 'slideId');
    }
  }
}
