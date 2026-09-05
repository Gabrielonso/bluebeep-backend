import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { successResponse } from 'src/common/helpers/response.helper';
import { TextModerationSurface } from 'src/common/moderation/text-moderation.types';
import { PresenceService } from 'src/realtime/services/presence.service';
import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';
import { Media } from 'src/modules/media/entities/media.entity';
import { AccountActivity } from 'src/modules/account-activity/entities/account-activity.entity';
import { CallSession } from 'src/modules/calls/entities/call-session.entity';
import { CallSessionStatus } from 'src/modules/calls/enums/call-session-status.enum';
import { LiveStream } from 'src/modules/live-streams/entities/live-stream.entity';
import { LiveStreamStatus } from 'src/modules/live-streams/enums/live-stream-status.enum';
import { AbuseReport } from 'src/modules/reports/entities/abuse-report.entity';
import { AbuseReportSeverity } from 'src/modules/reports/enums/abuse-report-severity.enum';
import { AbuseReportStatus } from 'src/modules/reports/enums/abuse-report-status.enum';
import { Comment } from '../engagements/entities/comment.entity';
import { Post } from '../posts/entities/post.entity';
import { Ad } from '../ads/entities/ads.entity';
import { Thought } from '../thought/entities/thought.entity';
import { Status } from '../status/entities/status.entity';
import { User } from '../user/entity/user.entity';
import { UserStatusEnum } from '../user/interfaces/user.interfaces';
import { ADMIN_METRICS_USER_ROLE } from './admin-metrics.constants';
import {
  AttentionUserReason,
  CommandCenterAttentionUsersDto,
} from './dtos/command-center-attention-users.dto';
import { CommandCenterFeedDto } from './dtos/command-center-feed.dto';
import {
  CommandCenterRangeDto,
  CommandCenterRangePreset,
} from './dtos/command-center-range.dto';
import { AdminRiskService } from './risk/admin-risk.service';
import {
  emptyModerationSignals,
  emptyReportSignals,
} from './risk/admin-risk.types';

type ActivityTrunc = 'hour' | 'day' | 'month' | 'year';

type RangeWindow = {
  from: Date;
  to: Date;
  priorFrom: Date;
  priorTo: Date;
  preset: CommandCenterRangePreset | 'custom' | 'all';
  trunc: ActivityTrunc;
};

type AttentionRow = {
  id: string;
  username: string | null;
  profilePicture: string | null;
  countryCode: string | null;
  status: string;
  reason: AttentionUserReason;
  updatedAt: Date;
};

type FeedItem = {
  type: 'text_moderation' | 'media_moderation' | 'abuse_report';
  id: string;
  entityType?: TextModerationSurface | 'media' | 'abuse_report';
  ownerId: string | null;
  status: ModerationStatus | AbuseReportStatus | null | undefined;
  labels: Record<string, unknown> | null | undefined;
  content?: string | null;
  rejectionReason?: string | null;
  createdAt: Date;
  publicId?: string;
  reportType?: string;
  severity?: AbuseReportSeverity | string;
  summary?: string;
  reportedUserId?: string;
  targetType?: string | null;
  targetId?: string | null;
  assigneeId?: string | null;
  slaDeadline?: string;
  href?: string;
};

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;
const MS_90_DAYS = 90 * MS_DAY;
const MS_3_YEARS = Math.round(3 * 365.25 * MS_DAY);

