import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Byte size on project images, summed by the media quotas (security S3.2). Existing
 * rows are backfilled from the stored blob. In dev (and the current prod deploy)
 * synchronize adds the column and ImagesService backfills it on boot; this is the
 * deploy-safe equivalent.
 */
export class AddProjectImageByteSize1794200000000 implements MigrationInterface {
  name = 'AddProjectImageByteSize1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn('project_images', new TableColumn({ name: 'byteSize', type: 'integer', isNullable: true }));
    await queryRunner.query('UPDATE project_images SET byteSize = LENGTH(data) WHERE byteSize IS NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('project_images', 'byteSize');
  }
}
