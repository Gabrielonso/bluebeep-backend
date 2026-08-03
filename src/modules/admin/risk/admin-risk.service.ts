import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';
import { User } from 'src/modules/user/entity/user.entity';
import { UserStatusEnum } from 'src/modules/user/interfaces/user.interfaces';
import { ADMIN_METRICS_USER_ROLE } from '../admin-metrics.constants';
import {
  clampScore,
  emptyModerationSignals,
  emptyReportSignals,
  ModerationSignals,
  PlatformRiskMetric,
  PlatformRiskSummary,
  ReportSignals,
  RiskBadge,
  RiskLabel,
  RiskTrigger,
  UserRiskProfile,
  riskLabelFromScore,
} from './admin-risk.types';

type ModCountRow = {
  owner_id: string;
  pending_text: string | number;
  rejected_text: string | number;
  pending_media: string | number;
  rejected_media: string | number;
};

type LabelRow = {
  owner_id: string;
  labels: Record<string, unknown> | null;
  rejection_reason: string | null;
};

@Injectable()
export class AdminRiskService {
  constructor(private readonly dataSource: DataSource) {}

  async getModerationSignals(
    userIds: string[],
  ): Promise<Map<string, ModerationSignals>> {
    const map = new Map<string, ModerationSignals>();
    for (const id of userIds) {
      map.set(id, emptyModerationSignals());
    }
    if (!userIds.length) return map;

    const [counts, textLabels, mediaLabels, bios] = await Promise.all([
      this.dataSource.query(
        `
        SELECT
          owner_id,
          SUM(pending_text)::int AS pending_text,
          SUM(rejected_text)::int AS rejected_text,
          SUM(pending_media)::int AS pending_media,
          SUM(rejected_media)::int AS rejected_media
        FROM (
          SELECT owner_id,
            CASE WHEN text_moderation_status = $2 THEN 1 ELSE 0 END AS pending_text,
            CASE WHEN text_moderation_status = $3 THEN 1 ELSE 0 END AS rejected_text,
            0 AS pending_media,
            0 AS rejected_media
          FROM posts WHERE owner_id = ANY($1::uuid[])
            AND text_moderation_status IN ($2, $3)

          UNION ALL
          SELECT owner_id,
            CASE WHEN text_moderation_status = $2 THEN 1 ELSE 0 END,
            CASE WHEN text_moderation_status = $3 THEN 1 ELSE 0 END,
            0, 0
          FROM ads WHERE owner_id = ANY($1::uuid[])
            AND text_moderation_status IN ($2, $3)

          UNION ALL
          SELECT owner_id,
            CASE WHEN text_moderation_status = $2 THEN 1 ELSE 0 END,
            CASE WHEN text_moderation_status = $3 THEN 1 ELSE 0 END,
            0, 0
          FROM thoughts WHERE owner_id = ANY($1::uuid[])
            AND text_moderation_status IN ($2, $3)

          UNION ALL
          SELECT owner_id,
            CASE WHEN text_moderation_status = $2 THEN 1 ELSE 0 END,
            CASE WHEN text_moderation_status = $3 THEN 1 ELSE 0 END,
            0, 0
          FROM statuses WHERE owner_id = ANY($1::uuid[])
            AND text_moderation_status IN ($2, $3)

          UNION ALL
          SELECT user_id AS owner_id,
            CASE WHEN text_moderation_status = $2 THEN 1 ELSE 0 END,
            CASE WHEN text_moderation_status = $3 THEN 1 ELSE 0 END,
            0, 0
          FROM comments WHERE user_id = ANY($1::uuid[])
            AND text_moderation_status IN ($2, $3)

          UNION ALL
          SELECT owner_id,
            0, 0,
            CASE WHEN moderation_status = $2 THEN 1 ELSE 0 END,
            CASE WHEN moderation_status = $3 THEN 1 ELSE 0 END
          FROM medias WHERE owner_id = ANY($1::uuid[])
            AND moderation_status IN ($2, $3)
        ) t
        GROUP BY owner_id
        `,
        [userIds, ModerationStatus.PENDING, ModerationStatus.REJECTED],
      ) as Promise<ModCountRow[]>,

      this.dataSource.query(
        `
        SELECT owner_id, labels, NULL::text AS rejection_reason
        FROM (
          SELECT owner_id, text_moderation_labels AS labels FROM posts
            WHERE owner_id = ANY($1::uuid[]) AND text_moderation_status IN ($2, $3)
              AND text_moderation_labels IS NOT NULL
          UNION ALL
          SELECT owner_id, text_moderation_labels FROM ads
            WHERE owner_id = ANY($1::uuid[]) AND text_moderation_status IN ($2, $3)
              AND text_moderation_labels IS NOT NULL
          UNION ALL
          SELECT owner_id, text_moderation_labels FROM thoughts
            WHERE owner_id = ANY($1::uuid[]) AND text_moderation_status IN ($2, $3)
              AND text_moderation_labels IS NOT NULL
          UNION ALL
          SELECT owner_id, text_moderation_labels FROM statuses
            WHERE owner_id = ANY($1::uuid[]) AND text_moderation_status IN ($2, $3)
              AND text_moderation_labels IS NOT NULL
          UNION ALL
          SELECT user_id, text_moderation_labels FROM comments
            WHERE user_id = ANY($1::uuid[]) AND text_moderation_status IN ($2, $3)
              AND text_moderation_labels IS NOT NULL
          UNION ALL
          SELECT id, bio_moderation_labels FROM users
            WHERE id = ANY($1::uuid[]) AND bio_moderation_status IN ($2, $3)
              AND bio_moderation_labels IS NOT NULL
        ) x
        LIMIT 500
        `,
        [userIds, ModerationStatus.PENDING, ModerationStatus.REJECTED],
      ) as Promise<LabelRow[]>,

      this.dataSource.query(
        `
        SELECT owner_id, moderation_labels AS labels, rejection_reason
        FROM medias
        WHERE owner_id = ANY($1::uuid[])
          AND moderation_status IN ($2, $3)
        LIMIT 200
        `,
        [userIds, ModerationStatus.PENDING, ModerationStatus.REJECTED],
      ) as Promise<LabelRow[]>,

      this.dataSource.query(
        `
        SELECT id, bio_moderation_status
        FROM users
        WHERE id = ANY($1::uuid[])
          AND bio_moderation_status IN ($2, $3)
        `,
        [userIds, ModerationStatus.PENDING, ModerationStatus.REJECTED],
      ) as Promise<Array<{ id: string; bio_moderation_status: string }>>,
    ]);

    for (const row of counts) {
      const signals = map.get(row.owner_id) ?? emptyModerationSignals();
      signals.pendingText = Number(row.pending_text) || 0;
      signals.rejectedText = Number(row.rejected_text) || 0;
      signals.pendingMedia = Number(row.pending_media) || 0;
      signals.rejectedMedia = Number(row.rejected_media) || 0;
      map.set(row.owner_id, signals);
    }

    for (const bio of bios) {
      const signals = map.get(bio.id) ?? emptyModerationSignals();
      if (bio.bio_moderation_status === ModerationStatus.PENDING) {
        signals.bioPending = true;
        signals.pendingText += 1;
      }
      if (bio.bio_moderation_status === ModerationStatus.REJECTED) {
        signals.bioRejected = true;
        signals.rejectedText += 1;
      }
      map.set(bio.id, signals);
    }

    for (const row of textLabels) {
      const signals = map.get(row.owner_id);
      if (!signals || !row.labels) continue;
      this.mergeCategoryScores(signals, row.labels);
    }

    for (const row of mediaLabels) {
      const signals = map.get(row.owner_id);
      if (!signals) continue;
      if (row.labels) this.mergeCategoryScores(signals, row.labels);
      if (row.rejection_reason) {
        signals.mediaRejectionReasons.push(row.rejection_reason);
      }
    }

    return map;
  }

