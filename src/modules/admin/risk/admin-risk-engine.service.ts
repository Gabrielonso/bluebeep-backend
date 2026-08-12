import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { successResponse } from 'src/common/helpers/response.helper';
import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';
import { AbuseReport } from 'src/modules/reports/entities/abuse-report.entity';
import { AbuseReportSeverity } from 'src/modules/reports/enums/abuse-report-severity.enum';
import { AbuseReportStatus } from 'src/modules/reports/enums/abuse-report-status.enum';
import { AbuseReportType } from 'src/modules/reports/enums/abuse-report-type.enum';
import { User } from 'src/modules/user/entity/user.entity';
import { UserStatusEnum } from 'src/modules/user/interfaces/user.interfaces';
import { ADMIN_METRICS_USER_ROLE } from '../admin-metrics.constants';
import {
  RiskEngineInvestigationsQueryDto,
  RiskEngineInvestigationSort,
  RiskEngineOverviewQueryDto,
  RiskEngineSignalHistoryQueryDto,
  RiskEngineSignalHistoryRangePreset,
  RiskEngineSignalsQueryDto,
} from '../dtos/risk-engine-query.dto';
import {
  TrustQueueAddNoteDto,
  TrustQueueResolveDto,
} from '../dtos/trust-queue-actions.dto';
import { TrustQueueService } from '../trust-queue.service';
import { AdminRiskService } from './admin-risk.service';
import {
  clampScore,
  emptyModerationSignals,
  emptyReportSignals,
  riskLabelFromScore,
  riskProxySqlExpression,
  UserRiskProfile,
} from './admin-risk.types';
import {
  mapInvestigationDisplayStatus,
  RiskEngineAccountRow,
  RiskEngineBadge,
  RiskEngineInvestigationDetail,
  RiskEngineInvestigationRow,
  RiskEngineInvestigationsSummary,
  RiskEngineOverview,
  RiskEngineSignal,
  RiskEngineSignalThreshold,
  RiskSignalSeverity,
  RiskSignalStatus,
  RiskSignalType,
  riskBandFromScore,
} from './admin-risk-engine.types';

const OPEN_STATUSES = [
  AbuseReportStatus.OPEN,
  AbuseReportStatus.IN_REVIEW,
  AbuseReportStatus.ESCALATED,
];

const MS_DAY = 24 * 60 * 60 * 1000;
const SIGNAL_FETCH_CAP = 500;

type SignalHistoryWindow = {
  from: Date;
  to: Date;
  preset: RiskEngineSignalHistoryRangePreset | 'custom' | 'all';
};
const SIGNAL_THRESHOLDS: RiskEngineSignalThreshold[] = [
  {
    key: 'open_high_severity_reports',
    label: 'High-severity open reports',
    description: 'Alert when a user has this many open high/critical reports',
    value: 1,
    unit: 'reports',
  },
  {
    key: 'escalated_reports',
    label: 'Escalated report',
    description: 'Any escalated abuse report is a critical signal',
    value: 1,
    unit: 'reports',
  },
  {
    key: 'rejected_content',
    label: 'Rejected content items',
    description: 'Flag accounts with this many rejected content/media items',
    value: 1,
    unit: 'items',
  },
  {
    key: 'repeat_offender',
    label: 'Repeat offender',
    description:
      'Rejected items or upheld violations that trigger repeat status',
    value: 3,
    unit: 'rejects',
  },
  {
    key: 'pending_moderation_spike',
    label: 'Pending moderation spike',
    description: 'Pending moderation items on a single account',
    value: 5,
    unit: 'items',
  },
];

type CandidateRow = {
  id: string;
  username: string | null;
  userRefId: string | null;
  profilePicture: string | null;
  status: string;
  verified: boolean;
  phoneNumber: string | null;
  riskProxy: number;
};

