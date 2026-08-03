import { MigrationInterface, QueryRunner } from 'typeorm';

export class AbuseReports1786000000000 implements MigrationInterface {
  name = 'AbuseReports1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "abuse_report_type_enum" AS ENUM (
          'abuse', 'harassment', 'impersonation', 'stage_misconduct', 'scam'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "abuse_report_severity_enum" AS ENUM (
          'critical', 'high', 'medium', 'low'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "abuse_report_status_enum" AS ENUM (
          'open', 'in_review', 'escalated', 'resolved'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "abuse_report_resolution_outcome_enum" AS ENUM (
          'violation_action_taken',
          'violation_warning',
          'dismissed',
          'escalated_further'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE SEQUENCE IF NOT EXISTS "abuse_report_public_id_seq" START 4800
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "abuse_reports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "public_id" text NOT NULL,
        "reporter_id" uuid NOT NULL,
        "reported_user_id" uuid NOT NULL,
        "type" "abuse_report_type_enum" NOT NULL,
        "severity" "abuse_report_severity_enum" NOT NULL DEFAULT 'medium',
        "status" "abuse_report_status_enum" NOT NULL DEFAULT 'open',
        "summary" text NOT NULL,
        "description" text NOT NULL,
        "assignee_id" uuid,
        "live_stream_id" uuid,
        "room_key" text,
        "viewer_count" int,
        "recording_saved" boolean,
        "evidence_urls" jsonb,
        "resolution_outcome" "abuse_report_resolution_outcome_enum",
        "resolution_notes" text,
        "resolved_at" TIMESTAMPTZ,
        "resolved_by_id" uuid,
        "sla_deadline" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_abuse_reports" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_abuse_reports_public_id" UNIQUE ("public_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_abuse_reports_status" ON "abuse_reports" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_abuse_reports_type" ON "abuse_reports" ("type")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_abuse_reports_assignee_id" ON "abuse_reports" ("assignee_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_abuse_reports_reported_user_id" ON "abuse_reports" ("reported_user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_abuse_reports_created_at" ON "abuse_reports" ("created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_abuse_reports_status_sla" ON "abuse_reports" ("status", "sla_deadline")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "abuse_report_notes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "report_id" uuid NOT NULL,
        "author_id" uuid,
        "body" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_abuse_report_notes" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_abuse_report_notes_report_id"
        ON "abuse_report_notes" ("report_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_abuse_report_notes_report_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "abuse_report_notes"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_abuse_reports_status_sla"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_abuse_reports_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_abuse_reports_reported_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_abuse_reports_assignee_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_abuse_reports_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_abuse_reports_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "abuse_reports"`);
    await queryRunner.query(
      `DROP SEQUENCE IF EXISTS "abuse_report_public_id_seq"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "abuse_report_resolution_outcome_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "abuse_report_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "abuse_report_severity_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "abuse_report_type_enum"`);
  }
}
