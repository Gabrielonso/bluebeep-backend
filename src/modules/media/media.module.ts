import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { MEDIA_PROVIDER } from 'src/common/constants';
import { MediaService } from './media.service';
import { S3Provider } from 'src/common/s3/s3.provider';
import { CloudinaryProvider } from 'src/common/cloudinary/cloudinary.provider';
import { CloudinaryCleanupService } from 'src/common/cloudinary/cloudinary-cleanup.service';
import { MediaController } from './media.controller';
import { Media } from './entities/media.entity';
import { MediaStorageRegistry } from 'src/common/media/media-storage.registry';
import { MediaUrlResolver } from 'src/common/media/media-url.resolver';
import { ModerationModule } from 'src/common/moderation/moderation.module';
import { MediaPipelineService } from './media-pipeline.service';
import { MediaPipelineReconcilerService } from './media-pipeline-reconciler.service';
import { MediaAttachValidator } from './media-attach.validator';
import { MediaUsageService } from './media-usage.service';
import { MediaDeletionService } from './media-deletion.service';
import { MediaQueueService } from './media-queue.service';
import { ContentPublishService } from './content-publish.service';
import { MediaCancelListener } from './listeners/media-cancel.listener';
import { RealtimeModule } from 'src/realtime/realtime.module';
import { FeedModule } from '../feeds/feed.module';
import { NotificationModule } from '../notification/notification.module';
import { Post } from '../posts/entities/post.entity';
import { PostMedia } from '../posts/entities/post-media.entity';
import { Ad } from '../ads/entities/ads.entity';
import { AdMedia } from '../ads/entities/ads-media.entity';
import { Status } from '../status/entities/status.entity';
import { MessageAttachment } from '../chats/entities/message-attachment.entity';
import { Tag } from '../engagements/entities/tag.entity';
import { User } from '../user/entity/user.entity';
import {
  MEDIA_CANCEL_QUEUE,
  MEDIA_MODERATION_QUEUE,
  MEDIA_TRANSCODE_QUEUE,
} from './media.queue';
import { MediaModerationProcessor } from './processors/media-moderation.processor';
import { MediaTranscodeProcessor } from './processors/media-transcode.processor';
import { MediaCancelProcessor } from './processors/media-cancel.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Media,
      Post,
      PostMedia,
      Ad,
      AdMedia,
      Status,
      MessageAttachment,
      Tag,
      User,
    ]),
    BullModule.registerQueue(
      { name: MEDIA_MODERATION_QUEUE },
      {
        name: MEDIA_TRANSCODE_QUEUE,
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 50,
        },
      },
      { name: MEDIA_CANCEL_QUEUE },
    ),
    ModerationModule,
    forwardRef(() => RealtimeModule),
    forwardRef(() => FeedModule),
    forwardRef(() => NotificationModule),
  ],
  providers: [
    S3Provider,
    CloudinaryCleanupService,
    CloudinaryProvider,
    MediaStorageRegistry,
    MediaUrlResolver,
    {
      provide: MEDIA_PROVIDER,
      useFactory: (registry: MediaStorageRegistry) => registry.getDefault(),
      inject: [MediaStorageRegistry],
    },
    MediaService,
    MediaPipelineService,
    MediaPipelineReconcilerService,
    MediaAttachValidator,
    MediaUsageService,
    MediaDeletionService,
    MediaQueueService,
    ContentPublishService,
    MediaCancelListener,
    MediaModerationProcessor,
    MediaTranscodeProcessor,
    MediaCancelProcessor,
  ],
  controllers: [MediaController],
  exports: [
    MEDIA_PROVIDER,
    MediaStorageRegistry,
    MediaUrlResolver,
    MediaAttachValidator,
    MediaUsageService,
    MediaDeletionService,
    CloudinaryCleanupService,
    MediaService,
    ContentPublishService,
  ],
})
export class MediaModule {}
