import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Sequence diagrams, participants and messages get an optional morph tag so a
 * morph transition can pair them across slides by name. In dev this is created by
 * TypeORM synchronize; this is the deploy-safe equivalent.
 */
export class AddSequenceMorphId1792300000000 implements MigrationInterface {
  name = 'AddSequenceMorphId1792300000000';

  private static readonly TABLES = ['sequence_diagrams', 'lifelines', 'sequence_messages'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of AddSequenceMorphId1792300000000.TABLES) {
      await queryRunner.addColumn(
        table,
        new TableColumn({ name: 'morphId', type: 'varchar', length: '100', isNullable: true }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of AddSequenceMorphId1792300000000.TABLES) {
      await queryRunner.dropColumn(table, 'morphId');
    }
  }
}
