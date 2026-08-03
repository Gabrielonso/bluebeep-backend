import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { successResponse } from 'src/common/helpers/response.helper';
import { UserRoles } from 'src/common/enums/user-roles.constants';
import { AccountActivity } from 'src/modules/account-activity/entities/account-activity.entity';
import { AccountActivityService } from 'src/modules/account-activity/account-activity.service';
import { AbuseReportNote } from 'src/modules/reports/entities/abuse-report-note.entity';
import { AbuseReport } from 'src/modules/reports/entities/abuse-report.entity';
import { AbuseReportResolutionOutcome } from 'src/modules/reports/enums/abuse-report-resolution.enum';
import { AbuseReportStatus } from 'src/modules/reports/enums/abuse-report-status.enum';
import { AbuseReportType } from 'src/modules/reports/enums/abuse-report-type.enum';
import { User } from '../user/entity/user.entity';
import { UserStatusEnum } from '../user/interfaces/user.interfaces';
import {
  TrustQueueAddNoteDto,
  TrustQueueReassignDto,
  TrustQueueResolveDto,
} from './dtos/trust-queue-actions.dto';
import {
  TrustQueueQueryDto,
  TrustQueueSort,
  TrustQueueTypeFilter,
} from './dtos/trust-queue-query.dto';

const OPEN_STATUSES = [
  AbuseReportStatus.OPEN,
  AbuseReportStatus.IN_REVIEW,
  AbuseReportStatus.ESCALATED,
];

const UPHELD_OUTCOMES = [
  AbuseReportResolutionOutcome.VIOLATION_ACTION_TAKEN,
  AbuseReportResolutionOutcome.VIOLATION_WARNING,
];

type UserBrief = {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  profilePicture: string | null;
  userRefId: string | null;
  status?: string;
};

@Injectable()
export class TrustQueueService {
  constructor(
    @InjectRepository(AbuseReport)
    private readonly reportRepo: Repository<AbuseReport>,
    @InjectRepository(AbuseReportNote)
    private readonly noteRepo: Repository<AbuseReportNote>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(AccountActivity)
    private readonly activityRepo: Repository<AccountActivity>,
    private readonly accountActivityService: AccountActivityService,
  ) {}

  async getSummary() {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const [totalInQueue, escalated, resolvedToday, avgRow] = await Promise.all([
      this.reportRepo.count({ where: { status: In(OPEN_STATUSES) } }),
      this.reportRepo.count({
        where: { status: AbuseReportStatus.ESCALATED },
      }),
      this.reportRepo
        .createQueryBuilder('r')
        .where('r.status = :status', { status: AbuseReportStatus.RESOLVED })
        .andWhere('r.resolved_at >= :start', { start: startOfToday })
        .getCount(),
      this.reportRepo
        .createQueryBuilder('r')
        .select(
          'AVG(EXTRACT(EPOCH FROM (r.resolved_at - r.created_at)) / 3600.0)',
          'avgHours',
        )
        .where('r.status = :status', { status: AbuseReportStatus.RESOLVED })
        .andWhere('r.resolved_at IS NOT NULL')
        .getRawOne<{ avgHours: string | null }>(),
    ]);

    const avgHours = avgRow?.avgHours != null ? Number(avgRow.avgHours) : null;

    return successResponse('Operation successful', {
      totalInQueue: { value: totalInQueue },
      avgResolutionTimeHours: {
        value:
          avgHours != null && !Number.isNaN(avgHours)
            ? Math.round(avgHours * 10) / 10
            : null,
        slaTargetHours: 6,
      },
      resolvedToday: { value: resolvedToday },
      escalated: { value: escalated },
    });
  }

