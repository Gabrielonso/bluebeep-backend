import { MigrationInterface, QueryRunner } from 'typeorm';

export class AbuseReportContentTarget1788000000000
  implements MigrationInterface
{
  name = 'AbuseReportContentTarget1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "abuse_report_target_type_enum" AS ENUM (
          'post',
          'comment',
          'thought',
          'status',
          'live_stream',
          'chat_message',
          'ad'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "abuse_reports"
      ADD COLUMN IF NOT EXISTS "target_type" "abuse_report_target_type_enum"
    `);

    await queryRunner.query(`
      ALTER TABLE "abuse_reports"
      ADD COLUMN IF NOT EXISTS "target_id" uuid
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_abuse_reports_target"
        ON "abuse_reports" ("target_type", "target_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_abuse_reports_target"`);
    await queryRunner.query(
      `ALTER TABLE "abuse_reports" DROP COLUMN IF EXISTS "target_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "abuse_reports" DROP COLUMN IF EXISTS "target_type"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "abuse_report_target_type_enum"`,
    );
  }
}
