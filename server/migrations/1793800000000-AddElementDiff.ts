import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** Adds `diffText` / `diffView` to elements: a code block's diff (changed side + view mode). */
export class AddElementDiff1793800000000 implements MigrationInterface {
  name = 'AddElementDiff1793800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('elements', [
      new TableColumn({ name: 'diffText', type: 'text', isNullable: true }),
      new TableColumn({ name: 'diffView', type: 'varchar', length: '10', isNullable: true }),
      new TableColumn({ name: 'diffSplit', type: 'float', isNullable: true }),
      new TableColumn({ name: 'diffShowWhitespace', type: 'boolean', isNullable: true }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'diffShowWhitespace');
    await queryRunner.dropColumn('elements', 'diffSplit');
    await queryRunner.dropColumn('elements', 'diffView');
    await queryRunner.dropColumn('elements', 'diffText');
  }
}
