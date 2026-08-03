import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { successResponse } from 'src/common/helpers/response.helper';
import { AccountActivityService } from '../account-activity/account-activity.service';
import { User } from '../user/entity/user.entity';
import { slaDeadlineFromSeverity } from './abuse-report-sla';
import { CreateReportDto } from './dtos/create-report.dto';
import { AbuseReportNote } from './entities/abuse-report-note.entity';
import { AbuseReport } from './entities/abuse-report.entity';
import { AbuseReportSeverity } from './enums/abuse-report-severity.enum';
import { AbuseReportStatus } from './enums/abuse-report-status.enum';

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
        type: dto.type,
        severity,
        status: AbuseReportStatus.OPEN,
        summary: dto.summary.trim(),
        description: dto.description.trim(),
        assigneeId: null,
        liveStreamId: dto.liveStreamId ?? null,
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
        slaDeadline: report.slaDeadline.toISOString(),
        createdAt: report.createdAt.toISOString(),
      },
      201,
    );
  }
}
