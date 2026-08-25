import { MigrationInterface, QueryRunner } from 'typeorm';

export class AppleSignIn1787000000000 implements MigrationInterface {
  name = 'AppleSignIn1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add 'apple' to created_with enum (TypeORM default name for UserCreateOptions on users.created_with)
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "users_created_with_enum" ADD VALUE IF NOT EXISTS 'apple';
      EXCEPTION
        WHEN undefined_object THEN
          -- Enum type name may differ across environments; try common alternate
          BEGIN
            ALTER TYPE "user_created_with_enum" ADD VALUE IF NOT EXISTS 'apple';
          EXCEPTION
            WHEN undefined_object THEN null;
            WHEN duplicate_object THEN null;
          END;
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "apple_id" text
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "users"
        ADD CONSTRAINT "UQ_users_apple_id" UNIQUE ("apple_id");
      EXCEPTION
        WHEN duplicate_object THEN null;
        WHEN duplicate_table THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_users_apple_id" ON "users" ("apple_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_apple_id"`);
    await queryRunner.query(`
      ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "UQ_users_apple_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "apple_id"
    `);
    // PostgreSQL cannot easily remove enum values; leave 'apple' in the type.
  }
}
