import { MigrationInterface, QueryRunner } from 'typeorm';

/** API tokens can expire and be limited to one project (both optional). */
export class AddApiTokenExpiryAndProject1795100000000 implements MigrationInterface {
  name = 'AddApiTokenExpiryAndProject1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "api_tokens" ADD COLUMN "expiresAt" datetime');
    await queryRunner.query('ALTER TABLE "api_tokens" ADD COLUMN "projectId" varchar');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "api_tokens" DROP COLUMN "projectId"');
    await queryRunner.query('ALTER TABLE "api_tokens" DROP COLUMN "expiresAt"');
  }
}
