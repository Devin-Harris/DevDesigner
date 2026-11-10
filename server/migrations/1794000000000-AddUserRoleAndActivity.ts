import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Admin role plus activity timestamps for analytics: `users.role` / `lastLoginAt` /
 * `lastSeenAt`, `projects.lastOpenedAt`, `share_links.lastUsedAt` / `useCount`. The
 * entities are the source of truth (synchronize); this is the deploy-safe equivalent.
 */
export class AddUserRoleAndActivity1794000000000 implements MigrationInterface {
  name = 'AddUserRoleAndActivity1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('users', [
      new TableColumn({ name: 'role', type: 'varchar', length: '16', isNullable: false, default: "'user'" }),
      new TableColumn({ name: 'lastLoginAt', type: 'datetime', isNullable: true }),
      new TableColumn({ name: 'lastSeenAt', type: 'datetime', isNullable: true }),
    ]);
    await queryRunner.addColumn(
      'projects',
      new TableColumn({ name: 'lastOpenedAt', type: 'datetime', isNullable: true }),
    );
    await queryRunner.addColumns('share_links', [
      new TableColumn({ name: 'lastUsedAt', type: 'datetime', isNullable: true }),
      new TableColumn({ name: 'useCount', type: 'integer', isNullable: false, default: 0 }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('share_links', 'useCount');
    await queryRunner.dropColumn('share_links', 'lastUsedAt');
    await queryRunner.dropColumn('projects', 'lastOpenedAt');
    await queryRunner.dropColumn('users', 'lastSeenAt');
    await queryRunner.dropColumn('users', 'lastLoginAt');
    await queryRunner.dropColumn('users', 'role');
  }
}
