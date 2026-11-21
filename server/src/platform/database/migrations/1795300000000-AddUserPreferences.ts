import { MigrationInterface, QueryRunner } from 'typeorm';

/** Editor view preferences (grid snap, smart guides, minimap) stored per account. */
export class AddUserPreferences1795300000000 implements MigrationInterface {
  name = 'AddUserPreferences1795300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "preferences" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "preferences"`);
  }
}
