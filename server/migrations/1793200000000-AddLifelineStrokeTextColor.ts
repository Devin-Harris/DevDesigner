import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Sequence participants get optional header `strokeColor` (border) and `textColor`
 * (label) overrides. In dev this is created by TypeORM synchronize; this is the
 * deploy-safe equivalent.
 */
export class AddLifelineStrokeTextColor1793200000000 implements MigrationInterface {
  name = 'AddLifelineStrokeTextColor1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('lifelines', [
      new TableColumn({ name: 'strokeColor', type: 'varchar', isNullable: true }),
      new TableColumn({ name: 'textColor', type: 'varchar', isNullable: true }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('lifelines', 'textColor');
    await queryRunner.dropColumn('lifelines', 'strokeColor');
  }
}
