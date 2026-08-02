import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealtimeModule } from 'src/realtime/realtime.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CommandCenterController } from './command-center.controller';
import { CommandCenterService } from './command-center.service';
import { UserIntelligenceController } from './user-intelligence.controller';
import { UserIntelligenceService } from './user-intelligence.service';
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
import { EngagementsModule } from '../engagements/engagements.module';

@Module({
  controllers: [
    AdminController,
    CommandCenterController,
    UserIntelligenceController,
  ],
  providers: [
    AdminService,
    CommandCenterService,
    UserIntelligenceService,
    AdminRiskService,
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
    ]),
    EngagementsModule,
    RealtimeModule,
  ],
})
export class AdminModule {}
