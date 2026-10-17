import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Personal theme libraries ("My themes"): `user_themes`, one row per saved theme. In
 * dev this is created by TypeORM synchronize; this is the deploy-safe equivalent.
 */
export class AddUserThemes1793500000000 implements MigrationInterface {
  name = 'AddUserThemes1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'user_themes',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'ownerId', type: 'varchar' },
          { name: 'themeJson', type: 'text' },
          { name: 'createdAt', type: 'datetime', default: "(datetime('now'))" },
        ],
      }),
    );
    await queryRunner.createIndex(
      'user_themes',
      new TableIndex({ name: 'idx_user_themes_owner', columnNames: ['ownerId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('user_themes');
  }
}
