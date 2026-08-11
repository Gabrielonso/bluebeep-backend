import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealtimeModule } from 'src/realtime/realtime.module';
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

@Module({
  controllers: [
    AdminController,
    CommandCenterController,
    UserIntelligenceController,
    TrustQueueController,
    AdminRiskEngineController,
  ],
  providers: [
    AdminService,
    CommandCenterService,
    UserIntelligenceService,
    TrustQueueService,
    AdminRiskService,
    AdminRiskEngineService,
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
    ]),
    EngagementsModule,
    RealtimeModule,
    AccountActivityModule,
    ReportsModule,
  ],
})
export class AdminModule {}