@Injectable()
export class CommandCenterService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly presenceService: PresenceService,
    private readonly riskService: AdminRiskService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    @InjectRepository(Ad)
    private readonly adRepo: Repository<Ad>,
    @InjectRepository(Thought)
    private readonly thoughtRepo: Repository<Thought>,
    @InjectRepository(Status)
    private readonly statusRepo: Repository<Status>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>,
    @InjectRepository(AccountActivity)
    private readonly activityRepo: Repository<AccountActivity>,
    @InjectRepository(CallSession)
    private readonly callRepo: Repository<CallSession>,
    @InjectRepository(LiveStream)
    private readonly liveStreamRepo: Repository<LiveStream>,
    @InjectRepository(AbuseReport)
    private readonly abuseReportRepo: Repository<AbuseReport>,
  ) {}

  async getRiskSummary() {
    const summary = await this.riskService.getPlatformRiskSummary();
    return successResponse('Operation successful', summary);
  }

  async getSummary(query: CommandCenterRangeDto) {
    const window = await this.resolveRange(query);

    const [
      activeUsers,
      newSignups,
      priorSignups,
      suspendedUsers,
      pendingModeration,
      rejectedModeration,
      activeCalls,
      activeLiveStreams,
      openTrustReports,
      breachingSla,
    ] = await Promise.all([
      this.countActiveEndUsers(),
      this.countSignupsBetween(window.from, window.to),
      window.preset === 'all'
        ? Promise.resolve(0)
        : this.countSignupsBetween(window.priorFrom, window.priorTo),
      this.userRepo.count({
        where: {
          status: UserStatusEnum.SUSPENDED,
          role: ADMIN_METRICS_USER_ROLE,
        },
      }),
      this.countPendingModeration(),
      this.countRejectedModerationBetween(window.from, window.to),
      this.countActiveEndUserCalls(),
      this.countActiveLiveStreams(),
      this.countOpenTrustReports(),
      this.countBreachingSla(),
    ]);

    return successResponse('Operation successful', {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      preset: window.preset,
      activeUsers: { value: activeUsers },
      newSignups: {
        value: newSignups,
        deltaPct:
          window.preset === 'all'
            ? null
            : this.deltaPct(newSignups, priorSignups),
      },
      suspendedUsers: { value: suspendedUsers },
      pendingModeration: { value: pendingModeration },
      rejectedModeration: { value: rejectedModeration },
      openTrustReports: { value: openTrustReports },
      breachingSla: { value: breachingSla },
      activeCalls: { value: activeCalls },
      activeLiveStreams: { value: activeLiveStreams },
    });
  }

  async getActivitySeries(query: CommandCenterRangeDto) {
    const window = await this.resolveRange(query);
    const trunc = window.trunc;

    const [activityRows, signupRows] = await Promise.all([
      this.activityRepo
        .createQueryBuilder('a')
        .innerJoin(
          User,
          'ou',
          'ou.id = a.user_id AND ou.role = :role AND ou.deleted_at IS NULL',
          { role: ADMIN_METRICS_USER_ROLE },
        )
        .select(
          `FLOOR(EXTRACT(EPOCH FROM (date_trunc('${trunc}', a.created_at) AT TIME ZONE 'UTC')) * 1000)::bigint`,
          'bucket',
        )
        .addSelect('COUNT(*)::int', 'count')
        .where('a.created_at >= :from', { from: window.from })
        .andWhere('a.created_at < :to', { to: window.to })
        .groupBy('bucket')
        .orderBy('bucket', 'ASC')
        .getRawMany<{ bucket: string; count: number }>(),
      this.userRepo
        .createQueryBuilder('u')
        .select(
          `FLOOR(EXTRACT(EPOCH FROM (date_trunc('${trunc}', u.created_at) AT TIME ZONE 'UTC')) * 1000)::bigint`,
          'bucket',
        )
        .addSelect('COUNT(*)::int', 'count')
        .where('u.created_at >= :from', { from: window.from })
        .andWhere('u.created_at < :to', { to: window.to })
        .andWhere('u.deleted_at IS NULL')
        .andWhere('u.role = :role', { role: ADMIN_METRICS_USER_ROLE })
        .groupBy('bucket')
        .orderBy('bucket', 'ASC')
        .getRawMany<{ bucket: string; count: number }>(),
    ]);

    const activityMap = new Map<number, number>();
    for (const row of activityRows) {
      activityMap.set(Number(row.bucket), Number(row.count));
    }
    const signupMap = new Map<number, number>();
    for (const row of signupRows) {
      signupMap.set(Number(row.bucket), Number(row.count));
    }

    const points: Array<{
      ts: string;
      activities: number;
      signups: number;
    }> = [];

    for (const bucketMs of this.buildSeriesBuckets(
      window.from,
      window.to,
      trunc,
    )) {
      points.push({
        ts: new Date(bucketMs).toISOString(),
        activities: activityMap.get(bucketMs) ?? 0,
        signups: signupMap.get(bucketMs) ?? 0,
      });
    }

    return successResponse('Operation successful', {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      preset: window.preset,
      trunc: window.trunc,
      points,
    });
  }

  async getAttentionUsers(query: CommandCenterAttentionUsersDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const offset = (page - 1) * limit;
    const reasonFilter = query.status;

    const rows = await this.dataSource.query(
      `
      WITH attention AS (
        SELECT
          u.id,
          u.username,
          u.profile_picture AS "profilePicture",
          u.country_code AS "countryCode",
          u.status::text AS status,
          'suspended'::text AS reason,
          COALESCE(u.updated_at, u.created_at) AS "updatedAt"
        FROM users u
        WHERE u.deleted_at IS NULL AND u.role = 'user'
          AND u.status = $1

        UNION ALL

        SELECT
          u.id,
          u.username,
          u.profile_picture AS "profilePicture",
          u.country_code AS "countryCode",
          u.status::text AS status,
          'pending_moderation'::text AS reason,
          COALESCE(u.bio_moderated_at, u.updated_at, u.created_at) AS "updatedAt"
        FROM users u
        WHERE u.deleted_at IS NULL AND u.role = 'user'
          AND u.bio_moderation_status::text = $2

        UNION ALL

        (
          SELECT DISTINCT ON (flagged.owner_id)
            u.id,
            u.username,
            u.profile_picture AS "profilePicture",
            u.country_code AS "countryCode",
            u.status::text AS status,
            'pending_moderation'::text AS reason,
            flagged.at AS "updatedAt"
          FROM (
            SELECT owner_id, text_moderated_at AS at FROM posts
              WHERE text_moderation_status::text = $2 AND owner_id IS NOT NULL
            UNION ALL
            SELECT owner_id, text_moderated_at FROM ads
              WHERE text_moderation_status::text = $2 AND owner_id IS NOT NULL
            UNION ALL
            SELECT owner_id, text_moderated_at FROM thoughts
              WHERE text_moderation_status::text = $2 AND owner_id IS NOT NULL
            UNION ALL
            SELECT owner_id, text_moderated_at FROM statuses
              WHERE text_moderation_status::text = $2 AND owner_id IS NOT NULL
            UNION ALL
            SELECT user_id, text_moderated_at FROM comments
              WHERE text_moderation_status::text = $2
            UNION ALL
            SELECT owner_id, moderated_at FROM medias
              WHERE moderation_status::text = $2 AND owner_id IS NOT NULL
          ) flagged
          JOIN users u ON u.id = flagged.owner_id AND u.deleted_at IS NULL AND u.role = 'user'
          ORDER BY flagged.owner_id, flagged.at DESC NULLS LAST
        )

        UNION ALL

        (
          SELECT DISTINCT ON (flagged.owner_id)
            u.id,
            u.username,
            u.profile_picture AS "profilePicture",
            u.country_code AS "countryCode",
            u.status::text AS status,
            'rejected_content'::text AS reason,
            flagged.at AS "updatedAt"
          FROM (
            SELECT owner_id, text_moderated_at AS at FROM posts
              WHERE text_moderation_status::text = $3 AND owner_id IS NOT NULL
            UNION ALL
            SELECT owner_id, text_moderated_at FROM ads
              WHERE text_moderation_status::text = $3 AND owner_id IS NOT NULL
            UNION ALL
            SELECT owner_id, text_moderated_at FROM thoughts
              WHERE text_moderation_status::text = $3 AND owner_id IS NOT NULL
            UNION ALL
            SELECT owner_id, text_moderated_at FROM statuses
              WHERE text_moderation_status::text = $3 AND owner_id IS NOT NULL
            UNION ALL
            SELECT user_id, text_moderated_at FROM comments
              WHERE text_moderation_status::text = $3
            UNION ALL
            SELECT owner_id, moderated_at FROM medias
              WHERE moderation_status::text = $3 AND owner_id IS NOT NULL
            UNION ALL
            SELECT id, bio_moderated_at FROM users
              WHERE bio_moderation_status::text = $3 AND deleted_at IS NULL AND role = 'user'
          ) flagged
          JOIN users u ON u.id = flagged.owner_id AND u.deleted_at IS NULL AND u.role = 'user'
          ORDER BY flagged.owner_id, flagged.at DESC NULLS LAST
        )
      ),
      ranked AS (
        SELECT DISTINCT ON (id, reason)
          id,
          username,
          "profilePicture",
          "countryCode",
          status,
          reason,
          "updatedAt"
        FROM attention
        WHERE ($4::text IS NULL OR reason = $4)
        ORDER BY id, reason, "updatedAt" DESC NULLS LAST
      )
      SELECT *
      FROM ranked
      ORDER BY "updatedAt" DESC NULLS LAST
      LIMIT $5 OFFSET $6
      `,
      [
        UserStatusEnum.SUSPENDED,
        ModerationStatus.PENDING,
        ModerationStatus.REJECTED,
        reasonFilter ?? null,
        limit,
        offset,
      ],
    );

    const countResult = await this.dataSource.query(
      `
      WITH attention AS (
        SELECT u.id, 'suspended'::text AS reason
        FROM users u
        WHERE u.deleted_at IS NULL AND u.role = 'user' AND u.status = $1

        UNION ALL

        SELECT u.id, 'pending_moderation'::text AS reason
        FROM users u
        WHERE u.deleted_at IS NULL AND u.role = 'user' AND u.bio_moderation_status::text = $2

        UNION ALL

        SELECT DISTINCT owner_id AS id, 'pending_moderation'::text AS reason
        FROM (
          SELECT owner_id FROM posts WHERE text_moderation_status::text = $2 AND owner_id IS NOT NULL
          UNION
          SELECT owner_id FROM ads WHERE text_moderation_status::text = $2 AND owner_id IS NOT NULL
          UNION
          SELECT owner_id FROM thoughts WHERE text_moderation_status::text = $2 AND owner_id IS NOT NULL
          UNION
          SELECT owner_id FROM statuses WHERE text_moderation_status::text = $2 AND owner_id IS NOT NULL
          UNION
          SELECT user_id FROM comments WHERE text_moderation_status::text = $2
          UNION
          SELECT owner_id FROM medias WHERE moderation_status::text = $2 AND owner_id IS NOT NULL
        ) pending_owners

        UNION ALL

        SELECT DISTINCT owner_id AS id, 'rejected_content'::text AS reason
        FROM (
          SELECT owner_id FROM posts WHERE text_moderation_status::text = $3 AND owner_id IS NOT NULL
          UNION
          SELECT owner_id FROM ads WHERE text_moderation_status::text = $3 AND owner_id IS NOT NULL
          UNION
          SELECT owner_id FROM thoughts WHERE text_moderation_status::text = $3 AND owner_id IS NOT NULL
          UNION
          SELECT owner_id FROM statuses WHERE text_moderation_status::text = $3 AND owner_id IS NOT NULL
          UNION
          SELECT user_id FROM comments WHERE text_moderation_status::text = $3
          UNION
          SELECT owner_id FROM medias WHERE moderation_status::text = $3 AND owner_id IS NOT NULL
          UNION
          SELECT id FROM users WHERE bio_moderation_status::text = $3 AND deleted_at IS NULL AND role = 'user'
        ) rejected_owners
      )
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT DISTINCT id, reason FROM attention
        WHERE ($4::text IS NULL OR reason = $4)
      ) deduped
      `,
      [
        UserStatusEnum.SUSPENDED,
        ModerationStatus.PENDING,
        ModerationStatus.REJECTED,
        reasonFilter ?? null,
      ],
    );

    const attentionRows = rows as AttentionRow[];
    const uniqueIds = [...new Set(attentionRows.map((r) => r.id))];
    const users = uniqueIds.length
      ? await this.userRepo.find({
          where: { id: In(uniqueIds) },
          select: [
            'id',
            'status',
            'verified',
            'phoneNumber',
            'bioModerationStatus',
          ],
        })
      : [];
    const riskMap = await this.riskService.scoreUsers(users);

    const items = attentionRows.map((row) => {
      const risk =
        riskMap.get(row.id) ??
        this.riskService.scoreUser(
          {
            status: row.status as UserStatusEnum,
            verified: false,
            phoneNumber: undefined,
          },
          emptyModerationSignals(),
          emptyReportSignals(),
        );

      return {
        id: row.id,
        username: row.username,
        profilePicture: row.profilePicture,
        countryCode: row.countryCode,
        status: row.status,
        reason: row.reason,
        riskScore: risk.overall,
        riskLabel: risk.label,
        primaryTrigger: risk.primaryTrigger ?? row.reason,
        triggers: risk.triggers,
        badges: risk.badges,
        openItems: risk.openItems,
        updatedAt: new Date(row.updatedAt).toISOString(),
      };
    });

    return successResponse('Operation successful', {
      items,
      total: Number(countResult[0]?.total ?? 0),
      page,
      limit,
    });
  }

  async getModerationFeed(query: CommandCenterFeedDto) {
    const limit = Number(query.limit) || 30;
    const perBucket = Math.max(limit, 20);

    const [textItems, mediaItems, abuseItems] = await Promise.all([
      this.fetchTextFeedItems(perBucket),
      this.fetchMediaFeedItems(perBucket),
      this.fetchAbuseReportFeedItems(perBucket),
    ]);

    const items = [...textItems, ...mediaItems, ...abuseItems]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      }));

    return successResponse('Operation successful', { items });
  }

  async getActiveCalls() {
    const calls = await this.callRepo
      .createQueryBuilder('c')
      .innerJoin(
        User,
        'caller',
        'caller.id = c.caller_id AND caller.role = :role AND caller.deleted_at IS NULL',
        { role: ADMIN_METRICS_USER_ROLE },
      )
      .innerJoin(
        User,
        'callee',
        'callee.id = c.callee_id AND callee.role = :role AND callee.deleted_at IS NULL',
        { role: ADMIN_METRICS_USER_ROLE },
      )
      .where('c.status IN (:...statuses)', {
        statuses: [CallSessionStatus.RINGING, CallSessionStatus.CONNECTED],
      })
      .orderBy('c.initiatedAt', 'DESC')
      .take(50)
      .getMany();

    const items = calls.map((call) => ({
      callUuid: call.callUuid,
      roomName: call.roomName,
      type: call.type,
      status: call.status,
      callerId: call.callerId,
      calleeId: call.calleeId,
      initiatedAt: call.initiatedAt.toISOString(),
      answeredAt: call.answeredAt?.toISOString() ?? null,
      createdAt: call.createdAt.toISOString(),
    }));

    return successResponse('Operation successful', { items });
  }

  private async resolveRange(
    query: CommandCenterRangeDto,
  ): Promise<RangeWindow> {
    const hasCustom = Boolean(query.from || query.to);

    if (hasCustom) {
      return this.buildCustomWindow(query.from, query.to);
    }

    if (!query.range) {
      return this.buildAllTimeWindow();
    }

    const preset = query.range;
    const to = new Date();
    let durationMs = MS_DAY;

    if (preset === CommandCenterRangePreset.DAYS_7) {
      durationMs = 7 * MS_DAY;
    } else if (preset === CommandCenterRangePreset.DAYS_30) {
      durationMs = 30 * MS_DAY;
    }

    const from = new Date(to.getTime() - durationMs);
    return this.buildWindow(from, to, preset);
  }

  private async buildAllTimeWindow(): Promise<RangeWindow> {
    const to = new Date();
    const earliest = await this.findEarliestTimestamp();
    const from = earliest ?? new Date(to.getTime() - MS_DAY);

    // Ensure from < to even if clocks/data are odd
    if (from.getTime() >= to.getTime()) {
      return this.buildWindow(new Date(to.getTime() - MS_DAY), to, 'all');
    }

    return this.buildWindow(from, to, 'all');
  }

  private async findEarliestTimestamp(): Promise<Date | null> {
    const rows = await this.dataSource.query(
      `
      SELECT MIN(ts) AS earliest FROM (
        SELECT MIN(created_at) AS ts FROM users
          WHERE deleted_at IS NULL AND role = 'user'
        UNION ALL
        SELECT MIN(created_at) AS ts FROM account_activities
      ) t
      `,
    );
    const raw = rows[0]?.earliest;
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private buildCustomWindow(fromRaw?: string, toRaw?: string): RangeWindow {
    const to = toRaw ? this.parseBoundary(toRaw, 'to') : new Date();
    const from = fromRaw
      ? this.parseBoundary(fromRaw, 'from')
      : new Date(to.getTime() - MS_DAY);

    return this.buildWindow(from, to, 'custom');
  }

  /**
   * Date-only `YYYY-MM-DD` → UTC midnight.
   * Full ISO datetime → parsed as-is.
   */
  private parseBoundary(value: string, role: 'from' | 'to'): Date {
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

  private buildWindow(
    from: Date,
    to: Date,
    preset: CommandCenterRangePreset | 'custom' | 'all',
  ): RangeWindow {
    if (from.getTime() >= to.getTime()) {
      throw new BadRequestException('`from` must be earlier than `to`');
    }

    const durationMs = to.getTime() - from.getTime();
    const trunc = this.resolveTrunc(durationMs);

    return {
      from,
      to,
      priorFrom: new Date(from.getTime() - durationMs),
      priorTo: from,
      preset,
      trunc,
    };
  }

  /**
   * Auto bucket size from window length:
   * ≤48h → hour | ≤90d → day | ≤3y → month | longer → year
   */
  private resolveTrunc(durationMs: number): ActivityTrunc {
    if (durationMs <= 2 * MS_DAY) return 'hour';
    if (durationMs <= MS_90_DAYS) return 'day';
    if (durationMs <= MS_3_YEARS) return 'month';
    return 'year';
  }

  /** Bucket start timestamps (ms) covering [from, to) for the given trunc. */
  private buildSeriesBuckets(
    from: Date,
    to: Date,
    trunc: ActivityTrunc,
  ): number[] {
    const buckets: number[] = [];
    let cursor = this.startOfTruncUtc(from, trunc);
    const end = this.startOfTruncUtc(new Date(to.getTime() - 1), trunc);

    while (cursor.getTime() <= end.getTime()) {
      buckets.push(cursor.getTime());
      cursor = this.addTruncUtc(cursor, trunc);
    }
    return buckets;
  }

  private startOfTruncUtc(date: Date, trunc: ActivityTrunc): Date {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = date.getUTCDate();
    const h = date.getUTCHours();

    if (trunc === 'year') return new Date(Date.UTC(y, 0, 1));
    if (trunc === 'month') return new Date(Date.UTC(y, m, 1));
    if (trunc === 'day') return new Date(Date.UTC(y, m, d));
    return new Date(Date.UTC(y, m, d, h));
  }

  private addTruncUtc(date: Date, trunc: ActivityTrunc): Date {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = date.getUTCDate();
    const h = date.getUTCHours();

    if (trunc === 'year') return new Date(Date.UTC(y + 1, 0, 1));
    if (trunc === 'month') return new Date(Date.UTC(y, m + 1, 1));
    if (trunc === 'day') return new Date(Date.UTC(y, m, d + 1));
    return new Date(Date.UTC(y, m, d, h + 1));
  }

  private deltaPct(current: number, prior: number): number | null {
    if (prior === 0) {
      return current === 0 ? 0 : null;
    }
    return Math.round(((current - prior) / prior) * 1000) / 10;
  }

  private countSignupsBetween(from: Date, to: Date) {
    return this.userRepo
      .createQueryBuilder('u')
      .where('u.created_at >= :from', { from })
      .andWhere('u.created_at < :to', { to })
      .andWhere('u.deleted_at IS NULL')
      .andWhere('u.role = :role', { role: ADMIN_METRICS_USER_ROLE })
      .getCount();
  }

  private async countActiveEndUsers(): Promise<number> {
    const entries = await this.presenceService.listPresenceEntries();
    const activeIds = [
      ...new Set(
        entries
          .filter((e) => e.status === 'online' || e.status === 'away')
          .map((e) => e.userId),
      ),
    ];
    if (!activeIds.length) return 0;
    return this.userRepo.count({
      where: { id: In(activeIds), role: ADMIN_METRICS_USER_ROLE },
    });
  }

  private countActiveEndUserCalls(): Promise<number> {
    return this.callRepo
      .createQueryBuilder('c')
      .innerJoin(
        User,
        'caller',
        'caller.id = c.caller_id AND caller.role = :role AND caller.deleted_at IS NULL',
        { role: ADMIN_METRICS_USER_ROLE },
      )
      .innerJoin(
        User,
        'callee',
        'callee.id = c.callee_id AND callee.role = :role AND callee.deleted_at IS NULL',
        { role: ADMIN_METRICS_USER_ROLE },
      )
      .where('c.status IN (:...statuses)', {
        statuses: [CallSessionStatus.RINGING, CallSessionStatus.CONNECTED],
      })
      .getCount();
  }

  private countActiveLiveStreams(): Promise<number> {
    return this.liveStreamRepo
      .createQueryBuilder('ls')
      .innerJoin(
        User,
        'host',
        'host.id = ls.host_id AND host.role = :role AND host.deleted_at IS NULL',
        { role: ADMIN_METRICS_USER_ROLE },
      )
      .where('ls.status = :status', { status: LiveStreamStatus.LIVE })
      .getCount();
  }

  private async countPendingModeration(): Promise<number> {
    const role = ADMIN_METRICS_USER_ROLE;
    const counts = await Promise.all([
      this.postRepo
        .createQueryBuilder('p')
        .innerJoin(User, 'ou', 'ou.id = p.owner_id AND ou.role = :role', {
          role,
        })
        .where('p.text_moderation_status = :status', {
          status: ModerationStatus.PENDING,
        })
        .getCount(),
      this.adRepo
        .createQueryBuilder('a')
        .innerJoin(User, 'ou', 'ou.id = a.owner_id AND ou.role = :role', {
          role,
        })
        .where('a.text_moderation_status = :status', {
          status: ModerationStatus.PENDING,
        })
        .getCount(),
      this.thoughtRepo
        .createQueryBuilder('t')
        .innerJoin(User, 'ou', 'ou.id = t.owner_id AND ou.role = :role', {
          role,
        })
        .where('t.text_moderation_status = :status', {
          status: ModerationStatus.PENDING,
        })
        .getCount(),
      this.statusRepo
        .createQueryBuilder('s')
        .innerJoin(User, 'ou', 'ou.id = s.owner_id AND ou.role = :role', {
          role,
        })
        .where('s.text_moderation_status = :status', {
          status: ModerationStatus.PENDING,
        })
        .getCount(),
      this.commentRepo
        .createQueryBuilder('c')
        .innerJoin(User, 'ou', 'ou.id = c.user_id AND ou.role = :role', {
          role,
        })
        .where('c.text_moderation_status = :status', {
          status: ModerationStatus.PENDING,
        })
        .getCount(),
      this.userRepo.count({
        where: {
          bioModerationStatus: ModerationStatus.PENDING,
          role: ADMIN_METRICS_USER_ROLE,
        },
      }),
      this.mediaRepo
        .createQueryBuilder('m')
        .innerJoin(User, 'ou', 'ou.id = m.owner_id AND ou.role = :role', {
          role,
        })
        .where('m.moderation_status = :status', {
          status: ModerationStatus.PENDING,
        })
        .getCount(),
    ]);
    return counts.reduce((sum, n) => sum + n, 0);
  }

  private async countRejectedModerationBetween(
    from: Date,
    to: Date,
  ): Promise<number> {
    const counts = await Promise.all([
      this.countRejectedTextBetween(
        this.postRepo,
        'post',
        'owner_id',
        from,
        to,
      ),
      this.countRejectedTextBetween(this.adRepo, 'ad', 'owner_id', from, to),
      this.countRejectedTextBetween(
        this.thoughtRepo,
        'thought',
        'owner_id',
        from,
        to,
      ),
      this.countRejectedTextBetween(
        this.statusRepo,
        'status',
        'owner_id',
        from,
        to,
      ),
      this.countRejectedTextBetween(
        this.commentRepo,
        'comment',
        'user_id',
        from,
        to,
      ),
      this.userRepo
        .createQueryBuilder('u')
        .where('u.bio_moderation_status = :status', {
          status: ModerationStatus.REJECTED,
        })
        .andWhere('u.role = :role', { role: ADMIN_METRICS_USER_ROLE })
        .andWhere('u.bio_moderated_at >= :from', { from })
        .andWhere('u.bio_moderated_at < :to', { to })
        .getCount(),
      this.mediaRepo
        .createQueryBuilder('m')
        .innerJoin(User, 'ou', 'ou.id = m.owner_id AND ou.role = :role', {
          role: ADMIN_METRICS_USER_ROLE,
        })
        .where('m.moderation_status = :status', {
          status: ModerationStatus.REJECTED,
        })
        .andWhere('m.moderated_at >= :from', { from })
        .andWhere('m.moderated_at < :to', { to })
        .getCount(),
    ]);
    return counts.reduce((sum, n) => sum + n, 0);
  }

  private countRejectedTextBetween(
    repo: Repository<Post | Ad | Thought | Status | Comment>,
    alias: string,
    ownerColumn: string,
    from: Date,
    to: Date,
  ) {
    return repo
      .createQueryBuilder(alias)
      .innerJoin(
        User,
        'ou',
        `ou.id = ${alias}.${ownerColumn} AND ou.role = :role`,
        { role: ADMIN_METRICS_USER_ROLE },
      )
      .where(`${alias}.text_moderation_status = :status`, {
        status: ModerationStatus.REJECTED,
      })
      .andWhere(`${alias}.text_moderated_at >= :from`, { from })
      .andWhere(`${alias}.text_moderated_at < :to`, { to })
      .getCount();
  }

  private async fetchTextFeedItems(limit: number): Promise<FeedItem[]> {
    const statuses = [ModerationStatus.PENDING, ModerationStatus.REJECTED];
    const buckets = await Promise.all([
      this.fetchTextBucket(TextModerationSurface.POST, statuses, limit),
      this.fetchTextBucket(TextModerationSurface.AD, statuses, limit),
      this.fetchTextBucket(TextModerationSurface.THOUGHT, statuses, limit),
      this.fetchTextBucket(TextModerationSurface.STATUS, statuses, limit),
      this.fetchTextBucket(TextModerationSurface.COMMENT, statuses, limit),
      this.fetchTextBucket(TextModerationSurface.BIO, statuses, limit),
    ]);
    return buckets.flat();
  }

  private async fetchTextBucket(
    entityType: TextModerationSurface,
    statuses: ModerationStatus[],
    limit: number,
  ): Promise<FeedItem[]> {
    if (entityType === TextModerationSurface.BIO) {
      const users = await this.userRepo.find({
        where: { bioModerationStatus: In(statuses) },
        order: { bioModeratedAt: 'DESC' },
        take: limit,
      });
      return users.map((user) => ({
        type: 'text_moderation' as const,
        id: user.id,
        entityType,
        ownerId: user.id,
        status: user.bioModerationStatus,
        labels: user.bioModerationLabels,
        content: user.bioPending ?? user.bio,
        createdAt: user.bioModeratedAt ?? user.createdAt,
      }));
    }

    if (entityType === TextModerationSurface.COMMENT) {
      const comments = await this.commentRepo.find({
        where: { textModerationStatus: In(statuses) },
        order: { textModeratedAt: 'DESC' },
        take: limit,
      });
      return comments.map((comment) => ({
        type: 'text_moderation' as const,
        id: comment.id,
        entityType,
        ownerId: comment.userId,
        status: comment.textModerationStatus,
        labels: comment.textModerationLabels,
        content: comment.content,
        createdAt: comment.textModeratedAt ?? comment.createdAt,
      }));
    }

    const repo =
      entityType === TextModerationSurface.POST
        ? this.postRepo
        : entityType === TextModerationSurface.AD
          ? this.adRepo
          : entityType === TextModerationSurface.THOUGHT
            ? this.thoughtRepo
            : this.statusRepo;

    const rows = await repo.find({
      where: { textModerationStatus: In(statuses) },
      order: { textModeratedAt: 'DESC' },
      take: limit,
    });

    return rows.map((row: Post | Ad | Thought | Status) => ({
      type: 'text_moderation' as const,
      id: row.id,
      entityType,
      ownerId: row.ownerId,
      status: row.textModerationStatus,
      labels: row.textModerationLabels,
      content: row.contentPending ?? row.content ?? null,
      createdAt: row.textModeratedAt ?? row.createdAt,
    }));
  }

  private async fetchMediaFeedItems(limit: number): Promise<FeedItem[]> {
    const media = await this.mediaRepo.find({
      where: {
        moderationStatus: In([
          ModerationStatus.PENDING,
          ModerationStatus.REJECTED,
        ]),
      },
      order: { moderatedAt: 'DESC' },
      take: limit,
    });

    return media.map((item) => ({
      type: 'media_moderation' as const,
      id: item.id,
      entityType: 'media' as const,
      ownerId: item.ownerId ?? null,
      status: item.moderationStatus,
      labels: item.moderationLabels,
      rejectionReason: item.rejectionReason ?? null,
      createdAt: item.moderatedAt ?? item.createdAt,
    }));
  }

  private async fetchAbuseReportFeedItems(limit: number): Promise<FeedItem[]> {
    const reports = await this.abuseReportRepo.find({
      where: {
        status: In([
          AbuseReportStatus.OPEN,
          AbuseReportStatus.IN_REVIEW,
          AbuseReportStatus.ESCALATED,
        ]),
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return reports.map((r) => ({
      type: 'abuse_report' as const,
      id: r.id,
      entityType: 'abuse_report' as const,
      ownerId: r.reportedUserId,
      status: r.status,
      labels: null,
      content: r.summary,
      createdAt: r.createdAt,
      publicId: r.publicId,
      reportType: r.type,
      severity: r.severity,
      summary: r.summary,
      reportedUserId: r.reportedUserId,
      targetType: r.targetType ?? undefined,
      targetId: r.targetId ?? undefined,
      assigneeId: r.assigneeId,
      slaDeadline: r.slaDeadline.toISOString(),
      href: `/admin/trust-queue/reports/${r.id}`,
    }));
  }

  private async countOpenTrustReports(): Promise<number> {
    return this.abuseReportRepo.count({
      where: {
        status: In([
          AbuseReportStatus.OPEN,
          AbuseReportStatus.IN_REVIEW,
          AbuseReportStatus.ESCALATED,
        ]),
      },
    });
  }

  private async countBreachingSla(): Promise<number> {
    return this.abuseReportRepo
      .createQueryBuilder('r')
      .where('r.status IN (:...statuses)', {
        statuses: [
          AbuseReportStatus.OPEN,
          AbuseReportStatus.IN_REVIEW,
          AbuseReportStatus.ESCALATED,
        ],
      })
      .andWhere('r.sla_deadline < NOW()')
      .getCount();
  }
}