@Injectable()
export class AdminRiskEngineService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly riskService: AdminRiskService,
    private readonly trustQueueService: TrustQueueService,
    @InjectRepository(AbuseReport)
    private readonly reportRepo: Repository<AbuseReport>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getOverview(query: RiskEngineOverviewQueryDto) {
    const limit = Number(query.limit) || 10;
    const [
      platformSummary,
      highestRiskAccounts,
      alertStats,
      actions24h,
      alertCategoryCounts,
    ] = await Promise.all([
      this.riskService.getPlatformRiskSummary(),
      this.loadHighestRiskAccounts(limit),
      this.countActiveAlerts(),
      this.countAutomatedActions24h(),
      this.countAlertsByCategory(),
    ]);

    const avgOverall =
      highestRiskAccounts.length > 0
        ? highestRiskAccounts.reduce((s, a) => s + a.overall, 0) /
          highestRiskAccounts.length
        : 0;

    const flaggedPct = platformSummary.flaggedAccounts.percentage ?? 0;
    const suspendedPct = platformSummary.suspendedUsers.percentage ?? 0;
    const pendingPct = platformSummary.pendingModeration.percentage ?? 0;
    const rejectedPct = platformSummary.rejectedModeration.percentage ?? 0;

    const index = clampScore(
      avgOverall * 0.55 +
        flaggedPct * 0.2 +
        suspendedPct * 0.15 +
        ((pendingPct + rejectedPct) / 2) * 0.1,
    );
    const label = riskLabelFromScore(index);

    const scoreBreakdown = this.averageScoreBreakdown(highestRiskAccounts);

    const overview: RiskEngineOverview = {
      platformRisk: {
        index,
        label,
        band: riskBandFromScore(index),
      },
      activeAlerts: {
        count: alertStats.count,
        newInWindow: alertStats.newInWindow,
        windowHours: 1,
      },
      scoreBreakdown,
      alertsByCategory: {
        accountRisk: alertCategoryCounts.accountRisk,
        trustIntegrity: alertCategoryCounts.trustIntegrity,
        loginSecurity: null,
        paymentFraud: null,
        giftAbuse: null,
        payoutRisk: null,
      },
      automatedActions: {
        windowHours: 24,
        suspensions: actions24h.suspensions,
        escalations: actions24h.escalations,
        resolves: actions24h.resolves,
        freezeWallet: null,
        blockPayments: null,
      },
      highestRiskAccounts,
    };

    return successResponse('Operation successful', overview);
  }

  async getBadge() {
    const [criticalSignals, openInvestigations] = await Promise.all([
      this.countCriticalSignals(),
      this.reportRepo.count({ where: { status: In(OPEN_STATUSES) } }),
    ]);

    const badge: RiskEngineBadge = { criticalSignals, openInvestigations };
    return successResponse('Operation successful', badge);
  }

  async getActiveSignals(query: RiskEngineSignalsQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const to = new Date();
    const from = new Date(to.getTime() - 7 * MS_DAY);
    const all = await this.buildSignals({
      activeOnly: true,
      from,
      to,
    });
    const total = all.length;
    const items = all.slice((page - 1) * limit, page * limit);
    const criticalCount = all.filter((s) => s.severity === 'critical').length;

    return successResponse('Operation successful', {
      items,
      total,
      page,
      limit,
      criticalCount,
    });
  }

  async getSignalHistory(query: RiskEngineSignalHistoryQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const window = await this.resolveSignalHistoryWindow(query);
    const all = await this.buildSignals({
      activeOnly: false,
      from: window.from,
      to: window.to,
    });
    const total = all.length;
    const items = all.slice((page - 1) * limit, page * limit);

    return successResponse('Operation successful', {
      items,
      total,
      page,
      limit,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      preset: window.preset,
    });
  }

  getSignalThresholds() {
    return successResponse('Operation successful', {
      items: SIGNAL_THRESHOLDS,
    });
  }

  async getInvestigationsSummary() {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [openTotal, openedToday, closed30d, closedThisWeek, byTypeRows] =
      await Promise.all([
        this.reportRepo.count({ where: { status: In(OPEN_STATUSES) } }),
        this.reportRepo
          .createQueryBuilder('r')
          .where('r.status IN (:...statuses)', { statuses: OPEN_STATUSES })
          .andWhere('r.created_at >= :start', { start: startOfToday })
          .getCount(),
        this.reportRepo
          .createQueryBuilder('r')
          .where('r.status = :status', { status: AbuseReportStatus.RESOLVED })
          .andWhere('r.resolved_at >= :since', { since: thirtyDaysAgo })
          .getCount(),
        this.reportRepo
          .createQueryBuilder('r')
          .where('r.status = :status', { status: AbuseReportStatus.RESOLVED })
          .andWhere('r.resolved_at >= :since', { since: weekAgo })
          .getCount(),
        this.reportRepo
          .createQueryBuilder('r')
          .select('r.type', 'type')
          .addSelect(
            `COUNT(*) FILTER (WHERE r.status IN ('open','in_review','escalated'))::int`,
            'open',
          )
          .addSelect(
            `COUNT(*) FILTER (WHERE r.status = 'resolved')::int`,
            'closed',
          )
          .groupBy('r.type')
          .getRawMany<{
            type: AbuseReportType;
            open: string;
            closed: string;
          }>(),
      ]);

    const byTypeMap = new Map(
      byTypeRows.map((r) => [
        r.type,
        { open: Number(r.open) || 0, closed: Number(r.closed) || 0 },
      ]),
    );

    const casesByType = Object.values(AbuseReportType).map((type) => ({
      type,
      open: byTypeMap.get(type)?.open ?? 0,
      closed: byTypeMap.get(type)?.closed ?? 0,
    }));

    const summary: RiskEngineInvestigationsSummary = {
      openInvestigations: {
        total: openTotal,
        openedToday,
      },
      casesClosed30d: {
        total: closed30d,
        thisWeek: closedThisWeek,
      },
      casesByType,
      victimsIdentified: null,
      bvAtRisk: null,
    };

    return successResponse('Operation successful', summary);
  }

  async listInvestigations(query: RiskEngineInvestigationsQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const offset = (page - 1) * limit;
    const sort = query.sort ?? RiskEngineInvestigationSort.NEWEST;

    const qb = this.reportRepo.createQueryBuilder('r');

    if (query.type) {
      qb.andWhere('r.type = :type', { type: query.type });
    }
    if (query.status) {
      qb.andWhere('r.status = :status', { status: query.status });
    }
    if (query.search?.trim()) {
      const q = `%${query.search.trim().toLowerCase()}%`;
      qb.leftJoin(User, 'reported', 'reported.id = r.reported_user_id');
      qb.andWhere(
        `(
          LOWER(r.public_id) LIKE :q
          OR LOWER(r.summary) LIKE :q
          OR LOWER(COALESCE(reported.username, '')) LIKE :q
        )`,
        { q },
      );
    }

    qb.orderBy(
      'r.created_at',
      sort === RiskEngineInvestigationSort.OLDEST ? 'ASC' : 'DESC',
    );

    const [rows, total] = await qb.skip(offset).take(limit).getManyAndCount();

    const userIds = rows.flatMap(
      (r) => [r.reportedUserId, r.assigneeId].filter(Boolean) as string[],
    );
    const users = userIds.length
      ? await this.userRepo.find({ where: { id: In([...new Set(userIds)]) } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const items: RiskEngineInvestigationRow[] = rows.map((r) => {
      const suspect = userMap.get(r.reportedUserId);
      const assignee = r.assigneeId ? userMap.get(r.assigneeId) : null;
      return {
        id: r.id,
        publicId: r.publicId,
        type: r.type,
        severity: r.severity,
        status: r.status,
        displayStatus: mapInvestigationDisplayStatus(r.status),
        summary: r.summary,
        openedAt: r.createdAt.toISOString(),
        suspect: suspect
          ? {
              id: suspect.id,
              username: suspect.username ?? null,
              userRefId: suspect.userRefId ?? null,
              profilePicture: suspect.profilePicture ?? null,
            }
          : null,
        investigator: assignee
          ? {
              id: assignee.id,
              displayName: this.displayName(assignee),
            }
          : null,
        victims: null,
        bvInvolved: null,
      };
    });

    return successResponse('Operation successful', {
      items,
      total,
      page,
      limit,
    });
  }

  async getInvestigation(reportId: string) {
    const base = await this.trustQueueService.getReport(reportId);
    const reportData = base.data;
    if (!reportData) {
      return base;
    }

    const report = await this.reportRepo.findOne({ where: { id: reportId } });
    if (!report) {
      return base;
    }

    const reportedUser = await this.userRepo.findOne({
      where: { id: report.reportedUserId },
    });

    let risk: UserRiskProfile | null = null;
    let openReports = 0;
    if (reportedUser) {
      const riskMap = await this.riskService.scoreUsers([
        {
          id: reportedUser.id,
          status: reportedUser.status,
          verified: reportedUser.verified,
          phoneNumber: reportedUser.phoneNumber,
          bioModerationStatus: reportedUser.bioModerationStatus,
        },
      ]);
      risk = riskMap.get(reportedUser.id) ?? null;
      openReports = risk?.openItems.openReports ?? 0;
    }

    const tags = [
      report.type === AbuseReportType.SCAM ||
      report.type === AbuseReportType.IMPERSONATION
        ? 'Fraud investigation'
        : 'Trust investigation',
      mapInvestigationDisplayStatus(report.status),
    ];
    if (report.severity === AbuseReportSeverity.CRITICAL) {
      tags.unshift('Critical');
    }

    const detail: RiskEngineInvestigationDetail = {
      id: report.id,
      publicId: report.publicId,
      type: report.type,
      severity: report.severity,
      status: report.status,
      displayStatus: mapInvestigationDisplayStatus(report.status),
      summary: report.summary,
      description: report.description,
      openedAt: report.createdAt.toISOString(),
      tags,
      suspect: reportedUser
        ? {
            id: reportedUser.id,
            username: reportedUser.username ?? null,
            userRefId: reportedUser.userRefId ?? null,
            profilePicture: reportedUser.profilePicture ?? null,
            status: reportedUser.status,
            countryCode: reportedUser.countryCode ?? null,
            memberSince: reportedUser.createdAt.toISOString(),
            reports: openReports,
            risk,
          }
        : null,
      investigator: reportData.assignment?.assignee
        ? {
            id: reportData.assignment.assignee.id,
            displayName: reportData.assignment.assignee.displayName,
          }
        : null,
      timeline: (reportData.notes ?? []).map(
        (n: {
          id: string;
          body: string;
          createdAt: string;
          author: { id: string; displayName: string } | null;
          isSystem: boolean;
        }) => ({
          id: n.id,
          kind: n.isSystem ? ('system' as const) : ('note' as const),
          body: n.body,
          createdAt: n.createdAt,
          author: n.author,
        }),
      ),
      linkedAccounts: null,
      devices: null,
      enforcement: {
        available: ['suspend_account', 'resolve_and_close'],
        reserved: [
          'require_reverification',
          'block_payment_methods',
          'freeze_wallet',
          'escalate_investigation',
        ],
      },
    };

    return successResponse('Operation successful', {
      ...detail,
      trustQueue: reportData,
    });
  }

  addNote(reportId: string, dto: TrustQueueAddNoteDto, authorId: string) {
    return this.trustQueueService.addNote(reportId, dto, authorId);
  }

  resolve(reportId: string, dto: TrustQueueResolveDto, actorId: string) {
    return this.trustQueueService.resolve(reportId, dto, actorId);
  }

  suspend(reportId: string, actorId: string) {
    return this.trustQueueService.suspendReportedUser(reportId, actorId);
  }

  private averageScoreBreakdown(accounts: RiskEngineAccountRow[]) {
    if (!accounts.length) {
      return {
        accountRisk: null as number | null,
        trustIntegrity: null as number | null,
        loginSecurity: null as null,
        paymentFraud: null as null,
        giftAbuse: null as null,
        payoutRisk: null as null,
      };
    }
    const n = accounts.length;
    return {
      accountRisk: clampScore(
        accounts.reduce((s, a) => s + a.accountRisk, 0) / n,
      ),
      trustIntegrity: clampScore(
        accounts.reduce((s, a) => s + a.trustIntegrity, 0) / n,
      ),
      loginSecurity: null as null,
      paymentFraud: null as null,
      giftAbuse: null as null,
      payoutRisk: null as null,
    };
  }

  private async loadHighestRiskAccounts(
    limit: number,
  ): Promise<RiskEngineAccountRow[]> {
    const riskProxy = riskProxySqlExpression('u');
    const rows = (await this.dataSource.query(
      `
      WITH mod AS (
        SELECT
          owner_id,
          SUM(pending)::int AS pending_total,
          SUM(rejected)::int AS rejected_total,
          SUM(rejected_media)::int AS rejected_media
        FROM (
          SELECT owner_id,
            CASE WHEN text_moderation_status::text = $1 THEN 1 ELSE 0 END AS pending,
            CASE WHEN text_moderation_status::text = $2 THEN 1 ELSE 0 END AS rejected,
            0 AS rejected_media
          FROM posts WHERE text_moderation_status::text IN ($1, $2) AND owner_id IS NOT NULL
          UNION ALL
          SELECT owner_id,
            CASE WHEN text_moderation_status::text = $1 THEN 1 ELSE 0 END,
            CASE WHEN text_moderation_status::text = $2 THEN 1 ELSE 0 END,
            0
          FROM ads WHERE text_moderation_status::text IN ($1, $2) AND owner_id IS NOT NULL
          UNION ALL
          SELECT owner_id,
            CASE WHEN text_moderation_status::text = $1 THEN 1 ELSE 0 END,
            CASE WHEN text_moderation_status::text = $2 THEN 1 ELSE 0 END,
            0
          FROM thoughts WHERE text_moderation_status::text IN ($1, $2) AND owner_id IS NOT NULL
          UNION ALL
          SELECT owner_id,
            CASE WHEN text_moderation_status::text = $1 THEN 1 ELSE 0 END,
            CASE WHEN text_moderation_status::text = $2 THEN 1 ELSE 0 END,
            0
          FROM statuses WHERE text_moderation_status::text IN ($1, $2) AND owner_id IS NOT NULL
          UNION ALL
          SELECT user_id,
            CASE WHEN text_moderation_status::text = $1 THEN 1 ELSE 0 END,
            CASE WHEN text_moderation_status::text = $2 THEN 1 ELSE 0 END,
            0
          FROM comments WHERE text_moderation_status::text IN ($1, $2)
          UNION ALL
          SELECT owner_id,
            CASE WHEN moderation_status::text = $1 THEN 1 ELSE 0 END,
            CASE WHEN moderation_status::text = $2 THEN 1 ELSE 0 END,
            CASE WHEN moderation_status::text = $2 THEN 1 ELSE 0 END
          FROM medias WHERE moderation_status::text IN ($1, $2) AND owner_id IS NOT NULL
          UNION ALL
          SELECT id,
            CASE WHEN bio_moderation_status::text = $1 THEN 1 ELSE 0 END,
            CASE WHEN bio_moderation_status::text = $2 THEN 1 ELSE 0 END,
            0
          FROM users WHERE bio_moderation_status::text IN ($1, $2)
            AND deleted_at IS NULL AND role = $3
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
      SELECT
        u.id,
        u.username,
        u.user_ref_id AS "userRefId",
        u.profile_picture AS "profilePicture",
        u.status::text AS status,
        u.verified,
        u.phone_number AS "phoneNumber",
        (${riskProxy})::int AS "riskProxy"
      FROM users u
      LEFT JOIN mod ON mod.owner_id = u.id
      LEFT JOIN rpt ON rpt.user_id = u.id
      WHERE u.deleted_at IS NULL AND u.role = $3
        AND (
          u.status = $4
          OR COALESCE(mod.pending_total, 0) > 0
          OR COALESCE(mod.rejected_total, 0) > 0
          OR COALESCE(rpt.open_reports, 0) > 0
        )
      ORDER BY (${riskProxy}) DESC, u.created_at DESC
      LIMIT $5
      `,
      [
        ModerationStatus.PENDING,
        ModerationStatus.REJECTED,
        ADMIN_METRICS_USER_ROLE,
        UserStatusEnum.SUSPENDED,
        limit,
      ],
    )) as CandidateRow[];

    if (!rows.length) return [];

    const riskMap = await this.riskService.scoreUsers(
      rows.map((r) => ({
        id: r.id,
        status: r.status as UserStatusEnum,
        verified: r.verified,
        phoneNumber: r.phoneNumber ?? undefined,
      })),
    );

    return rows.map((row) => {
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
        username: row.username,
        userRefId: row.userRefId,
        profilePicture: row.profilePicture,
        status: row.status,
        accountRisk: risk.categories.accountEnforcement,
        trustIntegrity: risk.categories.contentTrust,
        loginSecurity: null,
        paymentFraud: null,
        giftAbuse: null,
        payoutRisk: null,
        overall: risk.overall,
        label: risk.label,
        primaryTrigger: risk.primaryTrigger,
        badges: risk.badges,
      };
    });
  }

  private async countActiveAlerts(): Promise<{
    count: number;
    newInWindow: number;
  }> {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [count, newInWindow] = await Promise.all([
      this.reportRepo
        .createQueryBuilder('r')
        .where('r.status IN (:...statuses)', { statuses: OPEN_STATUSES })
        .andWhere(`(r.severity IN (:...sev) OR r.status = :escalated)`, {
          sev: [AbuseReportSeverity.HIGH, AbuseReportSeverity.CRITICAL],
          escalated: AbuseReportStatus.ESCALATED,
        })
        .getCount(),
      this.reportRepo
        .createQueryBuilder('r')
        .where('r.status IN (:...statuses)', { statuses: OPEN_STATUSES })
        .andWhere(`(r.severity IN (:...sev) OR r.status = :escalated)`, {
          sev: [AbuseReportSeverity.HIGH, AbuseReportSeverity.CRITICAL],
          escalated: AbuseReportStatus.ESCALATED,
        })
        .andWhere('r.created_at >= :since', { since: hourAgo })
        .getCount(),
    ]);
    return { count, newInWindow };
  }

  private async countCriticalSignals(): Promise<number> {
    return this.reportRepo
      .createQueryBuilder('r')
      .where('r.status IN (:...statuses)', { statuses: OPEN_STATUSES })
      .andWhere(
        `(r.severity = :critical OR r.status = :escalated OR r.type IN (:...types))`,
        {
          critical: AbuseReportSeverity.CRITICAL,
          escalated: AbuseReportStatus.ESCALATED,
          types: [AbuseReportType.SCAM, AbuseReportType.IMPERSONATION],
        },
      )
      .getCount();
  }

  private async countAlertsByCategory(): Promise<{
    accountRisk: number;
    trustIntegrity: number;
  }> {
    const [accountRisk, trustIntegrity] = await Promise.all([
      this.reportRepo
        .createQueryBuilder('r')
        .where('r.status IN (:...statuses)', { statuses: OPEN_STATUSES })
        .getCount(),
      this.dataSource.query(
        `
        SELECT COUNT(DISTINCT owner_id)::int AS c FROM (
          SELECT owner_id FROM posts
            WHERE text_moderation_status::text IN ($1, $2) AND owner_id IS NOT NULL
          UNION
          SELECT owner_id FROM ads
            WHERE text_moderation_status::text IN ($1, $2) AND owner_id IS NOT NULL
          UNION
          SELECT owner_id FROM thoughts
            WHERE text_moderation_status::text IN ($1, $2) AND owner_id IS NOT NULL
          UNION
          SELECT owner_id FROM statuses
            WHERE text_moderation_status::text IN ($1, $2) AND owner_id IS NOT NULL
          UNION
          SELECT user_id FROM comments
            WHERE text_moderation_status::text IN ($1, $2)
          UNION
          SELECT owner_id FROM medias
            WHERE moderation_status::text IN ($1, $2) AND owner_id IS NOT NULL
          UNION
          SELECT id FROM users
            WHERE bio_moderation_status::text IN ($1, $2) AND deleted_at IS NULL AND role = $3
        ) t
        `,
        [
          ModerationStatus.PENDING,
          ModerationStatus.REJECTED,
          ADMIN_METRICS_USER_ROLE,
        ],
      ),
    ]);

    return {
      accountRisk,
      trustIntegrity: Number(trustIntegrity[0]?.c ?? 0),
    };
  }

  private async countAutomatedActions24h(): Promise<{
    suspensions: number;
    escalations: number;
    resolves: number;
  }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [suspensions, escalations, resolves] = await Promise.all([
      this.dataSource.query(
        `
        SELECT COUNT(*)::int AS c FROM account_activities
        WHERE action = 'user.status.suspended'
          AND created_at >= $1
        `,
        [since],
      ),
      this.reportRepo
        .createQueryBuilder('r')
        .where('r.status = :status', { status: AbuseReportStatus.ESCALATED })
        .andWhere('r.updated_at >= :since', { since })
        .getCount(),
      this.reportRepo
        .createQueryBuilder('r')
        .where('r.status = :status', { status: AbuseReportStatus.RESOLVED })
        .andWhere('r.resolved_at >= :since', { since })
        .getCount(),
    ]);

    return {
      suspensions: Number(suspensions[0]?.c ?? 0),
      escalations,
      resolves,
    };
  }

  private async buildSignals(opts: {
    activeOnly: boolean;
    from: Date;
    to: Date;
  }): Promise<RiskEngineSignal[]> {
    const { from, to, activeOnly } = opts;
    const signals: RiskEngineSignal[] = [];

    const reportQb = this.reportRepo
      .createQueryBuilder('r')
      .where('r.created_at >= :from', { from })
      .andWhere('r.created_at < :to', { to });
    if (activeOnly) {
      reportQb.andWhere('r.status IN (:...statuses)', {
        statuses: OPEN_STATUSES,
      });
    }
    reportQb.orderBy('r.created_at', 'DESC').take(SIGNAL_FETCH_CAP);
    const reports = await reportQb.getMany();

    const userIds = [
      ...new Set(reports.map((r) => r.reportedUserId).filter(Boolean)),
    ];
    const users = userIds.length
      ? await this.userRepo.find({ where: { id: In(userIds) } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    for (const r of reports) {
      const user = userMap.get(r.reportedUserId);
      const account = {
        id: r.reportedUserId,
        username: user?.username ?? null,
        userRefId: user?.userRefId ?? null,
      };

      const mapped = this.mapReportToSignals(r, account);
      signals.push(...mapped);
    }

    const suspensions = (await this.dataSource.query(
      `
      SELECT a.id, a.user_id AS "userId", a.created_at AS "createdAt", a.metadata
      FROM account_activities a
      WHERE a.action = 'user.status.suspended'
        AND a.created_at >= $1
        AND a.created_at < $2
      ORDER BY a.created_at DESC
      LIMIT $3
      `,
      [from, to, SIGNAL_FETCH_CAP],
    )) as Array<{
      id: string;
      userId: string;
      createdAt: Date;
      metadata: Record<string, unknown> | null;
    }>;

    const susUserIds = [
      ...new Set(suspensions.map((s) => s.userId).filter(Boolean)),
    ];
    const missingIds = susUserIds.filter((id) => !userMap.has(id));
    if (missingIds.length) {
      const more = await this.userRepo.find({ where: { id: In(missingIds) } });
      for (const u of more) userMap.set(u.id, u);
    }

    for (const s of suspensions) {
      if (activeOnly) {
        const u = userMap.get(s.userId);
        if (u?.status !== UserStatusEnum.SUSPENDED) continue;
      }
      const u = userMap.get(s.userId);
      signals.push({
        id: `suspension:${s.id}`,
        type: 'suspended_account',
        severity: 'critical',
        status: activeOnly ? 'escalated' : 'resolved',
        details: 'Account suspended by admin',
        occurredAt: new Date(s.createdAt).toISOString(),
        accounts: [
          {
            id: s.userId,
            username: u?.username ?? null,
            userRefId: u?.userRefId ?? null,
          },
        ],
        autoAction: 'Account suspended',
        source: 'account_activity',
        sourceId: s.id,
      });
    }

    const moderationSignals = await this.loadRecentModerationSignals(
      from,
      to,
      activeOnly,
    );
    signals.push(...moderationSignals);

    signals.sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );

    return signals;
  }

  private mapReportToSignals(
    r: AbuseReport,
    account: {
      id: string;
      username: string | null;
      userRefId: string | null;
    },
  ): RiskEngineSignal[] {
    const status = this.mapReportSignalStatus(r.status);
    const base = {
      occurredAt: r.createdAt.toISOString(),
      accounts: [account],
      source: 'abuse_report' as const,
      sourceId: r.id,
      status,
      autoAction: this.autoActionForReport(r),
    };

    const out: RiskEngineSignal[] = [];

    if (r.status === AbuseReportStatus.ESCALATED) {
      out.push({
        ...base,
        id: `report:escalated:${r.id}`,
        type: 'escalated_report',
        severity: 'critical',
        details: r.summary || 'Report escalated',
      });
    }

    if (
      r.severity === AbuseReportSeverity.HIGH ||
      r.severity === AbuseReportSeverity.CRITICAL
    ) {
      out.push({
        ...base,
        id: `report:high:${r.id}`,
        type: 'high_severity_report',
        severity:
          r.severity === AbuseReportSeverity.CRITICAL ? 'critical' : 'warning',
        details: `${r.severity} severity: ${r.summary}`,
      });
    }

    if (r.type === AbuseReportType.SCAM) {
      out.push({
        ...base,
        id: `report:scam:${r.id}`,
        type: 'scam_report',
        severity: 'critical',
        details: r.summary || 'Scam report filed',
      });
    } else if (r.type === AbuseReportType.IMPERSONATION) {
      out.push({
        ...base,
        id: `report:impersonation:${r.id}`,
        type: 'impersonation_report',
        severity: 'warning',
        details: r.summary || 'Impersonation report filed',
      });
    }

    if (!out.length) {
      out.push({
        ...base,
        id: `report:open:${r.id}`,
        type: 'open_abuse_report',
        severity: this.severityFromReport(r),
        details: r.summary || 'Abuse report filed',
      });
    }

    return out;
  }

  private async loadRecentModerationSignals(
    from: Date,
    to: Date,
    activeOnly: boolean,
  ): Promise<RiskEngineSignal[]> {
    const statusFilter = activeOnly
      ? `AND status_val IN ('${ModerationStatus.PENDING}', '${ModerationStatus.REJECTED}')`
      : '';

    const rows = (await this.dataSource.query(
      `
      SELECT * FROM (
        SELECT
          'post:' || p.id::text AS sid,
          p.owner_id AS user_id,
          p.text_moderation_status::text AS status_val,
          p.text_moderated_at AS occurred_at,
          'rejected_content' AS signal_type,
          COALESCE(p.text_moderation_labels::text, 'Content rejected') AS details
        FROM posts p
        WHERE p.text_moderation_status::text = $1
          AND p.text_moderated_at >= $2
          AND p.text_moderated_at < $3
          AND p.owner_id IS NOT NULL

        UNION ALL
        SELECT
          'media:' || m.id::text,
          m.owner_id,
          m.moderation_status::text,
          m.moderated_at,
          CASE
            WHEN m.rejection_reason ~* 'nudity|explicit|sexual|porn' THEN 'media_nsfw'
            ELSE 'rejected_content'
          END,
          COALESCE(m.rejection_reason, 'Media rejected')
        FROM medias m
        WHERE m.moderation_status::text = $1
          AND m.moderated_at >= $2
          AND m.moderated_at < $3
          AND m.owner_id IS NOT NULL
      ) x
      WHERE occurred_at IS NOT NULL ${statusFilter}
      ORDER BY occurred_at DESC
      LIMIT $4
      `,
      [ModerationStatus.REJECTED, from, to, SIGNAL_FETCH_CAP],
    )) as Array<{
      sid: string;
      user_id: string;
      status_val: string;
      occurred_at: Date;
      signal_type: RiskSignalType;
      details: string;
    }>;

    if (!rows.length) return [];

    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const users = await this.userRepo.find({ where: { id: In(userIds) } });
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Repeat offender: users with >= 3 rejected items in window
    const rejectCounts = new Map<string, number>();
    for (const r of rows) {
      rejectCounts.set(r.user_id, (rejectCounts.get(r.user_id) ?? 0) + 1);
    }

    const signals: RiskEngineSignal[] = [];
    for (const r of rows) {
      const u = userMap.get(r.user_id);
      signals.push({
        id: `mod:${r.sid}`,
        type: r.signal_type,
        severity: r.signal_type === 'media_nsfw' ? 'critical' : 'warning',
        status: 'under_review',
        details: r.details,
        occurredAt: new Date(r.occurred_at).toISOString(),
        accounts: [
          {
            id: r.user_id,
            username: u?.username ?? null,
            userRefId: u?.userRefId ?? null,
          },
        ],
        autoAction: 'Flagged for review',
        source: 'moderation',
        sourceId: r.sid,
      });
    }

    for (const [userId, count] of rejectCounts) {
      if (count < 3) continue;
      const u = userMap.get(userId);
      const latest = rows.find((r) => r.user_id === userId);
      if (!latest) continue;
      signals.push({
        id: `mod:repeat:${userId}`,
        type: 'repeat_offender',
        severity: 'critical',
        status: 'escalated',
        details: `${count} rejected items in window`,
        occurredAt: new Date(latest.occurred_at).toISOString(),
        accounts: [
          {
            id: userId,
            username: u?.username ?? null,
            userRefId: u?.userRefId ?? null,
          },
        ],
        autoAction: 'Escalated for review',
        source: 'moderation',
        sourceId: userId,
      });
    }

    return signals;
  }

  private mapReportSignalStatus(status: AbuseReportStatus): RiskSignalStatus {
    switch (status) {
      case AbuseReportStatus.ESCALATED:
        return 'escalated';
      case AbuseReportStatus.IN_REVIEW:
        return 'under_review';
      case AbuseReportStatus.RESOLVED:
        return 'resolved';
      case AbuseReportStatus.OPEN:
      default:
        return 'open';
    }
  }

  private severityFromReport(r: AbuseReport): RiskSignalSeverity {
    if (
      r.severity === AbuseReportSeverity.CRITICAL ||
      r.status === AbuseReportStatus.ESCALATED
    ) {
      return 'critical';
    }
    if (r.severity === AbuseReportSeverity.HIGH) return 'warning';
    return 'info';
  }

  private autoActionForReport(r: AbuseReport): string | null {
    if (r.status === AbuseReportStatus.ESCALATED)
      return 'Escalated investigation';
    if (r.status === AbuseReportStatus.RESOLVED) return 'Case resolved';
    if (r.status === AbuseReportStatus.IN_REVIEW) return 'Under review';
    return 'Flagged for review';
  }

  private displayName(
    user: Pick<User, 'firstName' | 'lastName' | 'username'>,
  ): string {
    const name = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (name) return name;
    if (user.username) return `@${user.username}`;
    return 'Unknown';
  }

  private async resolveSignalHistoryWindow(
    query: RiskEngineSignalHistoryQueryDto,
  ): Promise<SignalHistoryWindow> {
    const hasCustom = Boolean(query.from || query.to);

    if (hasCustom) {
      return this.buildCustomSignalWindow(query.from, query.to);
    }

    if (!query.range) {
      return this.buildAllTimeSignalWindow();
    }

    const preset = query.range;
    const to = new Date();
    let durationMs = MS_DAY;
    if (preset === RiskEngineSignalHistoryRangePreset.DAYS_7) {
      durationMs = 7 * MS_DAY;
    } else if (preset === RiskEngineSignalHistoryRangePreset.DAYS_30) {
      durationMs = 30 * MS_DAY;
    }

    return {
      from: new Date(to.getTime() - durationMs),
      to,
      preset,
    };
  }

  private async buildAllTimeSignalWindow(): Promise<SignalHistoryWindow> {
    const to = new Date();
    const earliest = await this.findEarliestSignalTimestamp();
    const from = earliest ?? new Date(to.getTime() - MS_DAY);

    if (from.getTime() >= to.getTime()) {
      return {
        from: new Date(to.getTime() - MS_DAY),
        to,
        preset: 'all',
      };
    }

    return { from, to, preset: 'all' };
  }

  private async findEarliestSignalTimestamp(): Promise<Date | null> {
    const rows = await this.dataSource.query(
      `
      SELECT MIN(ts) AS earliest FROM (
        SELECT MIN(created_at) AS ts FROM abuse_reports
        UNION ALL
        SELECT MIN(created_at) AS ts FROM account_activities
          WHERE action = 'user.status.suspended'
        UNION ALL
        SELECT MIN(text_moderated_at) AS ts FROM posts
          WHERE text_moderated_at IS NOT NULL
        UNION ALL
        SELECT MIN(moderated_at) AS ts FROM medias
          WHERE moderated_at IS NOT NULL
      ) t
      `,
    );
    const raw = rows[0]?.earliest;
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private buildCustomSignalWindow(
    fromRaw?: string,
    toRaw?: string,
  ): SignalHistoryWindow {
    const to = toRaw ? this.parseSignalBoundary(toRaw, 'to') : new Date();
    const from = fromRaw
      ? this.parseSignalBoundary(fromRaw, 'from')
      : new Date(to.getTime() - MS_DAY);

    if (from.getTime() >= to.getTime()) {
      throw new BadRequestException('`from` must be earlier than `to`');
    }

    return { from, to, preset: 'custom' };
  }

  private parseSignalBoundary(value: string, role: 'from' | 'to'): Date {
    const trimmed = value.trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
    const parsed = dateOnly
      ? new Date(`${trimmed}T00:00:00.000Z`)
      : new Date(trimmed);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Invalid ${role} datetime: ${value}`);
    }
    return parsed;
  }
}
