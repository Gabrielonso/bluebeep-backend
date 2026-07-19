import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MEDIA_MODERATION_QUEUE,
  MEDIA_TRANSCODE_QUEUE,
} from './media.queue';
import { Media } from './entities/media.entity';
import { MediaStatus } from './enums/media-status.enum';
import { ModerationStatus } from './enums/moderation-status.enum';
import { ModerationPolicyService } from 'src/common/moderation/moderation-policy.service';
import { S3Provider } from 'src/common/s3/s3.provider';
import { MediaProvider } from './enums/media-provider.enum';
import { ContentPublishService } from './content-publish.service';
import { assertMediaUpdated } from './media-update.util';

export const MEDIA_JOB_MODERATE = 'moderate';
export const MEDIA_JOB_TRANSCODE = 'transcode';

const ACTIVE_JOB_STATES = ['waiting', 'delayed', 'active'] as const;

@Injectable()
export class MediaPipelineService {
  private readonly logger = new Logger(MediaPipelineService.name);

  constructor(
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>,
    @InjectQueue(MEDIA_MODERATION_QUEUE)
    private readonly moderationQueue: Queue,
    @InjectQueue(MEDIA_TRANSCODE_QUEUE)
    private readonly transcodeQueue: Queue,
    private readonly moderationPolicy: ModerationPolicyService,
    private readonly s3Provider: S3Provider,
    private readonly contentPublishService: ContentPublishService,
  ) {}

  async routeAfterUpload(mediaId: string): Promise<Media> {
    const media = await this.mediaRepo.findOneByOrFail({ id: mediaId });

    if (media.provider !== MediaProvider.S3) {
      throw new Error('Pipeline routing is only supported for S3 media');
    }

    const exists = await this.s3Provider.objectExists(media.sourceIdOrKey);
    if (!exists) {
      throw new Error('Uploaded object not found in S3');
    }

    const contentLength = await this.s3Provider.getObjectContentLength(
      media.sourceIdOrKey,
    );
    if (
      contentLength !== null &&
      media.size &&
      Math.abs(contentLength - media.size) > 1024
    ) {
      this.logger.warn(
        `S3 object size mismatch for ${mediaId}: declared ${media.size}, actual ${contentLength}`,
      );
    }

    const originalUrl = this.s3Provider.getPublicUrl(media.sourceIdOrKey);
    const uploaded = await this.mediaRepo.update(mediaId, {
      status: MediaStatus.UPLOADED,
      originalUrl,
    });
    assertMediaUpdated(uploaded, mediaId, 'routeAfterUpload → uploaded');
    this.logger.log(`media lifecycle mediaId=${mediaId} → uploaded`);

    if (this.moderationPolicy.shouldModerate(media)) {
      const moderating = await this.mediaRepo.update(mediaId, {
        moderationStatus: ModerationStatus.PENDING,
        status: MediaStatus.MODERATING,
      });
      assertMediaUpdated(moderating, mediaId, 'routeAfterUpload → moderating');
      this.logger.log(
        `media lifecycle mediaId=${mediaId} uploaded→moderating`,
      );
      await this.enqueueModeration(mediaId);
    } else {
      const skipped = await this.mediaRepo.update(mediaId, {
        moderationStatus: ModerationStatus.SKIPPED,
      });
      assertMediaUpdated(skipped, mediaId, 'routeAfterUpload → skipped');
      this.logger.log(
        `media lifecycle mediaId=${mediaId} uploaded→skipped`,
      );
      // Publish before transcode so enqueue failures cannot leave content pending.
      await this.contentPublishService.onMediaTerminalUpdate(mediaId);
      await this.enqueueTranscode(mediaId);
      this.logger.log(`Skipped moderation, enqueued transcode for ${mediaId}`);
    }

    return this.mediaRepo.findOneByOrFail({ id: mediaId });
  }

  async enqueueModeration(mediaId: string): Promise<void> {
    const jobId = `moderate:${mediaId}`;
    const existing = await this.moderationQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if ((ACTIVE_JOB_STATES as readonly string[]).includes(state)) {
        this.logger.log(
          `Moderation already ${state} for media ${mediaId}, skipping enqueue`,
        );
        return;
      }
      await existing.remove();
    }

    await this.moderationQueue.add(
      MEDIA_JOB_MODERATE,
      { mediaId },
      {
        jobId,
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
    this.logger.log(`Enqueued moderation for media ${mediaId}`);
  }

  async enqueueTranscode(mediaId: string): Promise<void> {
    const processing = await this.mediaRepo.update(mediaId, {
      status: MediaStatus.PROCESSING,
    });
    assertMediaUpdated(processing, mediaId, 'enqueueTranscode → processing');
    this.logger.log(`media lifecycle mediaId=${mediaId} → processing`);

    const jobId = `transcode:${mediaId}`;
    const existing = await this.transcodeQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if ((ACTIVE_JOB_STATES as readonly string[]).includes(state)) {
        this.logger.log(
          `Transcode already ${state} for media ${mediaId}, skipping enqueue`,
        );
        return;
      }
      await existing.remove();
    }

    await this.transcodeQueue.add(
      MEDIA_JOB_TRANSCODE,
      { mediaId },
      {
        jobId,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
    this.logger.log(`Enqueued transcode for media ${mediaId}`);
  }
}
