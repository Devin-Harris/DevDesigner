import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Rectangles get an optional `ellipticCorners` flag: when set, a large corner radius
 * stretches per axis (oval-ish corners); otherwise it clamps to a pill. In dev this
 * is created by TypeORM synchronize; this is the deploy-safe equivalent.
 */
export class AddElementEllipticCorners1793100000000 implements MigrationInterface {
  name = 'AddElementEllipticCorners1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'ellipticCorners', type: 'boolean', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'ellipticCorners');
  }
}
