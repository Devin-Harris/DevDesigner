import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `curvature` to canvas elements: the perpendicular offset (px) of a
 * curved line/arrow's midpoint from its chord. Null means straight. In dev this
 * column is created by TypeORM synchronize; this is the deploy-safe equivalent.
 */
export class AddElementCurvature1791300000000 implements MigrationInterface {
  name = 'AddElementCurvature1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'curvature', type: 'float', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'curvature');
  }
}
