import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MEDIA_MODERATION_QUEUE } from '../media.queue';
import { MEDIA_JOB_MODERATE, MediaPipelineService } from '../media-pipeline.service';
import { Media } from '../entities/media.entity';
import { MediaStatus } from '../enums/media-status.enum';
import { ModerationStatus } from '../enums/moderation-status.enum';
import { MediaModerationService } from 'src/common/moderation/media-moderation.service';
import { ModerationPolicyService } from 'src/common/moderation/moderation-policy.service';
import { ContentPublishService } from '../content-publish.service';
import { assertMediaUpdated } from '../media-update.util';

/** BullMQ default lock is 30s — video Rekognition can poll ~5 minutes. */
const MODERATION_WORKER_OPTIONS = {
  lockDuration: 600_000,
  stalledInterval: 120_000,
  maxStalledCount: 2,
} as const;

@Processor(MEDIA_MODERATION_QUEUE, MODERATION_WORKER_OPTIONS)
export class MediaModerationProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaModerationProcessor.name);

  constructor(
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>,
    private readonly moderationService: MediaModerationService,
    private readonly moderationPolicy: ModerationPolicyService,
    private readonly pipelineService: MediaPipelineService,
    private readonly contentPublishService: ContentPublishService,
  ) {
    super();
  }

  async process(job: Job<{ mediaId: string }>) {
    if (job.name !== MEDIA_JOB_MODERATE) {
      return;
    }

    const media = await this.mediaRepo.findOne({
      where: { id: job.data.mediaId },
    });

    if (!media) {
      this.logger.warn(
        `Moderation job for missing media ${job.data.mediaId}, completing without update`,
      );
      return;
    }

    if (!this.moderationPolicy.shouldModerate(media)) {
      const skipped = await this.mediaRepo.update(media.id, {
        moderationStatus: ModerationStatus.SKIPPED,
      });
      assertMediaUpdated(skipped, media.id, 'moderation → skipped');
      this.logger.log(
        `media lifecycle mediaId=${media.id} moderating→skipped`,
      );
      await this.contentPublishService.onMediaTerminalUpdate(media.id);
      await this.pipelineService.enqueueTranscode(media.id);
      return;
    }

    let result: Awaited<ReturnType<MediaModerationService['moderate']>>;
    try {
      result = await this.moderationService.moderate(media);
    } catch (error) {
      this.logger.error(
        `Moderation failed for ${media.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      const failed = await this.mediaRepo.update(media.id, {
        status: MediaStatus.FAILED,
        moderationStatus: ModerationStatus.PENDING,
        rejectionReason:
          error instanceof Error ? error.message : 'Moderation failed',
      });
      assertMediaUpdated(failed, media.id, 'moderation → failed');
      this.logger.log(
        `media lifecycle mediaId=${media.id} moderating→failed`,
      );
      await this.contentPublishService.onMediaTerminalUpdate(media.id);
      throw error;
    }

    if (!result.passed) {
      const rejected = await this.mediaRepo.update(media.id, {
        status: MediaStatus.REJECTED,
        moderationStatus: ModerationStatus.REJECTED,
        moderationLabels: result.labels as Record<string, any>,
        rejectionReason: result.rejectionReason,
        moderatedAt: new Date(),
      });
      assertMediaUpdated(rejected, media.id, 'moderation → rejected');
      this.logger.log(
        `media lifecycle mediaId=${media.id} moderating→rejected`,
      );
      await this.contentPublishService.onMediaTerminalUpdate(media.id);
      return;
    }

    const passed = await this.mediaRepo.update(media.id, {
      moderationStatus: ModerationStatus.PASSED,
      moderationLabels: result.labels as Record<string, any>,
      moderatedAt: new Date(),
    });
    assertMediaUpdated(passed, media.id, 'moderation → passed');
    this.logger.log(`media lifecycle mediaId=${media.id} moderating→passed`);
    // Publish before transcode so enqueue failures cannot leave content pending.
    await this.contentPublishService.onMediaTerminalUpdate(media.id);
    await this.pipelineService.enqueueTranscode(media.id);
  }
}