  scoreUser(
    user: Pick<User, 'status' | 'verified'> & {
      phoneNumber?: string | null;
      bioModerationStatus?: ModerationStatus | null;
    },
    signals: ModerationSignals,
    reportSignals: ReportSignals = emptyReportSignals(),
  ): UserRiskProfile {
    const pending = signals.pendingText + signals.pendingMedia;
    const rejected = signals.rejectedText + signals.rejectedMedia;

    const maxCategory = Math.max(
      0,
      ...Object.values(signals.topCategoryScores),
    );
    const hasNsfwMedia = signals.mediaRejectionReasons.some((r) =>
      /nudity|explicit|sexual|porn/i.test(r),
    );

    let contentTrust =
      pending * 5 +
      signals.rejectedText * 12 +
      signals.rejectedMedia * 18 +
      maxCategory * 40 +
      (hasNsfwMedia ? 15 : 0);
    contentTrust = clampScore(contentTrust);

    let accountEnforcement = 0;
    if (user.status === UserStatusEnum.SUSPENDED) {
      accountEnforcement = 85;
    } else if (rejected >= 3) {
      accountEnforcement = 65;
    } else if (rejected >= 1) {
      accountEnforcement = 40;
    } else if (pending >= 1) {
      accountEnforcement = 20;
    }
    accountEnforcement +=
      reportSignals.openReports * 8 +
      reportSignals.openHighSeverity * 10 +
      reportSignals.upheldViolations * 12;
    accountEnforcement = clampScore(accountEnforcement);

    let overall = clampScore(contentTrust * 0.65 + accountEnforcement * 0.35);
    if (user.status === UserStatusEnum.SUSPENDED) {
      overall = Math.max(overall, 80);
    }

    const label = riskLabelFromScore(overall);
    const triggers = this.buildTriggers(
      user,
      signals,
      rejected,
      pending,
      reportSignals,
    );
    const badges = this.buildBadges(user, label, pending);

    return {
      overall,
      label,
      categories: {
        contentTrust,
        accountEnforcement,
        loginSecurity: null,
        paymentFraud: null,
        giftAbuse: null,
        payoutRisk: null,
      },
      badges,
      triggers,
      openItems: {
        pending,
        rejected,
        openReports: reportSignals.openReports,
      },
      topLabels: this.topLabelNames(signals.topCategoryScores, 3),
      primaryTrigger: triggers[0] ?? null,
    };
  }

