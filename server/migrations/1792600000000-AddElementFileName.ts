import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** Adds `fileName` to elements: the optional file-name title bar of a `code` element. */
export class AddElementFileName1792600000000 implements MigrationInterface {
  name = 'AddElementFileName1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'fileName', type: 'varchar', length: '120', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'fileName');
  }
}
