import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

/**
 * Index behind the Projects list (`ownerId = ? AND archived = ? ORDER BY updatedAt
 * DESC`), which otherwise scans every project. The entity's @Index is the source of
 * truth (dev and the current prod deploy create it via synchronize); this is the
 * deploy-safe equivalent for when synchronize is off.
 */
export class AddProjectOwnerIndex1793900000000 implements MigrationInterface {
  name = 'AddProjectOwnerIndex1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createIndex(
      'projects',
      new TableIndex({
        name: 'idx_projects_owner_archived_updated',
        columnNames: ['ownerId', 'archived', 'updatedAt'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('projects', 'idx_projects_owner_archived_updated');
  }
}
