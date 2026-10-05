import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `groupId` to tables, elements and sequence diagrams: members of one group
 * share the same id (null = ungrouped). In dev these columns are created by
 * TypeORM synchronize; this migration is the deploy-safe equivalent.
 */
export class AddGroupId1791000000000 implements MigrationInterface {
  name = 'AddGroupId1791000000000';

  private static readonly TABLES = ['tables', 'elements', 'sequence_diagrams'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of AddGroupId1791000000000.TABLES) {
      await queryRunner.addColumn(
        table,
        new TableColumn({ name: 'groupId', type: 'varchar', isNullable: true }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of AddGroupId1791000000000.TABLES) {
      await queryRunner.dropColumn(table, 'groupId');
    }
  }
}