  async scoreUsers(
    users: Array<
      Pick<User, 'id' | 'status' | 'verified'> & {
        phoneNumber?: string | null;
        bioModerationStatus?: ModerationStatus | null;
      }
    >,
  ): Promise<Map<string, UserRiskProfile>> {
    const userIds = users.map((u) => u.id);
    const [signalsMap, reportMap] = await Promise.all([
      this.getModerationSignals(userIds),
      this.getReportSignals(userIds),
    ]);
    const result = new Map<string, UserRiskProfile>();
    for (const user of users) {
      result.set(
        user.id,
        this.scoreUser(
          user,
          signalsMap.get(user.id) ?? emptyModerationSignals(),
          reportMap.get(user.id) ?? emptyReportSignals(),
        ),
      );
    }
    return result;
  }

  async getReportSignals(
    userIds: string[],
  ): Promise<Map<string, ReportSignals>> {
    const map = new Map<string, ReportSignals>();
    for (const id of userIds) {
      map.set(id, emptyReportSignals());
    }
    if (!userIds.length) return map;

    const rows = (await this.dataSource.query(
      `
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
      WHERE reported_user_id = ANY($1::uuid[])
      GROUP BY reported_user_id
      `,
      [userIds],
    )) as Array<{
      user_id: string;
      open_reports: string | number;
      open_high_severity: string | number;
      upheld_violations: string | number;
    }>;

    for (const row of rows) {
      map.set(row.user_id, {
        openReports: Number(row.open_reports) || 0,
        openHighSeverity: Number(row.open_high_severity) || 0,
        upheldViolations: Number(row.upheld_violations) || 0,
      });
    }

    return map;
  }

