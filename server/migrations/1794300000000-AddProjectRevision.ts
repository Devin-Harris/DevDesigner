import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Persisted graph revision on projects (perf P3.4): the graph ETag survives
 * restarts and the Projects list gets a "content changed" signal. Synchronize
 * creates it in dev and the current prod deploy; this is the deploy-safe equivalent.
 */
export class AddProjectRevision1794300000000 implements MigrationInterface {
  name = 'AddProjectRevision1794300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn('projects', new TableColumn({ name: 'revision', type: 'integer', default: 0 }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('projects', 'revision');
  }
}
