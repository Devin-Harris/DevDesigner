import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Sequence diagrams take part in front/back ordering with drawing elements.
 * In dev this is created by TypeORM synchronize; this is the deploy-safe equivalent.
 */
export class AddSequenceZIndex1792100000000 implements MigrationInterface {
  name = 'AddSequenceZIndex1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'sequence_diagrams',
      new TableColumn({ name: 'zIndex', type: 'float', default: -1 }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('sequence_diagrams', 'zIndex');
  }
}
