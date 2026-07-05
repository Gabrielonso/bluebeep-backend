import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LikesService } from './services/likes.services';
import { Like } from './entities/like.entity';
import { EngagementsController } from './engagement.controller';
import { CommentsService } from './services/comments.services';
import { Comment } from './entities/comment.entity';
import { Bookmark } from './entities/bookmark.entity';
import { BookmarksService } from './services/bookmarks.services';
import { Repost } from './entities/repost.entity';
import { RepostsService } from './services/reposts.services';
import { FollowsService } from './services/follows.services';
import { BlocksService } from './services/blocks.services';
import { Follow } from './entities/follow.entity';
import { Block } from './entities/block.entity';
import { User } from '../user/entity/user.entity';
import { NotificationModule } from '../notification/notification.module';
import { UserDisplayModule } from '../user/user-display.module';
import { FeedModule } from '../feeds/feed.module';
import { AccountActivityModule } from '../account-activity/account-activity.module';
import { ModerationModule } from 'src/common/moderation/moderation.module';

@Module({
  providers: [
    LikesService,
    CommentsService,
    BookmarksService,
    RepostsService,
    FollowsService,
    BlocksService,
  ],
  controllers: [EngagementsController],
  imports: [
    TypeOrmModule.forFeature([
      Like,
      Comment,
      Bookmark,
      Repost,
      Follow,
      Block,
      User,
    ]),
    NotificationModule,
    UserDisplayModule,
    FeedModule,
    AccountActivityModule,
    ModerationModule,
  ],
  exports: [FollowsService, BlocksService, CommentsService],
})
export class EngagementsModule {}
