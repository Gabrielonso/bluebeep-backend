import { DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { User } from '../modules/user/entity/user.entity';
import { Post } from 'src/modules/posts/entities/post.entity';
import { PostView } from 'src/modules/posts/entities/post-view.entity';
import { Media } from 'src/modules/media/entities/media.entity';
import { PostMedia } from 'src/modules/posts/entities/post-media.entity';
import { Ad } from 'src/modules/ads/entities/ads.entity';
import { AdMedia } from 'src/modules/ads/entities/ads-media.entity';
import { Like } from 'src/modules/engagements/entities/like.entity';
import { Repost } from 'src/modules/engagements/entities/repost.entity';
import { Share } from 'src/modules/engagements/entities/share.entity';
import { Comment } from 'src/modules/engagements/entities/comment.entity';
import { Bookmark } from 'src/modules/engagements/entities/bookmark.entity';
import { Follow } from 'src/modules/engagements/entities/follow.entity';
import { Tag } from 'src/modules/engagements/entities/tag.entity';
import { Block } from 'src/modules/engagements/entities/block.entity';
import { AccountActivity } from 'src/modules/account-activity/entities/account-activity.entity';
import { Notification } from 'src/modules/notification/entity/notification.entity';
import { Thought } from 'src/modules/thought/entities/thought.entity';
import { ChatMessage } from 'src/modules/chats/entities/chat-message.entity';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import { ChatParticipant } from 'src/modules/chats/entities/chat-participant.entity';
import { MessageReceipt } from 'src/modules/chats/entities/message-receipt.entity';
import { MessageAttachment } from 'src/modules/chats/entities/message-attachment.entity';
import { Status } from 'src/modules/status/entities/status.entity';
import { StatusView } from 'src/modules/status/entities/status-view.entity';
import { CallSession } from 'src/modules/calls/entities/call-session.entity';
dotenv.config();
export const ormConfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl:
    process.env.NODE_ENV === 'development'
      ? false
      : {
          rejectUnauthorized: true,
          ca: process.env.DB_SSL
            ? fs.readFileSync(process.env.DB_SSL, 'utf8')
            : undefined,
        },
  synchronize: process.env.DB_SYNCHRONIZATION === 'true',
  logging: process.env.DB_LOGGING === 'true',
  entities: [
    User,
    Post,
    PostView,
    Media,
    PostMedia,
    Ad,
    AdMedia,
    Like,
    Repost,
    Share,
    Comment,
    Bookmark,
    Follow,
    Tag,
    Block,
    AccountActivity,
    Notification,
    Thought,
    ChatMessage,
    Chat,
    ChatParticipant,
    MessageReceipt,
    MessageAttachment,
    Status,
    StatusView,
    CallSession,
  ],
  migrations: [],
};
