import { MigrationInterface, QueryRunner } from 'typeorm';

/** Rectangles can round each corner separately. */
export class AddCornerRadii1795500000000 implements MigrationInterface {
  name = 'AddCornerRadii1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "elements" ADD COLUMN "cornerRadiiJson" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "elements" DROP COLUMN "cornerRadiiJson"`);
  }
}
