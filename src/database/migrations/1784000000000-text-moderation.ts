import { MigrationInterface, QueryRunner } from 'typeorm';

export class TextModeration1784000000000 implements MigrationInterface {
  name = 'TextModeration1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const textModerationColumns = `
      ADD COLUMN IF NOT EXISTS "text_moderation_status" "moderation_status_enum",
      ADD COLUMN IF NOT EXISTS "text_moderation_labels" jsonb,
      ADD COLUMN IF NOT EXISTS "text_moderated_at" TIMESTAMP
    `;

    await queryRunner.query(`
      ALTER TABLE "comments"
      ${textModerationColumns}
    `);

    await queryRunner.query(`
      ALTER TABLE "posts"
      ${textModerationColumns},
      ADD COLUMN IF NOT EXISTS "content_pending" text
    `);

    await queryRunner.query(`
      ALTER TABLE "ads"
      ${textModerationColumns},
      ADD COLUMN IF NOT EXISTS "content_pending" text
    `);

    await queryRunner.query(`
      ALTER TABLE "statuses"
      ${textModerationColumns},
      ADD COLUMN IF NOT EXISTS "content_pending" text
    `);

    await queryRunner.query(`
      ALTER TABLE "thoughts"
      ${textModerationColumns},
      ADD COLUMN IF NOT EXISTS "content_pending" text
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "bio_moderation_status" "moderation_status_enum",
      ADD COLUMN IF NOT EXISTS "bio_moderation_labels" jsonb,
      ADD COLUMN IF NOT EXISTS "bio_moderated_at" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "bio_pending" text
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comments_text_moderation_status"
      ON "comments" ("text_moderation_status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_posts_text_moderation_status"
      ON "posts" ("text_moderation_status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ads_text_moderation_status"
      ON "ads" ("text_moderation_status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_thoughts_text_moderation_status"
      ON "thoughts" ("text_moderation_status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_bio_moderation_status"
      ON "users" ("bio_moderation_status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_users_bio_moderation_status"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_thoughts_text_moderation_status"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_ads_text_moderation_status"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_posts_text_moderation_status"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_comments_text_moderation_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "bio_pending",
      DROP COLUMN IF EXISTS "bio_moderated_at",
      DROP COLUMN IF EXISTS "bio_moderation_labels",
      DROP COLUMN IF EXISTS "bio_moderation_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "thoughts"
      DROP COLUMN IF EXISTS "content_pending",
      DROP COLUMN IF EXISTS "text_moderated_at",
      DROP COLUMN IF EXISTS "text_moderation_labels",
      DROP COLUMN IF EXISTS "text_moderation_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "statuses"
      DROP COLUMN IF EXISTS "content_pending",
      DROP COLUMN IF EXISTS "text_moderated_at",
      DROP COLUMN IF EXISTS "text_moderation_labels",
      DROP COLUMN IF EXISTS "text_moderation_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "ads"
      DROP COLUMN IF EXISTS "content_pending",
      DROP COLUMN IF EXISTS "text_moderated_at",
      DROP COLUMN IF EXISTS "text_moderation_labels",
      DROP COLUMN IF EXISTS "text_moderation_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "posts"
      DROP COLUMN IF EXISTS "content_pending",
      DROP COLUMN IF EXISTS "text_moderated_at",
      DROP COLUMN IF EXISTS "text_moderation_labels",
      DROP COLUMN IF EXISTS "text_moderation_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "comments"
      DROP COLUMN IF EXISTS "text_moderated_at",
      DROP COLUMN IF EXISTS "text_moderation_labels",
      DROP COLUMN IF EXISTS "text_moderation_status"
    `);
  }
}
