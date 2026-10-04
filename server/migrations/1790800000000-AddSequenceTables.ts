import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Sequence-diagram persistence: a `lifelines` table (participant columns), a
 * `sequence_messages` table (rows between lifelines), and per-project layout
 * config columns. In dev these are created by TypeORM synchronize; this
 * migration is the deploy-safe equivalent.
 */
export class AddSequenceTables1790800000000 implements MigrationInterface {
  name = 'AddSequenceTables1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "lifelines" (
        "id" varchar PRIMARY KEY NOT NULL,
        "projectId" varchar NOT NULL,
        "label" varchar NOT NULL,
        "color" varchar,
        "x" float NOT NULL DEFAULT (0),
        "width" float NOT NULL DEFAULT (120),
        "orderIndex" integer NOT NULL DEFAULT (0),
        CONSTRAINT "FK_lifelines_project" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_lifelines_projectId" ON "lifelines" ("projectId")`);

    await queryRunner.query(`
      CREATE TABLE "sequence_messages" (
        "id" varchar PRIMARY KEY NOT NULL,
        "projectId" varchar NOT NULL,
        "fromLifelineId" varchar NOT NULL,
        "toLifelineId" varchar NOT NULL,
        "label" varchar,
        "y" float NOT NULL DEFAULT (0),
        "style" varchar NOT NULL DEFAULT ('solid'),
        "direction" varchar NOT NULL DEFAULT ('forward'),
        "arrowhead" varchar NOT NULL DEFAULT ('arrow'),
        CONSTRAINT "FK_sequence_messages_project" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sequence_messages_projectId" ON "sequence_messages" ("projectId")`,
    );

    await queryRunner.addColumns('projects', [
      new TableColumn({ name: 'seqLifelineSpacing', type: 'float', isNullable: false, default: 160 }),
      new TableColumn({ name: 'seqRowSpacing', type: 'float', isNullable: false, default: 48 }),
      new TableColumn({ name: 'seqHeaderHeight', type: 'float', isNullable: false, default: 42 }),
      new TableColumn({ name: 'seqOriginY', type: 'float', isNullable: true }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('projects', 'seqOriginY');
    await queryRunner.dropColumn('projects', 'seqHeaderHeight');
    await queryRunner.dropColumn('projects', 'seqRowSpacing');
    await queryRunner.dropColumn('projects', 'seqLifelineSpacing');
    await queryRunner.query(`DROP TABLE "sequence_messages"`);
    await queryRunner.query(`DROP TABLE "lifelines"`);
  }
}
