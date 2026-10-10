import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds the user-defined "home" view (pan offset + zoom) to projects. All three
 * columns null means no home is set. In dev these are created by TypeORM
 * synchronize; this is the deploy-safe equivalent.
 */
export class AddProjectHome1791400000000 implements MigrationInterface {
  name = 'AddProjectHome1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of ['homeX', 'homeY', 'homeZoom']) {
      await queryRunner.addColumn(
        'projects',
        new TableColumn({ name, type: 'float', isNullable: true }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of ['homeZoom', 'homeY', 'homeX']) {
      await queryRunner.dropColumn('projects', name);
    }
  }
}
