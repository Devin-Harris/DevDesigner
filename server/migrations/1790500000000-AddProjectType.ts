import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds the organizational `type` column to projects (ERD / FLOW / SCRATCH).
 * Existing rows default to 'ERD'. In dev the column is created by TypeORM
 * synchronize; this migration is the deploy-safe equivalent.
 */
export class AddProjectType1790500000000 implements MigrationInterface {
  name = 'AddProjectType1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'projects',
      new TableColumn({
        name: 'type',
        type: 'varchar',
        isNullable: false,
        default: "'ERD'",
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('projects', 'type');
  }
}
