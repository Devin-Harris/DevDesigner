import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Sequence diagrams get an optional title. In dev this is created by TypeORM
 * synchronize; this is the deploy-safe equivalent.
 */
export class AddSequenceTitle1792200000000 implements MigrationInterface {
  name = 'AddSequenceTitle1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'sequence_diagrams',
      new TableColumn({ name: 'title', type: 'varchar', length: '200', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('sequence_diagrams', 'title');
  }
}