  /**
   * Platform trust/safety counters for Command Center.
   * Live book (not time-windowed). Full metric shape; null for unavailable fields.
   */
  async getPlatformRiskSummary(): Promise<PlatformRiskSummary> {
    const [
      suspended,
      totalUsers,
      pendingBucket,
      rejectedBucket,
      moderationItemsTotal,
      flagged,
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*)::int AS c FROM users
         WHERE deleted_at IS NULL AND status = $1 AND role = $2`,
        [UserStatusEnum.SUSPENDED, ADMIN_METRICS_USER_ROLE],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS c FROM users
         WHERE deleted_at IS NULL AND role = $1`,
        [ADMIN_METRICS_USER_ROLE],
      ),
      this.countPlatformModeration(ModerationStatus.PENDING),
      this.countPlatformModeration(ModerationStatus.REJECTED),
      this.countAllModerationItems(),
      this.countFlaggedAccounts(),
    ]);

    const suspendedCount = Number(suspended[0]?.c ?? 0);
    const usersTotal = Number(totalUsers[0]?.c ?? 0);
    const pendingTotal = pendingBucket.total;
    const rejectedTotal = rejectedBucket.total;
    const moderationTotal = moderationItemsTotal;
    const flaggedCount = flagged;

    return {
      suspendedUsers: this.metric(suspendedCount, usersTotal, 'users'),
      pendingModeration: this.metric(
        pendingTotal,
        moderationTotal,
        'moderation_items',
      ),
      rejectedModeration: this.metric(
        rejectedTotal,
        moderationTotal,
        'moderation_items',
      ),
      flaggedAccounts: this.metric(flaggedCount, usersTotal, 'users'),
      totals: {
        users: usersTotal,
        moderationItems: moderationTotal,
      },
      loginSecurity: null,
      paymentFraud: null,
      giftAbuse: null,
      payoutRisk: null,
    };
  }

  private metric(
    count: number,
    total: number,
    of: PlatformRiskMetric['of'],
  ): PlatformRiskMetric {
    return {
      count,
      percentage: this.percentageOf(count, total),
      of,
      inWindow: null,
      breakdown: null,
    };
  }

  private percentageOf(count: number, total: number): number | null {
    if (total <= 0) return null;
    return Math.round((count / total) * 1000) / 10;
  }

  /** All end-user content/media/bios that have a moderation status set. */
  private async countAllModerationItems(): Promise<number> {
    const statuses = [
      ModerationStatus.PENDING,
      ModerationStatus.REJECTED,
      ModerationStatus.PASSED,
      ModerationStatus.SKIPPED,
    ];
    const rows = await this.dataSource.query(
      `
      SELECT (
        (SELECT COUNT(*) FROM posts t
          INNER JOIN users ou ON ou.id = t.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE t.text_moderation_status = ANY($1::moderation_status_enum[]) AND t.owner_id IS NOT NULL)
        + (SELECT COUNT(*) FROM ads t
          INNER JOIN users ou ON ou.id = t.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE t.text_moderation_status = ANY($1::moderation_status_enum[]) AND t.owner_id IS NOT NULL)
        + (SELECT COUNT(*) FROM thoughts t
          INNER JOIN users ou ON ou.id = t.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE t.text_moderation_status = ANY($1::moderation_status_enum[]) AND t.owner_id IS NOT NULL)
        + (SELECT COUNT(*) FROM statuses t
          INNER JOIN users ou ON ou.id = t.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE t.text_moderation_status = ANY($1::moderation_status_enum[]) AND t.owner_id IS NOT NULL)
        + (SELECT COUNT(*) FROM comments t
          INNER JOIN users ou ON ou.id = t.user_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE t.text_moderation_status = ANY($1::moderation_status_enum[]))
        + (SELECT COUNT(*) FROM users u
          WHERE u.bio_moderation_status = ANY($1::moderation_status_enum[]) AND u.deleted_at IS NULL AND u.role = $2)
        + (SELECT COUNT(*) FROM medias m
          INNER JOIN users ou ON ou.id = m.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE m.moderation_status = ANY($1::moderation_status_enum[]) AND m.owner_id IS NOT NULL)
      )::int AS total
      `,
      [statuses, ADMIN_METRICS_USER_ROLE],
    );
    return Number(rows[0]?.total ?? 0);
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

  private async countPlatformModeration(
    status: ModerationStatus,
    last24h = false,
  ): Promise<{ total: number }> {
    const textSince = last24h
      ? "AND t.text_moderated_at >= NOW() - INTERVAL '24 hours'"
      : '';
    const mediaSince = last24h
      ? "AND m.moderated_at >= NOW() - INTERVAL '24 hours'"
      : '';
    const bioSince = last24h
      ? "AND u.bio_moderated_at >= NOW() - INTERVAL '24 hours'"
      : '';

    const rows = await this.dataSource.query(
      `
      SELECT (
        (SELECT COUNT(*) FROM posts t
          INNER JOIN users ou ON ou.id = t.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE t.text_moderation_status = $1 AND t.owner_id IS NOT NULL ${textSince})
        + (SELECT COUNT(*) FROM ads t
          INNER JOIN users ou ON ou.id = t.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE t.text_moderation_status = $1 AND t.owner_id IS NOT NULL ${textSince})
        + (SELECT COUNT(*) FROM thoughts t
          INNER JOIN users ou ON ou.id = t.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE t.text_moderation_status = $1 AND t.owner_id IS NOT NULL ${textSince})
        + (SELECT COUNT(*) FROM statuses t
          INNER JOIN users ou ON ou.id = t.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE t.text_moderation_status = $1 AND t.owner_id IS NOT NULL ${textSince})
        + (SELECT COUNT(*) FROM comments t
          INNER JOIN users ou ON ou.id = t.user_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE t.text_moderation_status = $1 ${textSince})
        + (SELECT COUNT(*) FROM users u
          WHERE u.bio_moderation_status = $1 AND u.deleted_at IS NULL AND u.role = $2 ${bioSince})
        + (SELECT COUNT(*) FROM medias m
          INNER JOIN users ou ON ou.id = m.owner_id AND ou.deleted_at IS NULL AND ou.role = $2
          WHERE m.moderation_status = $1 AND m.owner_id IS NOT NULL ${mediaSince})
      )::int AS total
      `,
      [status, ADMIN_METRICS_USER_ROLE],
    );
    return { total: Number(rows[0]?.total ?? 0) };
  }

  private mergeCategoryScores(
    signals: ModerationSignals,
    labels: Record<string, unknown>,
  ) {
    const scores = labels.categoryScores;
    if (scores && typeof scores === 'object' && !Array.isArray(scores)) {
      for (const [key, value] of Object.entries(
        scores as Record<string, unknown>,
      )) {
        const n = Number(value);
        if (!Number.isFinite(n)) continue;
        signals.topCategoryScores[key] = Math.max(
          signals.topCategoryScores[key] ?? 0,
          n,
        );
      }
    }

    const categories = labels.categories;
    if (
      categories &&
      typeof categories === 'object' &&
      !Array.isArray(categories)
    ) {
      for (const [key, value] of Object.entries(
        categories as Record<string, unknown>,
      )) {
        if (value === true) {
          signals.topCategoryScores[key] = Math.max(
            signals.topCategoryScores[key] ?? 0,
            0.7,
          );
        }
      }
    }
  }

  private buildTriggers(
    user: Pick<User, 'status'>,
    signals: ModerationSignals,
    rejected: number,
    pending: number,
    reportSignals: ReportSignals,
  ): RiskTrigger[] {
    const triggers: RiskTrigger[] = [];
    if (user.status === UserStatusEnum.SUSPENDED) triggers.push('suspended');
    if (rejected >= 3 || reportSignals.upheldViolations >= 2) {
      triggers.push('repeat_offender');
    }
    if (reportSignals.openReports >= 1) triggers.push('open_abuse_reports');
    if (signals.rejectedMedia > 0 || signals.mediaRejectionReasons.length) {
      triggers.push('media_nsfw');
    }
    if (signals.bioPending || signals.bioRejected) triggers.push('bio_flagged');
    if (signals.rejectedText > 0) triggers.push('rejected_content');
    if (pending > 0) triggers.push('pending_moderation');
    if (
      Object.values(signals.topCategoryScores).some((s) => s >= 0.5) &&
      !triggers.includes('rejected_content')
    ) {
      triggers.push('content_flagged');
    }
    return triggers;
  }

  private buildBadges(
    user: Pick<User, 'status' | 'verified'> & {
      phoneNumber?: string | null;
    },
    label: RiskLabel,
    pending: number,
  ): RiskBadge[] {
    const badges: RiskBadge[] = [];
    if (label === 'critical') badges.push('critical_risk');
    else if (label === 'high') badges.push('high_risk');
    if (user.verified) badges.push('email_verified');
    if (user.phoneNumber) badges.push('phone_verified');
    if (user.status === UserStatusEnum.SUSPENDED) badges.push('suspended');
    if (user.status === UserStatusEnum.DEACTIVED) badges.push('deactivated');
    if (pending > 0) badges.push('under_review');
    return badges;
  }

  private topLabelNames(
    scores: Record<string, number>,
    limit: number,
  ): string[] {
    return Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name]) => name);
  }
}
