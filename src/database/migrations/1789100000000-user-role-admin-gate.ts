import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Staff rank moves to admin_memberships. users.role stays a door:
 * user or admin. Existing super_admin rows become admin after a
 * super_admin membership exists. The Postgres enum label is left in
 * place so old tokens and the column type do not need a rewrite.
 */
export class UserRoleAdminGate1789100000000 implements MigrationInterface {
  name = 'UserRoleAdminGate1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "admin_memberships" AS m
      SET
        "user_id" = u.id,
        "email" = LOWER(u.email),
        "role" = 'super_admin',
        "status" = 'active',
        "accepted_at" = COALESCE(m.accepted_at, now()),
        "updated_at" = now()
      FROM "users" AS u
      WHERE u.role = 'super_admin'
        AND LOWER(m.email) = LOWER(u.email)
        AND m.status IN ('pending', 'active')
    `);

    await queryRunner.query(`
      INSERT INTO "admin_memberships" (
        "email",
        "user_id",
        "role",
        "status",
        "accepted_at",
        "last_active_at",
        "two_factor_enabled"
      )
      SELECT
        LOWER(u.email),
        u.id,
        'super_admin',
        'active',
        now(),
        now(),
        false
      FROM "users" AS u
      WHERE u.role = 'super_admin'
        AND u.email IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "admin_memberships" AS m
          WHERE m.user_id = u.id
            AND m.status = 'active'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "admin_memberships" AS m
          WHERE LOWER(m.email) = LOWER(u.email)
            AND m.status IN ('pending', 'active')
        )
    `);

    await queryRunner.query(`
      UPDATE "users"
      SET "role" = 'admin'
      WHERE "role" = 'super_admin'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "users" AS u
      SET "role" = 'super_admin'
      FROM "admin_memberships" AS m
      WHERE m.user_id = u.id
        AND m.role = 'super_admin'
        AND m.status = 'active'
        AND u.role = 'admin'
    `);
  }
}
