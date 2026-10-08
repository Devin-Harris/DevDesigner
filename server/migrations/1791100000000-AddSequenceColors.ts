import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `lineColor` to lifelines (spine color) and `color` to sequence messages
 * (line + arrowhead color). Null means the theme's connector color. In dev these
 * columns are created by TypeORM synchronize; this is the deploy-safe equivalent.
 */
export class AddSequenceColors1791100000000 implements MigrationInterface {
  name = 'AddSequenceColors1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'lifelines',
      new TableColumn({ name: 'lineColor', type: 'varchar', isNullable: true }),
    );
    await queryRunner.addColumn(
      'sequence_messages',
      new TableColumn({ name: 'color', type: 'varchar', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('sequence_messages', 'color');
    await queryRunner.dropColumn('lifelines', 'lineColor');
  }
}
