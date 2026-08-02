import { MigrationInterface, QueryRunner } from 'typeorm';

export class LiveStreams1785000000000 implements MigrationInterface {
  name = 'LiveStreams1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "live_stream_status_enum" AS ENUM ('scheduled', 'live', 'ended');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "live_streams" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "host_id" uuid NOT NULL,
        "title" text,
        "status" "live_stream_status_enum" NOT NULL DEFAULT 'scheduled',
        "started_at" TIMESTAMP,
        "ended_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_live_streams" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_live_streams_host_id" ON "live_streams" ("host_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_live_streams_status" ON "live_streams" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_live_streams_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_live_streams_host_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "live_streams"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "live_stream_status_enum"`);
  }
}
