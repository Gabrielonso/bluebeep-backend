import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { successResponse } from 'src/common/helpers/response.helper';
import { AccountActivityService } from '../account-activity/account-activity.service';
import { Ad } from '../ads/entities/ads.entity';
import { ChatMessage } from '../chats/entities/chat-message.entity';
import { Comment } from '../engagements/entities/comment.entity';
import { LiveStream } from '../live-streams/entities/live-stream.entity';
import { Post } from '../posts/entities/post.entity';
import { Status } from '../status/entities/status.entity';
import { Thought } from '../thought/entities/thought.entity';
import { User } from '../user/entity/user.entity';
import { slaDeadlineFromSeverity } from './abuse-report-sla';
import { CreateReportDto } from './dtos/create-report.dto';
import { AbuseReportNote } from './entities/abuse-report-note.entity';
import { AbuseReport } from './entities/abuse-report.entity';
import { AbuseReportSeverity } from './enums/abuse-report-severity.enum';
import { AbuseReportStatus } from './enums/abuse-report-status.enum';
import { AbuseReportTargetType } from './enums/abuse-report-target-type.enum';

@Injectable()
export class ReportsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly accountActivityService: AccountActivityService,
  ) {}

  async createReport(dto: CreateReportDto, reporterId: string) {
    if (dto.reportedUserId === reporterId) {
      throw new BadRequestException('You cannot report yourself');
    }

    const reported = await this.userRepo.findOne({
      where: { id: dto.reportedUserId },
    });
    if (!reported) {
      throw new NotFoundException('Reported user not found');
    }

    const target = await this.resolveContentTarget(dto);

    const severity = dto.severity ?? AbuseReportSeverity.MEDIUM;
    const slaDeadline = slaDeadlineFromSeverity(severity);

    const report = await this.dataSource.transaction(async (manager) => {
      const seqRows = await manager.query(
        `SELECT nextval('abuse_report_public_id_seq')::int AS n`,
      );
      const n = Number(seqRows[0]?.n ?? 0);
      const publicId = `RPT-${n}`;

      const created = manager.create(AbuseReport, {
        publicId,
        reporterId,
        reportedUserId: dto.reportedUserId,
        targetType: target.targetType,
        targetId: target.targetId,
        type: dto.type,
        severity,
        status: AbuseReportStatus.OPEN,
        summary: dto.summary.trim(),
        description: dto.description.trim(),
        assigneeId: null,
        liveStreamId: target.liveStreamId,
        roomKey: dto.roomKey?.trim() || null,
        viewerCount: dto.viewerCount ?? null,
        recordingSaved: dto.recordingSaved ?? null,
        evidenceUrls: dto.evidenceUrls?.length ? dto.evidenceUrls : null,
        resolutionOutcome: null,
        resolutionNotes: null,
        resolvedAt: null,
        resolvedById: null,
        slaDeadline,
      });

      const saved = await manager.save(AbuseReport, created);

      await manager.save(
        AbuseReportNote,
        manager.create(AbuseReportNote, {
          reportId: saved.id,
          authorId: null,
          body: `Report ${publicId} filed.`,
        }),
      );

      return saved;
    });

    await this.accountActivityService.log({
      userId: reporterId,
      action: 'user.report.created',
      metadata: {
        reportId: report.id,
        publicId: report.publicId,
        reportedUserId: report.reportedUserId,
        type: report.type,
        targetType: report.targetType,
        targetId: report.targetId,
      },
    });

    return successResponse(
      'Report submitted',
      {
        id: report.id,
        publicId: report.publicId,
        type: report.type,
        severity: report.severity,
        status: report.status,
        summary: report.summary,
        reportedUserId: report.reportedUserId,
        targetType: report.targetType,
        targetId: report.targetId,
        slaDeadline: report.slaDeadline.toISOString(),
        createdAt: report.createdAt.toISOString(),
      },
      201,
    );
  }

  private async resolveContentTarget(dto: CreateReportDto): Promise<{
    targetType: AbuseReportTargetType | null;
    targetId: string | null;
    liveStreamId: string | null;
  }> {
    const targetType = dto.targetType ?? null;
    const targetId = dto.targetId ?? null;
    let liveStreamId = dto.liveStreamId ?? null;

    if (!targetType || !targetId) {
      return { targetType: null, targetId: null, liveStreamId };
    }

    const ownerId = await this.findTargetOwnerId(targetType, targetId);
    if (ownerId === undefined) {
      throw new NotFoundException('Reported content not found');
    }
    if (!ownerId || ownerId !== dto.reportedUserId) {
      throw new BadRequestException(
        'Reported content does not belong to the reported user',
      );
    }

    if (targetType === AbuseReportTargetType.LIVE_STREAM) {
      if (liveStreamId && liveStreamId !== targetId) {
        throw new BadRequestException(
          'liveStreamId must match the reported live stream',
        );
      }
      liveStreamId = targetId;
    }

    return { targetType, targetId, liveStreamId };
  }

  private async findTargetOwnerId(
    targetType: AbuseReportTargetType,
    targetId: string,
  ): Promise<string | null | undefined> {
    switch (targetType) {
      case AbuseReportTargetType.POST: {
        const row = await this.dataSource.getRepository(Post).findOne({
          where: { id: targetId },
          select: ['id', 'ownerId'],
        });
        return row ? row.ownerId : undefined;
      }
      case AbuseReportTargetType.COMMENT: {
        const row = await this.dataSource.getRepository(Comment).findOne({
          where: { id: targetId },
          select: ['id', 'userId'],
        });
        return row ? row.userId : undefined;
      }
      case AbuseReportTargetType.THOUGHT: {
        const row = await this.dataSource.getRepository(Thought).findOne({
          where: { id: targetId },
          select: ['id', 'ownerId'],
        });
        return row ? row.ownerId : undefined;
      }
      case AbuseReportTargetType.STATUS: {
        const row = await this.dataSource.getRepository(Status).findOne({
          where: { id: targetId },
          withDeleted: true,
          select: ['id', 'ownerId'],
        });
        return row ? row.ownerId : undefined;
      }
      case AbuseReportTargetType.LIVE_STREAM: {
        const row = await this.dataSource.getRepository(LiveStream).findOne({
          where: { id: targetId },
          select: ['id', 'hostId'],
        });
        return row ? row.hostId : undefined;
      }
      case AbuseReportTargetType.CHAT_MESSAGE: {
        const row = await this.dataSource.getRepository(ChatMessage).findOne({
          where: { id: targetId },
          withDeleted: true,
          select: ['id', 'senderId'],
        });
        return row ? row.senderId : undefined;
      }
      case AbuseReportTargetType.AD: {
        const row = await this.dataSource.getRepository(Ad).findOne({
          where: { id: targetId },
          select: ['id', 'ownerId'],
        });
        return row ? row.ownerId : undefined;
      }
      default:
        return undefined;
    }
  }
}
