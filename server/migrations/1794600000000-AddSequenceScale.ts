import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Sequence diagrams get a `scale`: their text, arrowheads and label boxes are drawn
 * at this multiple (Ctrl + resize scales a diagram with its content). Null = 1.
 * Synchronize creates it in dev; this is the deploy-safe equivalent.
 */
export class AddSequenceScale1794600000000 implements MigrationInterface {
  name = 'AddSequenceScale1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('sequence_diagrams');
    if (table && !table.findColumnByName('scale')) {
      await queryRunner.addColumn(
        'sequence_diagrams',
        new TableColumn({ name: 'scale', type: 'float', isNullable: true }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('sequence_diagrams', 'scale');
  }
}
