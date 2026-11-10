import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Media out of SQLite (perf P4.5 / security S4.4): `project_images.data` becomes
 * nullable and `location` says where the bytes are ('db' = legacy blob, 'media' =
 * the content-addressed media store by sha256). Existing rows stay 'db' and are
 * moved lazily on first read or by `npm run media:migrate -w server`; the schema
 * change itself never deletes a blob. Synchronize applies the same change in dev
 * and the current prod deploy; this is the deploy-safe equivalent.
 */
export class MoveMediaOutOfSqlite1794400000000 implements MigrationInterface {
  name = 'MoveMediaOutOfSqlite1794400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'project_images',
      new TableColumn({ name: 'location', type: 'varchar', default: "'db'" }),
    );
    await queryRunner.changeColumn(
      'project_images',
      'data',
      new TableColumn({ name: 'data', type: 'blob', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only reversible while every row still has its blob (run before moving any media).
    const moved = await queryRunner.query(`SELECT COUNT(*) AS n FROM project_images WHERE data IS NULL`);
    if (Number(moved[0]?.n ?? 0) > 0) {
      throw new Error('Some images live only in the media store; copy them back before reverting.');
    }
    await queryRunner.changeColumn(
      'project_images',
      'data',
      new TableColumn({ name: 'data', type: 'blob', isNullable: false }),
    );
    await queryRunner.dropColumn('project_images', 'location');
  }
}
