import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';
import { StatusCleanupService } from './status-cleanup.service';
import { Status } from './entities/status.entity';
import { StatusView } from './entities/status-view.entity';
import { Media } from '../media/entities/media.entity';
import { User } from '../user/entity/user.entity';
import { Follow } from '../engagements/entities/follow.entity';
import { UserDisplayModule } from '../user/user-display.module';
import { MediaModule } from '../media/media.module';
import { ModerationModule } from 'src/common/moderation/moderation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Status, StatusView, Media, User, Follow]),
    UserDisplayModule,
    MediaModule,
    ModerationModule,
  ],
  controllers: [StatusController],
  providers: [StatusService, StatusCleanupService],
})
export class StatusModule {}