  async listReports(query: TrustQueueQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const offset = (page - 1) * limit;
    const sort = query.sort ?? TrustQueueSort.NEWEST;
    const typeFilter = query.type ?? TrustQueueTypeFilter.ALL;

    const qb = this.reportRepo.createQueryBuilder('r');

    if (typeFilter !== TrustQueueTypeFilter.ALL) {
      qb.andWhere('r.type = :type', { type: typeFilter });
    }
    if (query.status) {
      qb.andWhere('r.status = :status', { status: query.status });
    }
    if (query.assigneeId) {
      qb.andWhere('r.assignee_id = :assigneeId', {
        assigneeId: query.assigneeId,
      });
    }
    if (query.search?.trim()) {
      const q = `%${query.search.trim().toLowerCase()}%`;
      qb.leftJoin(User, 'reporter', 'reporter.id = r.reporter_id');
      qb.leftJoin(User, 'reported', 'reported.id = r.reported_user_id');
      qb.andWhere(
        `(
          LOWER(r.public_id) LIKE :q
          OR LOWER(r.summary) LIKE :q
          OR LOWER(COALESCE(reporter.username, '')) LIKE :q
          OR LOWER(COALESCE(reported.username, '')) LIKE :q
        )`,
        { q },
      );
    }

    qb.orderBy('r.created_at', sort === TrustQueueSort.OLDEST ? 'ASC' : 'DESC');

    const [rows, total] = await qb.skip(offset).take(limit).getManyAndCount();

    const typeCounts = await this.getTypeTabCounts();
    const userMap = await this.loadUserBriefs(
      rows.flatMap(
        (r) =>
          [r.reporterId, r.reportedUserId, r.assigneeId].filter(
            Boolean,
          ) as string[],
      ),
    );

    const items = rows.map((r) => ({
      id: r.id,
      publicId: r.publicId,
      type: r.type,
      severity: r.severity,
      status: r.status,
      summary: r.summary,
      submittedAt: r.createdAt.toISOString(),
      slaDeadline: r.slaDeadline.toISOString(),
      reporter: this.mapUserBrief(userMap.get(r.reporterId)),
      reported: this.mapUserBrief(userMap.get(r.reportedUserId)),
      assignee: r.assigneeId
        ? this.mapAssignee(userMap.get(r.assigneeId))
        : null,
    }));

    return successResponse('Operation successful', {
      items,
      total,
      page,
      limit,
      type: typeFilter,
      typeCounts,
    });
  }

  async listAssignees() {
    const admins = await this.userRepo.find({
      where: {
        role: In([UserRoles.ADMIN, UserRoles.SUPER_ADMIN]),
      },
      order: { firstName: 'ASC', lastName: 'ASC', username: 'ASC' },
    });

    return successResponse('Operation successful', {
      items: admins.map((u) => ({
        id: u.id,
        firstName: u.firstName ?? null,
        lastName: u.lastName ?? null,
        username: u.username ?? null,
        profilePicture: u.profilePicture ?? null,
        role: u.role,
        displayName: this.displayName(u),
      })),
    });
  }

