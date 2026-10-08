import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `backgroundColor` to sequence diagrams (box fill, hex). Null means the
 * theme surface. In dev this is created by TypeORM synchronize.
 */
export class AddSequenceBackground1791200000000 implements MigrationInterface {
  name = 'AddSequenceBackground1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'sequence_diagrams',
      new TableColumn({ name: 'backgroundColor', type: 'varchar', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('sequence_diagrams', 'backgroundColor');
  }
}
