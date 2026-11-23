import { MigrationInterface, QueryRunner } from 'typeorm';

/** Plain frames can scroll content taller than themselves. */
export class AddFrameScrollable1795400000000 implements MigrationInterface {
  name = 'AddFrameScrollable1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "elements" ADD COLUMN "scrollable" boolean`);
    await queryRunner.query(`ALTER TABLE "elements" ADD COLUMN "scrollPadding" float`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "elements" DROP COLUMN "scrollPadding"`);
    await queryRunner.query(`ALTER TABLE "elements" DROP COLUMN "scrollable"`);
  }
}
