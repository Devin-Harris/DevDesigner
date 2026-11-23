import { MigrationInterface, QueryRunner } from 'typeorm';

/** "Shared with me": share links a signed-in user has opened (see SharedProjectVisit). */
export class AddSharedProjectVisits1795600000000 implements MigrationInterface {
  name = 'AddSharedProjectVisits1795600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("CREATE TABLE \"shared_project_visits\" (\"id\" varchar PRIMARY KEY NOT NULL, \"userId\" varchar NOT NULL, \"shareLinkId\" varchar NOT NULL, \"tokenSealed\" text NOT NULL, \"lastOpenedAt\" datetime NOT NULL, CONSTRAINT \"FK_af97a794727ddbdbc4728d0faec\" FOREIGN KEY (\"shareLinkId\") REFERENCES \"share_links\" (\"id\") ON DELETE CASCADE ON UPDATE NO ACTION)");
    await queryRunner.query("CREATE INDEX \"IDX_3abbc34767168de86c919d123f\" ON \"shared_project_visits\" (\"userId\") ");
    await queryRunner.query("CREATE UNIQUE INDEX \"uq_shared_project_visits_user_link\" ON \"shared_project_visits\" (\"userId\", \"shareLinkId\") ");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP INDEX \"uq_shared_project_visits_user_link\"");
    await queryRunner.query("DROP INDEX \"IDX_3abbc34767168de86c919d123f\"");
    await queryRunner.query("DROP TABLE \"shared_project_visits\"");
  }
}
