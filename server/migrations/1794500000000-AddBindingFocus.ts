import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Bound arrow ends can be nudged along their target: `startBindingFocus` /
 * `endBindingFocus` hold "x,y" fractions of the target's box (ElementBinding.focus).
 * Synchronize creates them in dev; this is the deploy-safe equivalent.
 */
export class AddBindingFocus1794500000000 implements MigrationInterface {
  name = 'AddBindingFocus1794500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'startBindingFocus', type: 'varchar', isNullable: true }),
    );
    await queryRunner.addColumn(
      'elements',
      new TableColumn({ name: 'endBindingFocus', type: 'varchar', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('elements', 'endBindingFocus');
    await queryRunner.dropColumn('elements', 'startBindingFocus');
  }
}
