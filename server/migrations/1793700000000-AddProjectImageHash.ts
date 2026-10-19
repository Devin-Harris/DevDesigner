import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

/**
 * Content hash on project images so identical uploads / duplicated slides reuse one
 * row instead of storing the bytes again. Existing rows stay null (never matched).
 * In dev this is created by TypeORM synchronize; this is the deploy-safe equivalent.
 */
export class AddProjectImageHash1793700000000 implements MigrationInterface {
  name = 'AddProjectImageHash1793700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn('project_images', new TableColumn({ name: 'sha256', type: 'varchar', isNullable: true }));
    await queryRunner.createIndex(
      'project_images',
      new TableIndex({ name: 'idx_project_images_hash', columnNames: ['projectId', 'sha256'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('project_images', 'idx_project_images_hash');
    await queryRunner.dropColumn('project_images', 'sha256');
  }
}
