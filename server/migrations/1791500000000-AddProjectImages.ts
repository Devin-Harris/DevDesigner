import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

/**
 * Adds image elements: the `project_images` table holding uploaded files, and
 * `fileId` on elements to reference one. In dev these are created by TypeORM
 * synchronize; this is the deploy-safe equivalent.
 */
export class AddProjectImages1791500000000 implements MigrationInterface {
  name = 'AddProjectImages1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'project_images',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'projectId', type: 'varchar' },
          { name: 'mimeType', type: 'varchar' },
          { name: 'data', type: 'blob' },
          { name: 'createdAt', type: 'datetime', default: "(datetime('now'))" },
        ],
      }),
    );
    await queryRunner.createIndex(
      'project_images',
      new TableIndex({ name: 'IDX_project_images_projectId', columnNames: ['projectId'] }),
    );
    await queryRunner.createForeignKey(
      'project_images',
      new TableForeignKey({
        columnNames: ['projectId'],
        referencedTableName: 'projects',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'fileId', type: 'varchar', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'fileId');
    await queryRunner.dropTable('project_images');
  }
}
