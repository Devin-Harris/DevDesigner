import { MigrationInterface, QueryRunner } from 'typeorm';

/** Sequence diagrams can have a box larger than their content (plain resize). */
export class AddSequenceBounds1795200000000 implements MigrationInterface {
  name = 'AddSequenceBounds1795200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const col of ['padLeft', 'padTop', 'boxWidth', 'boxHeight']) {
      await queryRunner.query(`ALTER TABLE "sequence_diagrams" ADD COLUMN "${col}" float`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const col of ['boxHeight', 'boxWidth', 'padTop', 'padLeft']) {
      await queryRunner.query(`ALTER TABLE "sequence_diagrams" DROP COLUMN "${col}"`);
    }
  }
}
