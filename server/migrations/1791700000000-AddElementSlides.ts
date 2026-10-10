import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds presentation mode: `slideJson` on frame elements holds the slide config
 * (sequence order, transition, notes) and `morphId` links copies for the morph
 * transition. In dev these are created by TypeORM synchronize; this is the
 * deploy-safe equivalent.
 */
export class AddElementSlides1791700000000 implements MigrationInterface {
  name = 'AddElementSlides1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('elements', [
      new TableColumn({ name: 'slideJson', type: 'text', isNullable: true }),
      new TableColumn({ name: 'morphId', type: 'varchar', isNullable: true }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'morphId');
    await queryRunner.dropColumn('elements', 'slideJson');
  }
}
