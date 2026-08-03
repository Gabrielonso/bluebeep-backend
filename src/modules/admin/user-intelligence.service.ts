import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { successResponse } from 'src/common/helpers/response.helper';
import { TextModerationSurface } from 'src/common/moderation/text-moderation.types';
import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';
import { AccountActivity } from 'src/modules/account-activity/entities/account-activity.entity';
import { User } from '../user/entity/user.entity';
import { UserStatusEnum } from '../user/interfaces/user.interfaces';
import { ADMIN_METRICS_USER_ROLE } from './admin-metrics.constants';
import { AdminRiskService } from './risk/admin-risk.service';
import {
  emptyModerationSignals,
  emptyReportSignals,
  riskProxySqlExpression,
} from './risk/admin-risk.types';
import {
  UserIntelligenceQueryDto,
  UserIntelligenceSort,
  UserIntelligenceTab,
} from './dtos/user-intelligence-query.dto';

type ListRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  email: string;
  userRefId: string | null;
  profilePicture: string | null;
  countryCode: string | null;
  status: string;
  verified: boolean;
  phoneNumber: string | null;
  createdAt: Date;
  riskProxy: number;
  pendingTotal: number;
  rejectedTotal: number;
  openReports: number;
};

@Injectable()
export class UserIntelligenceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly riskService: AdminRiskService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(AccountActivity)
    private readonly activityRepo: Repository<AccountActivity>,
  ) {}

  async getSummary() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [totalUsers, newThisWeek, suspended, underReview, flagged] =
      await Promise.all([
        this.userRepo
          .createQueryBuilder('u')
          .where('u.deleted_at IS NULL')
          .andWhere('u.role = :role', { role: ADMIN_METRICS_USER_ROLE })
          .getCount(),
        this.userRepo
          .createQueryBuilder('u')
          .where('u.created_at >= :weekAgo', { weekAgo })
          .andWhere('u.deleted_at IS NULL')
          .andWhere('u.role = :role', { role: ADMIN_METRICS_USER_ROLE })
          .getCount(),
        this.userRepo.count({
          where: {
            status: UserStatusEnum.SUSPENDED,
            role: ADMIN_METRICS_USER_ROLE,
          },
        }),
        this.countDistinctOwners(ModerationStatus.PENDING),
        this.countFlaggedAccounts(),
      ]);

    return successResponse('Operation successful', {
      totalUsers: {
        value: totalUsers,
        deltaWeek: newThisWeek,
      },
      flaggedAccounts: {
        value: flagged,
        /** New pending/rejected owners in last 24h — proxy for “new alerts”. */
        newAlerts: await this.countNewFlaggedAlerts(),
      },
      /** Stand-in for mock “KYC pending” — users with pending moderation. */
      underReview: {
        value: underReview,
      },
      suspendedUsers: {
        value: suspended,
      },
      /** Reserved until wallet domain exists. */
      frozenWallets: null,
      kycPending: null,
    });
  }

  async listUsers(query: UserIntelligenceQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const offset = (page - 1) * limit;
    const tab = query.tab ?? UserIntelligenceTab.ALL;
    const sort = query.sort ?? UserIntelligenceSort.RISK_SCORE;

    if (tab === UserIntelligenceTab.FROZEN) {
      return successResponse('Operation successful', {
        items: [],
        total: 0,
        page,
        limit,
        tab,
      });
    }

    const params: unknown[] = [
      ModerationStatus.PENDING,
      ModerationStatus.REJECTED,
    ];
    let paramIdx = 3;

    const filters: string[] = [
      'u.deleted_at IS NULL',
      `u.role = '${ADMIN_METRICS_USER_ROLE}'`,
    ];

    if (tab === UserIntelligenceTab.SUSPENDED) {
      filters.push(`u.status = '${UserStatusEnum.SUSPENDED}'`);
    } else if (tab === UserIntelligenceTab.UNDER_REVIEW) {
      filters.push('COALESCE(mod.pending_total, 0) > 0');
    } else if (tab === UserIntelligenceTab.FLAGGED) {
      filters.push(`(
        u.status = '${UserStatusEnum.SUSPENDED}'
        OR COALESCE(mod.pending_total, 0) > 0
        OR COALESCE(mod.rejected_total, 0) > 0
      )`);
    }

    if (query.countryCode) {
      filters.push(`u.country_code = $${paramIdx}`);
      params.push(query.countryCode);
      paramIdx += 1;
    }

    if (query.search?.trim()) {
      const q = `%${query.search.trim().toLowerCase()}%`;
      filters.push(`(
        LOWER(COALESCE(u.username, '')) LIKE $${paramIdx}
        OR LOWER(COALESCE(u.email, '')) LIKE $${paramIdx}
        OR LOWER(COALESCE(u.first_name, '')) LIKE $${paramIdx}
        OR LOWER(COALESCE(u.last_name, '')) LIKE $${paramIdx}
        OR LOWER(COALESCE(u.user_ref_id, '')) LIKE $${paramIdx}
        OR u.id::text = $${paramIdx + 1}
      )`);
      params.push(q);
      paramIdx += 1;
      params.push(query.search.trim());
      paramIdx += 1;
    }

    const orderBy =
      sort === UserIntelligenceSort.JOINED_ASC
        ? 'u.created_at ASC'
        : sort === UserIntelligenceSort.JOINED_DESC
          ? 'u.created_at DESC'
          : '"riskProxy" DESC, u.created_at DESC';

    const whereSql = filters.join(' AND ');

    const modCte = `
      mod AS (
        SELECT
          owner_id,
          SUM(pending)::int AS pending_total,
          SUM(rejected)::int AS rejected_total,
          SUM(rejected_media)::int AS rejected_media
        FROM (
          SELECT owner_id,
            CASE WHEN text_moderation_status = $1 THEN 1 ELSE 0 END AS pending,
            CASE WHEN text_moderation_status = $2 THEN 1 ELSE 0 END AS rejected,
            0 AS rejected_media
          FROM posts WHERE text_moderation_status IN ($1, $2) AND owner_id IS NOT NULL
          UNION ALL
          SELECT owner_id,
            CASE WHEN text_moderation_status = $1 THEN 1 ELSE 0 END,
            CASE WHEN text_moderation_status = $2 THEN 1 ELSE 0 END,
            0
          FROM ads WHERE text_moderation_status IN ($1, $2) AND owner_id IS NOT NULL
          UNION ALL
          SELECT owner_id,
            CASE WHEN text_moderation_status = $1 THEN 1 ELSE 0 END,
            CASE WHEN text_moderation_status = $2 THEN 1 ELSE 0 END,
            0
          FROM thoughts WHERE text_moderation_status IN ($1, $2) AND owner_id IS NOT NULL
          UNION ALL
          SELECT owner_id,
            CASE WHEN text_moderation_status = $1 THEN 1 ELSE 0 END,
            CASE WHEN text_moderation_status = $2 THEN 1 ELSE 0 END,
            0
          FROM statuses WHERE text_moderation_status IN ($1, $2) AND owner_id IS NOT NULL
          UNION ALL
          SELECT user_id,
            CASE WHEN text_moderation_status = $1 THEN 1 ELSE 0 END,
            CASE WHEN text_moderation_status = $2 THEN 1 ELSE 0 END,
            0
          FROM comments WHERE text_moderation_status IN ($1, $2)
          UNION ALL
          SELECT owner_id,
            CASE WHEN moderation_status = $1 THEN 1 ELSE 0 END,
            CASE WHEN moderation_status = $2 THEN 1 ELSE 0 END,
            CASE WHEN moderation_status = $2 THEN 1 ELSE 0 END
          FROM medias WHERE moderation_status IN ($1, $2) AND owner_id IS NOT NULL
          UNION ALL
          SELECT id,
            CASE WHEN bio_moderation_status = $1 THEN 1 ELSE 0 END,
            CASE WHEN bio_moderation_status = $2 THEN 1 ELSE 0 END,
            0
          FROM users WHERE bio_moderation_status IN ($1, $2)
            AND deleted_at IS NULL AND role = 'user'
        ) x
        GROUP BY owner_id
      ),
      rpt AS (
        SELECT
          reported_user_id AS user_id,
          COUNT(*) FILTER (
            WHERE status IN ('open', 'in_review', 'escalated')
          )::int AS open_reports,
          COUNT(*) FILTER (
            WHERE status IN ('open', 'in_review', 'escalated')
              AND severity IN ('high', 'critical')
          )::int AS open_high_severity,
          COUNT(*) FILTER (
            WHERE status = 'resolved'
              AND resolution_outcome IN ('violation_action_taken', 'violation_warning')
          )::int AS upheld_violations
        FROM abuse_reports
        GROUP BY reported_user_id
      )
    `;

    const riskProxy = riskProxySqlExpression('u');

    const listSql = `
      WITH ${modCte}
      SELECT
        u.id,
        u.first_name AS "firstName",
        u.last_name AS "lastName",
        u.username,
        u.email,
        u.user_ref_id AS "userRefId",
        u.profile_picture AS "profilePicture",
        u.country_code AS "countryCode",
        u.status::text AS status,
        u.verified,
        u.phone_number AS "phoneNumber",
        u.created_at AS "createdAt",
        (${riskProxy})::int AS "riskProxy",
        COALESCE(mod.pending_total, 0)::int AS "pendingTotal",
        COALESCE(mod.rejected_total, 0)::int AS "rejectedTotal",
        COALESCE(rpt.open_reports, 0)::int AS "openReports"
      FROM users u
      LEFT JOIN mod ON mod.owner_id = u.id
      LEFT JOIN rpt ON rpt.user_id = u.id
      WHERE ${whereSql}
      ORDER BY ${orderBy}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;

    const countSql = `
      WITH ${modCte}
      SELECT COUNT(*)::int AS total
      FROM users u
      LEFT JOIN mod ON mod.owner_id = u.id
      LEFT JOIN rpt ON rpt.user_id = u.id
      WHERE ${whereSql}
    `;

    const listParams = [...params, limit, offset];
    const [rows, countRows] = await Promise.all([
      this.dataSource.query(listSql, listParams) as Promise<ListRow[]>,
      this.dataSource.query(countSql, params) as Promise<
        Array<{ total: number }>
      >,
    ]);

    const riskMap = await this.riskService.scoreUsers(
      rows.map((r) => ({
        id: r.id,
        status: r.status as UserStatusEnum,
        verified: r.verified,
        phoneNumber: r.phoneNumber ?? undefined,
        bioModerationStatus: undefined,
      })),
    );

    const items = rows.map((row) => {
      const risk =
        riskMap.get(row.id) ??
        this.riskService.scoreUser(
          {
            status: row.status as UserStatusEnum,
            verified: row.verified,
            phoneNumber: row.phoneNumber ?? undefined,
          },
          emptyModerationSignals(),
          emptyReportSignals(),
        );

      return {
        id: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        email: row.email,
        userRefId: row.userRefId,
        profilePicture: row.profilePicture,
        countryCode: row.countryCode,
        dateJoined: new Date(row.createdAt).toISOString(),
        status: row.status,
        verification: {
          email: Boolean(row.verified),
          phone: Boolean(row.phoneNumber),
        },
        reports: Number(row.openReports) || 0,
        riskScore: risk.overall,
        riskLabel: risk.label,
        primaryTrigger: risk.primaryTrigger,
        badges: risk.badges,
        openItems: risk.openItems,
        /** Reserved finance columns */
        totalBvPurchased: null,
        walletBalance: null,
        kycLevel: null,
      };
    });

    return successResponse('Operation successful', {
      items,
      total: Number(countRows[0]?.total ?? 0),
      page,
      limit,
      tab,
    });
  }

  async getUserIntelligence(userId: string) {
    const user = await this.userRepo
      .createQueryBuilder('u')
      .addSelect('u.updatedAt')
      .where('u.id = :userId', { userId })
      .andWhere('u.role = :role', { role: ADMIN_METRICS_USER_ROLE })
      .getOne();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [
      riskMap,
      activities,
      moderationHistory,
      priorSuspensions,
      reportStats,
    ] = await Promise.all([
      this.riskService.scoreUsers([user]),
      this.activityRepo.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: 30,
      }),
      this.fetchUserModerationHistory(userId),
      this.activityRepo.count({
        where: { userId, action: 'user.status.suspended' },
      }),
      this.dataSource.query(
        `
          SELECT
            COUNT(*)::int AS total_reports,
            COUNT(*) FILTER (
              WHERE status = 'resolved'
                AND resolution_outcome IN ('violation_action_taken', 'violation_warning')
            )::int AS upheld_violations
          FROM abuse_reports
          WHERE reported_user_id = $1
          `,
        [userId],
      ) as Promise<
        Array<{
          total_reports: string | number;
          upheld_violations: string | number;
        }>
      >,
    ]);

    const risk = riskMap.get(user.id)!;
    const totalReports = Number(reportStats[0]?.total_reports ?? 0) || 0;
    const strikes = Number(reportStats[0]?.upheld_violations ?? 0) || 0;

    return successResponse('Operation successful', {
      identity: {
        id: user.id,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        username: user.username ?? null,
        email: user.email,
        userRefId: user.userRefId ?? null,
        profilePicture: user.profilePicture ?? null,
        countryCode: user.countryCode ?? null,
        dateJoined: user.createdAt.toISOString(),
        status: user.status,
        verification: {
          email: Boolean(user.verified),
          phone: Boolean(user.phoneNumber),
        },
        phoneCode: user.phoneCode ?? null,
        phoneNumber: user.phoneNumber ?? null,
        kycLevel: null,
      },
      badges: risk.badges,
      stats: {
        reports: totalReports,
        strikes,
        priorSuspensions,
        pendingModeration: risk.openItems.pending,
        rejectedModeration: risk.openItems.rejected,
        bvSpent: null,
        bvReceived: null,
      },
      risk,
      accountActivity: {
        reportsAgainst: totalReports,
        strikes,
        priorSuspensions,
        status: user.status,
        giftsSent: null,
        giftsReceived: null,
        chargebacks: null,
        stageAppearances: null,
      },
      financialActivity: null,
      enforcement: {
        available: [
          {
            action: 'suspend_account',
            method: 'POST',
            path: `/v1/users/${user.id}/status`,
            body: { status: UserStatusEnum.SUSPENDED },
          },
          {
            action: 'activate_account',
            method: 'POST',
            path: `/v1/users/${user.id}/status`,
            body: { status: UserStatusEnum.ACTIVATED },
          },
        ],
        reserved: [
          'require_reverification',
          'block_payment_methods',
          'freeze_wallet',
          'escalate_investigation',
        ],
      },
      devices: null,
      linkedAccounts: null,
      activityLog: activities.map((a) => ({
        id: a.id,
        action: a.action,
        metadata: a.metadata ?? null,
        ipAddress: a.ipAddress ?? null,
        userAgent: a.userAgent ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
      moderationHistory,
    });
  }

  private async fetchUserModerationHistory(userId: string) {
    const rows = await this.dataSource.query(
      `
      (
        SELECT 'text_moderation' AS type, 'post' AS entity_type, id::text, text_moderation_status AS status,
          text_moderation_labels AS labels, content_pending AS content, text_moderated_at AS at
        FROM posts WHERE owner_id = $1 AND text_moderation_status IN ($2, $3)
      )
      UNION ALL
      (
        SELECT 'text_moderation', 'ad', id::text, text_moderation_status, text_moderation_labels,
          content_pending, text_moderated_at
        FROM ads WHERE owner_id = $1 AND text_moderation_status IN ($2, $3)
      )
      UNION ALL
      (
        SELECT 'text_moderation', 'thought', id::text, text_moderation_status, text_moderation_labels,
          content_pending, text_moderated_at
        FROM thoughts WHERE owner_id = $1 AND text_moderation_status IN ($2, $3)
      )
      UNION ALL
      (
        SELECT 'text_moderation', 'status', id::text, text_moderation_status, text_moderation_labels,
          content_pending, text_moderated_at
        FROM statuses WHERE owner_id = $1 AND text_moderation_status IN ($2, $3)
      )
      UNION ALL
      (
        SELECT 'text_moderation', 'comment', id::text, text_moderation_status, text_moderation_labels,
          content, text_moderated_at
        FROM comments WHERE user_id = $1 AND text_moderation_status IN ($2, $3)
      )
      UNION ALL
      (
        SELECT 'text_moderation', 'bio', id::text, bio_moderation_status, bio_moderation_labels,
          bio_pending, bio_moderated_at
        FROM users WHERE id = $1 AND bio_moderation_status IN ($2, $3)
      )
      UNION ALL
      (
        SELECT 'media_moderation', 'media', id::text, moderation_status, moderation_labels,
          rejection_reason, moderated_at
        FROM medias WHERE owner_id = $1 AND moderation_status IN ($2, $3)
      )
      ORDER BY at DESC NULLS LAST
      LIMIT 50
      `,
      [userId, ModerationStatus.PENDING, ModerationStatus.REJECTED],
    );

    return (rows as Array<Record<string, unknown>>).map((row) => ({
      type: row.type,
      entityType: row.entity_type as TextModerationSurface | 'media',
      id: row.id,
      status: row.status,
      labels: row.labels ?? null,
      content: row.content ?? null,
      createdAt: row.at ? new Date(row.at as string).toISOString() : null,
    }));
  }

  private async countDistinctOwners(status: ModerationStatus): Promise<number> {
    const rows = await this.dataSource.query(
      `
      SELECT COUNT(DISTINCT owner_id)::int AS c FROM (
        SELECT p.owner_id FROM posts p
          INNER JOIN users ou ON ou.id = p.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE p.text_moderation_status = $1 AND p.owner_id IS NOT NULL
        UNION
        SELECT a.owner_id FROM ads a
          INNER JOIN users ou ON ou.id = a.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE a.text_moderation_status = $1 AND a.owner_id IS NOT NULL
        UNION
        SELECT th.owner_id FROM thoughts th
          INNER JOIN users ou ON ou.id = th.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE th.text_moderation_status = $1 AND th.owner_id IS NOT NULL
        UNION
        SELECT s.owner_id FROM statuses s
          INNER JOIN users ou ON ou.id = s.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE s.text_moderation_status = $1 AND s.owner_id IS NOT NULL
        UNION
        SELECT c.user_id FROM comments c
          INNER JOIN users ou ON ou.id = c.user_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE c.text_moderation_status = $1
        UNION
        SELECT m.owner_id FROM medias m
          INNER JOIN users ou ON ou.id = m.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE m.moderation_status = $1 AND m.owner_id IS NOT NULL
        UNION
        SELECT id FROM users
          WHERE bio_moderation_status = $1 AND deleted_at IS NULL AND role = $2
      ) t
      `,
      [status, ADMIN_METRICS_USER_ROLE],
    );
    return Number(rows[0]?.c ?? 0);
  }

  private async countFlaggedAccounts(): Promise<number> {
    const rows = await this.dataSource.query(
      `
      SELECT COUNT(DISTINCT id)::int AS c FROM (
        SELECT id FROM users
          WHERE deleted_at IS NULL AND status = $1 AND role = $4
        UNION
        SELECT p.owner_id AS id FROM posts p
          INNER JOIN users ou ON ou.id = p.owner_id AND ou.deleted_at IS NULL AND ou.role = $4
          WHERE p.text_moderation_status IN ($2, $3) AND p.owner_id IS NOT NULL
        UNION
        SELECT a.owner_id FROM ads a
          INNER JOIN users ou ON ou.id = a.owner_id AND ou.deleted_at IS NULL AND ou.role = $4
          WHERE a.text_moderation_status IN ($2, $3) AND a.owner_id IS NOT NULL
        UNION
        SELECT th.owner_id FROM thoughts th
          INNER JOIN users ou ON ou.id = th.owner_id AND ou.deleted_at IS NULL AND ou.role = $4
          WHERE th.text_moderation_status IN ($2, $3) AND th.owner_id IS NOT NULL
        UNION
        SELECT s.owner_id FROM statuses s
          INNER JOIN users ou ON ou.id = s.owner_id AND ou.deleted_at IS NULL AND ou.role = $4
          WHERE s.text_moderation_status IN ($2, $3) AND s.owner_id IS NOT NULL
        UNION
        SELECT c.user_id FROM comments c
          INNER JOIN users ou ON ou.id = c.user_id AND ou.deleted_at IS NULL AND ou.role = $4
          WHERE c.text_moderation_status IN ($2, $3)
        UNION
        SELECT m.owner_id FROM medias m
          INNER JOIN users ou ON ou.id = m.owner_id AND ou.deleted_at IS NULL AND ou.role = $4
          WHERE m.moderation_status IN ($2, $3) AND m.owner_id IS NOT NULL
        UNION
        SELECT id FROM users
          WHERE bio_moderation_status IN ($2, $3) AND deleted_at IS NULL AND role = $4
      ) t
      `,
      [
        UserStatusEnum.SUSPENDED,
        ModerationStatus.PENDING,
        ModerationStatus.REJECTED,
        ADMIN_METRICS_USER_ROLE,
      ],
    );
    return Number(rows[0]?.c ?? 0);
  }

  private async countNewFlaggedAlerts(): Promise<number> {
    const rows = await this.dataSource.query(
      `
      SELECT COUNT(DISTINCT owner_id)::int AS c FROM (
        SELECT p.owner_id FROM posts p
          INNER JOIN users ou ON ou.id = p.owner_id AND ou.deleted_at IS NULL AND ou.role = $3
          WHERE p.text_moderation_status IN ($1, $2) AND p.owner_id IS NOT NULL
            AND p.text_moderated_at >= NOW() - INTERVAL '24 hours'
        UNION
        SELECT a.owner_id FROM ads a
          INNER JOIN users ou ON ou.id = a.owner_id AND ou.deleted_at IS NULL AND ou.role = $3
          WHERE a.text_moderation_status IN ($1, $2) AND a.owner_id IS NOT NULL
            AND a.text_moderated_at >= NOW() - INTERVAL '24 hours'
        UNION
        SELECT th.owner_id FROM thoughts th
          INNER JOIN users ou ON ou.id = th.owner_id AND ou.deleted_at IS NULL AND ou.role = $3
          WHERE th.text_moderation_status IN ($1, $2) AND th.owner_id IS NOT NULL
            AND th.text_moderated_at >= NOW() - INTERVAL '24 hours'
        UNION
        SELECT s.owner_id FROM statuses s
          INNER JOIN users ou ON ou.id = s.owner_id AND ou.deleted_at IS NULL AND ou.role = $3
          WHERE s.text_moderation_status IN ($1, $2) AND s.owner_id IS NOT NULL
            AND s.text_moderated_at >= NOW() - INTERVAL '24 hours'
        UNION
        SELECT c.user_id FROM comments c
          INNER JOIN users ou ON ou.id = c.user_id AND ou.deleted_at IS NULL AND ou.role = $3
          WHERE c.text_moderation_status IN ($1, $2)
            AND c.text_moderated_at >= NOW() - INTERVAL '24 hours'
        UNION
        SELECT m.owner_id FROM medias m
          INNER JOIN users ou ON ou.id = m.owner_id AND ou.deleted_at IS NULL AND ou.role = $3
          WHERE m.moderation_status IN ($1, $2) AND m.owner_id IS NOT NULL
            AND m.moderated_at >= NOW() - INTERVAL '24 hours'
        UNION
        SELECT id FROM users
          WHERE bio_moderation_status IN ($1, $2) AND deleted_at IS NULL AND role = $3
            AND bio_moderated_at >= NOW() - INTERVAL '24 hours'
      ) t
      `,
      [
        ModerationStatus.PENDING,
        ModerationStatus.REJECTED,
        ADMIN_METRICS_USER_ROLE,
      ],
    );
    return Number(rows[0]?.c ?? 0);
  }
}
