import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Sequence diagrams get an optional `borderColor` for their box. In dev this is
 * created by TypeORM synchronize; this is the deploy-safe equivalent.
 */
export class AddSequenceDiagramBorderColor1793300000000 implements MigrationInterface {
  name = 'AddSequenceDiagramBorderColor1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'sequence_diagrams',
      new TableColumn({ name: 'borderColor', type: 'varchar', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('sequence_diagrams', 'borderColor');
  }
}
