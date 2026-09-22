import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminAccess1789000000000 implements MigrationInterface {
  name = 'AdminAccess1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "admin_dashboard_role_enum" AS ENUM (
          'super_admin', 'senior_admin', 'admin', 'read_only'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "admin_membership_status_enum" AS ENUM (
          'pending', 'active', 'revoked'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_memberships" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" text NOT NULL,
        "user_id" uuid,
        "role" "admin_dashboard_role_enum" NOT NULL,
        "status" "admin_membership_status_enum" NOT NULL DEFAULT 'pending',
        "invited_by_id" uuid,
        "invited_at" TIMESTAMPTZ,
        "accepted_at" TIMESTAMPTZ,
        "revoked_at" TIMESTAMPTZ,
        "two_factor_enabled" boolean NOT NULL DEFAULT false,
        "last_active_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_memberships" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_admin_memberships_open_email"
      ON "admin_memberships" ("email")
      WHERE "status" IN ('pending', 'active')
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_admin_memberships_active_user"
      ON "admin_memberships" ("user_id")
      WHERE "status" = 'active' AND "user_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_permissions" (
        "key" text NOT NULL,
        "group" text NOT NULL,
        "label" text NOT NULL,
        "description" text NOT NULL,
        "sort_order" int NOT NULL,
        CONSTRAINT "PK_admin_permissions" PRIMARY KEY ("key")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_role_permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "role" "admin_dashboard_role_enum" NOT NULL,
        "permission_key" text NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_admin_role_permissions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_admin_role_permissions_role_key"
      ON "admin_role_permissions" ("role", "permission_key")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_settings" (
        "id" int NOT NULL,
        "platform_name" text NOT NULL DEFAULT 'Bluebeep',
        "logo_url" text,
        "support_email" text,
        "support_phone" text,
        "email_notifications_enabled" boolean NOT NULL DEFAULT false,
        "push_notifications_enabled" boolean NOT NULL DEFAULT true,
        "sms_notifications_enabled" boolean NOT NULL DEFAULT false,
        "privacy_policy" text NOT NULL DEFAULT '',
        "require_2fa" boolean NOT NULL DEFAULT true,
        "session_timeout_minutes" int NOT NULL DEFAULT 30,
        "ip_allowlist_enabled" boolean NOT NULL DEFAULT false,
        "ip_allowlist" text[] NOT NULL DEFAULT '{}',
        "login_attempt_alerts_enabled" boolean NOT NULL DEFAULT true,
        "notify_high_severity_risk" boolean NOT NULL DEFAULT true,
        "notify_new_dispute" boolean NOT NULL DEFAULT true,
        "notify_payout_digest" boolean NOT NULL DEFAULT true,
        "notify_failed_login" boolean NOT NULL DEFAULT true,
        "notify_weekly_report" boolean NOT NULL DEFAULT false,
        "auto_freeze_wallet_risk_score" int NOT NULL DEFAULT 85,
        "auto_escalate_dispute_above" int NOT NULL DEFAULT 5000,
        "payout_manual_review_threshold" int NOT NULL DEFAULT 10000,
        "gift_ring_detection_window_hours" int NOT NULL DEFAULT 2,
        "updated_by_id" uuid,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_settings" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      INSERT INTO "platform_settings" ("id", "platform_name")
      VALUES (1, 'Bluebeep')
      ON CONFLICT ("id") DO NOTHING
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_audit_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actor_user_id" uuid,
        "actor_membership_id" uuid,
        "action" text NOT NULL,
        "target_type" text,
        "target_id" text,
        "metadata" jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_audit_events" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_audit_events_created_at"
      ON "admin_audit_events" ("created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_audit_events_actor_created"
      ON "admin_audit_events" ("actor_membership_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_audit_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_role_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_memberships"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "admin_membership_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "admin_dashboard_role_enum"`);
  }
}
