import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entity/user.entity';
import { AccountActivityModule } from '../account-activity/account-activity.module';
import { UserDisplayModule } from './user-display.module';
import { MediaModule } from '../media/media.module';
import { EngagementsModule } from '../engagements/engagements.module';
import { FeedModule } from '../feeds/feed.module';
import { ModerationModule } from 'src/common/moderation/moderation.module';

@Module({
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
  imports: [
    TypeOrmModule.forFeature([User]),
    AccountActivityModule,
    UserDisplayModule,
    MediaModule,
    EngagementsModule,
    FeedModule,
    ModerationModule,
  ],
})
export class UserModule {}
