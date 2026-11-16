import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Security M-1 / S2.1: projects with no owner used to be open to everyone as OWNER.
 * The access policy now grants nothing on an ownerless project (no owner, and its
 * share links stop working), and new projects can no longer be created or imported
 * without an account or guest id.
 *
 * Existing ownerless rows are quarantined, not deleted: they are archived and keep
 * `ownerId = NULL`, so nothing about their content or links is destroyed. An admin
 * can hand one back with `UPDATE projects SET ownerId = '<user id>', archived = 0
 * WHERE id = '<project id>'` (its old share links then work again). Ownerless rows
 * were never listed for anyone, so no user loses a visible project.
 *
 * `down` un-archives the ownerless rows (it cannot tell which were archived before).
 */
export class QuarantineOwnerlessProjects1794100000000 implements MigrationInterface {
  name = 'QuarantineOwnerlessProjects1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "projects" SET "archived" = 1 WHERE "ownerId" IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "projects" SET "archived" = 0 WHERE "ownerId" IS NULL`);
  }
}