  async getReport(reportId: string) {
    const report = await this.findReportOrFail(reportId);

    const userMap = await this.loadUserBriefs(
      [
        report.reporterId,
        report.reportedUserId,
        report.assigneeId,
        report.resolvedById,
      ].filter(Boolean) as string[],
    );

    const [
      corroboratingReports,
      priorViolations,
      notes,
      activities,
      openAgainst,
    ] = await Promise.all([
      this.reportRepo
        .createQueryBuilder('r')
        .where('r.reported_user_id = :uid', { uid: report.reportedUserId })
        .andWhere('r.id != :id', { id: report.id })
        .andWhere('r.status IN (:...statuses)', { statuses: OPEN_STATUSES })
        .getCount(),
      this.reportRepo
        .createQueryBuilder('r')
        .where('r.reported_user_id = :uid', { uid: report.reportedUserId })
        .andWhere('r.status = :status', {
          status: AbuseReportStatus.RESOLVED,
        })
        .andWhere('r.resolution_outcome IN (:...outcomes)', {
          outcomes: UPHELD_OUTCOMES,
        })
        .getCount(),
      this.noteRepo.find({
        where: { reportId: report.id },
        order: { createdAt: 'DESC' },
      }),
      this.activityRepo.find({
        where: { userId: report.reportedUserId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
      this.reportRepo.count({
        where: {
          reportedUserId: report.reportedUserId,
          status: In(OPEN_STATUSES),
        },
      }),
    ]);

    const reported = userMap.get(report.reportedUserId);
    const noteAuthorIds = notes
      .map((n) => n.authorId)
      .filter(Boolean) as string[];
    const noteAuthors = await this.loadUserBriefs(noteAuthorIds);

    const now = Date.now();
    const slaMs = report.slaDeadline.getTime() - now;

    return successResponse('Operation successful', {
      id: report.id,
      publicId: report.publicId,
      type: report.type,
      severity: report.severity,
      status: report.status,
      summary: report.summary,
      description: report.description,
      submittedAt: report.createdAt.toISOString(),
      urgency: {
        severity: report.severity,
        openReportsAgainst: openAgainst,
        priorViolations,
      },
      parties: {
        reporter: this.mapUserBrief(userMap.get(report.reporterId)),
        reported: {
          ...this.mapUserBrief(reported),
          status: reported?.status ?? null,
        },
      },
      evidence: {
        roomKey: report.roomKey,
        liveStreamId: report.liveStreamId,
        viewerCount: report.viewerCount,
        recordingSaved: report.recordingSaved,
        evidenceUrls: report.evidenceUrls,
        corroboratingReports,
        accountStatus: reported?.status ?? null,
        priorViolations,
      },
      accountHistory: activities.map((a) => ({
        id: a.id,
        action: a.action,
        metadata: a.metadata ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
      notes: notes.map((n) => ({
        id: n.id,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
        author: n.authorId
          ? {
              id: n.authorId,
              displayName: this.displayName(noteAuthors.get(n.authorId)),
            }
          : null,
        isSystem: n.authorId == null,
      })),
      assignment: {
        assignee: report.assigneeId
          ? this.mapAssignee(userMap.get(report.assigneeId))
          : null,
        team: 'Trust & Safety',
        priority: report.severity,
        slaDeadline: report.slaDeadline.toISOString(),
        slaRemainingHours: Math.round((slaMs / (60 * 60 * 1000)) * 10) / 10,
        breachingSla: slaMs < 0 && OPEN_STATUSES.includes(report.status),
      },
      resolution: {
        outcome: report.resolutionOutcome,
        notes: report.resolutionNotes,
        resolvedAt: report.resolvedAt?.toISOString() ?? null,
        resolvedBy: report.resolvedById
          ? this.mapAssignee(userMap.get(report.resolvedById))
          : null,
      },
    });
  }

  async addNote(reportId: string, dto: TrustQueueAddNoteDto, authorId: string) {
    await this.findReportOrFail(reportId);
    const note = await this.noteRepo.save(
      this.noteRepo.create({
        reportId,
        authorId,
        body: dto.body.trim(),
      }),
    );
    return successResponse('Note added', {
      id: note.id,
      body: note.body,
      createdAt: note.createdAt.toISOString(),
    });
  }

  async reassign(
    reportId: string,
    dto: TrustQueueReassignDto,
    actorId: string,
  ) {
    const report = await this.findReportOrFail(reportId);
    const assignee = await this.userRepo.findOne({
      where: { id: dto.assigneeId },
    });
    if (!assignee) {
      throw new NotFoundException('Assignee not found');
    }
    if (
      assignee.role !== UserRoles.ADMIN &&
      assignee.role !== UserRoles.SUPER_ADMIN
    ) {
      throw new BadRequestException('Assignee must be an admin');
    }

    report.assigneeId = dto.assigneeId;
    if (report.status === AbuseReportStatus.OPEN) {
      report.status = AbuseReportStatus.IN_REVIEW;
    }
    await this.reportRepo.save(report);

    await this.noteRepo.save(
      this.noteRepo.create({
        reportId: report.id,
        authorId: null,
        body: `Reassigned to ${this.displayName(assignee)} by admin (${actorId}).`,
      }),
    );

    return successResponse('Report reassigned', {
      id: report.id,
      publicId: report.publicId,
      assigneeId: report.assigneeId,
      status: report.status,
    });
  }

  async resolve(reportId: string, dto: TrustQueueResolveDto, actorId: string) {
    const report = await this.findReportOrFail(reportId);
    if (report.status === AbuseReportStatus.RESOLVED) {
      throw new BadRequestException('Report is already resolved');
    }

    const now = new Date();
    report.resolutionOutcome = dto.outcome;
    report.resolutionNotes = dto.notes?.trim() || null;
    report.resolvedById = actorId;

    if (dto.outcome === AbuseReportResolutionOutcome.ESCALATED_FURTHER) {
      report.status = AbuseReportStatus.ESCALATED;
      report.resolvedAt = null;
    } else {
      report.status = AbuseReportStatus.RESOLVED;
      report.resolvedAt = now;
    }

    await this.reportRepo.save(report);

    await this.noteRepo.save(
      this.noteRepo.create({
        reportId: report.id,
        authorId: actorId,
        body: `Resolution: ${dto.outcome}${dto.notes ? ` — ${dto.notes.trim()}` : ''}`,
      }),
    );

    return successResponse('Report resolved', {
      id: report.id,
      publicId: report.publicId,
      status: report.status,
      resolutionOutcome: report.resolutionOutcome,
      resolvedAt: report.resolvedAt?.toISOString() ?? null,
    });
  }

  async suspendReportedUser(reportId: string, actorId: string) {
    const report = await this.findReportOrFail(reportId);
    const user = await this.userRepo.findOne({
      where: { id: report.reportedUserId },
    });
    if (!user) {
      throw new NotFoundException('Reported user not found');
    }

    await this.userRepo.update(user.id, {
      status: UserStatusEnum.SUSPENDED,
    });

    await this.accountActivityService.log({
      userId: user.id,
      action: 'user.status.suspended',
      metadata: {
        reportId: report.id,
        publicId: report.publicId,
        suspendedBy: actorId,
      },
    });

    await this.noteRepo.save(
      this.noteRepo.create({
        reportId: report.id,
        authorId: actorId,
        body: `Reported account suspended from Trust Queue.`,
      }),
    );

    return successResponse('Account suspended', {
      userId: user.id,
      status: UserStatusEnum.SUSPENDED,
      reportId: report.id,
    });
  }

  private async getTypeTabCounts() {
    const rows = await this.reportRepo
      .createQueryBuilder('r')
      .select('r.type', 'type')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('r.type')
      .getRawMany<{ type: AbuseReportType; count: number }>();

    const byType: Record<string, number> = {
      all: 0,
      [AbuseReportType.ABUSE]: 0,
      [AbuseReportType.HARASSMENT]: 0,
      [AbuseReportType.IMPERSONATION]: 0,
      [AbuseReportType.STAGE_MISCONDUCT]: 0,
      [AbuseReportType.SCAM]: 0,
    };

    for (const row of rows) {
      const c = Number(row.count) || 0;
      byType[row.type] = c;
      byType.all += c;
    }

    return byType;
  }

  private async findReportOrFail(reportId: string) {
    const report = await this.reportRepo.findOne({ where: { id: reportId } });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    return report;
  }

  private async loadUserBriefs(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    const map = new Map<string, UserBrief>();
    if (!unique.length) return map;

    const users = await this.userRepo.find({
      where: { id: In(unique) },
    });
    for (const u of users) {
      map.set(u.id, {
        id: u.id,
        username: u.username ?? null,
        firstName: u.firstName ?? null,
        lastName: u.lastName ?? null,
        profilePicture: u.profilePicture ?? null,
        userRefId: u.userRefId ?? null,
        status: u.status,
      });
    }
    return map;
  }

  private mapUserBrief(user?: UserBrief | null) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePicture: user.profilePicture,
      userRefId: user.userRefId,
      displayName: this.displayName(user),
    };
  }

  private mapAssignee(user?: UserBrief | null) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePicture: user.profilePicture,
      displayName: this.displayName(user),
    };
  }

  private displayName(
    user?: Pick<UserBrief, 'firstName' | 'lastName' | 'username'> | User | null,
  ) {
    if (!user) return 'Unknown';
    const name = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (name) return name;
    if (user.username) return `@${user.username}`;
    return 'Unknown';
  }
}
