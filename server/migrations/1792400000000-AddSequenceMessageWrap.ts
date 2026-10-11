import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Sequence messages get an optional `wrap` flag: when true the label wraps to the
 * message's span. Null/false keeps the label on its explicit lines. In dev this is
 * created by TypeORM synchronize; this is the deploy-safe equivalent.
 */
export class AddSequenceMessageWrap1792400000000 implements MigrationInterface {
  name = 'AddSequenceMessageWrap1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'sequence_messages',
      new TableColumn({ name: 'wrap', type: 'boolean', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('sequence_messages', 'wrap');
  }
}
