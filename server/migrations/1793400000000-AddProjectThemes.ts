import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Projects keep a library of custom presentation themes (`themesJson`). In dev this
 * is created by TypeORM synchronize; this is the deploy-safe equivalent.
 */
export class AddProjectThemes1793400000000 implements MigrationInterface {
  name = 'AddProjectThemes1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'projects',
      new TableColumn({ name: 'themesJson', type: 'text', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('projects', 'themesJson');
  }
}
