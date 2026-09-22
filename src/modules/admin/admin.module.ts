import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { JobQueue } from 'src/common/enums/jobs.enum';
import { RealtimeModule } from 'src/realtime/realtime.module';
import { NotificationModule } from '../notification/notification.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CommandCenterController } from './command-center.controller';
import { CommandCenterService } from './command-center.service';
import { UserIntelligenceController } from './user-intelligence.controller';
import { UserIntelligenceService } from './user-intelligence.service';
import { TrustQueueController } from './trust-queue.controller';
import { TrustQueueService } from './trust-queue.service';
import { AdminRiskEngineController } from './risk/admin-risk-engine.controller';
import { AdminRiskEngineService } from './risk/admin-risk-engine.service';
import { AdminRiskService } from './risk/admin-risk.service';
import { Comment } from '../engagements/entities/comment.entity';
import { Post } from '../posts/entities/post.entity';
import { Ad } from '../ads/entities/ads.entity';
import { Thought } from '../thought/entities/thought.entity';
import { Status } from '../status/entities/status.entity';
import { User } from '../user/entity/user.entity';
import { Media } from '../media/entities/media.entity';
import { AccountActivity } from '../account-activity/entities/account-activity.entity';
import { CallSession } from '../calls/entities/call-session.entity';
import { LiveStream } from '../live-streams/entities/live-stream.entity';
import { AbuseReport } from '../reports/entities/abuse-report.entity';
import { AbuseReportNote } from '../reports/entities/abuse-report-note.entity';
import { EngagementsModule } from '../engagements/engagements.module';
import { AccountActivityModule } from '../account-activity/account-activity.module';
import { ReportsModule } from '../reports/reports.module';
import { AdminAccessController } from './access/admin-access.controller';
import { AdminInviteController } from './access/admin-invite.controller';
import { AdminSettingsController } from './access/admin-settings.controller';
import { PlatformController } from './access/platform.controller';
import { AdminAccessService } from './access/admin-access.service';
import { AdminSettingsService } from './access/admin-settings.service';
import { AdminSessionListener } from './access/admin-session.listener';
import { AdminMembershipGuard } from './access/guards/admin-membership.guard';
import { AdminPermissionGuard } from './access/guards/admin-permission.guard';
import { AdminMembership } from './access/entities/admin-membership.entity';
import { AdminPermission } from './access/entities/admin-permission.entity';
import { AdminRolePermission } from './access/entities/admin-role-permission.entity';
import { PlatformSettings } from './access/entities/platform-settings.entity';
import { AdminAuditEvent } from './access/entities/admin-audit-event.entity';

@Module({
  controllers: [
    AdminController,
    CommandCenterController,
    UserIntelligenceController,
    TrustQueueController,
    AdminRiskEngineController,
    AdminAccessController,
    AdminInviteController,
    AdminSettingsController,
    PlatformController,
  ],
  providers: [
    AdminService,
    CommandCenterService,
    UserIntelligenceService,
    TrustQueueService,
    AdminRiskService,
    AdminRiskEngineService,
    AdminAccessService,
    AdminSettingsService,
    AdminSessionListener,
    AdminMembershipGuard,
    AdminPermissionGuard,
  ],
  imports: [
    TypeOrmModule.forFeature([
      Comment,
      Post,
      Ad,
      Thought,
      Status,
      User,
      Media,
      AccountActivity,
      CallSession,
      LiveStream,
      AbuseReport,
      AbuseReportNote,
      AdminMembership,
      AdminPermission,
      AdminRolePermission,
      PlatformSettings,
      AdminAuditEvent,
    ]),
    EngagementsModule,
    RealtimeModule,
    AccountActivityModule,
    ReportsModule,
    NotificationModule,
    BullModule.registerQueue({ name: JobQueue.EMAILS }),
  ],
})
export class AdminModule {}
