import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { Media } from './entities/media.entity';
import { MediaStatus } from './enums/media-status.enum';
import { ModerationStatus } from './enums/moderation-status.enum';
import { ContentPublishStatus } from './enums/content-publish-status.enum';
import { MediaPipelineService } from './media-pipeline.service';
import { ContentPublishService } from './content-publish.service';
import { PostMedia } from '../posts/entities/post-media.entity';
import { Post } from '../posts/entities/post.entity';
import { AdMedia } from '../ads/entities/ads-media.entity';
import { Ad } from '../ads/entities/ads.entity';
import { Status } from '../status/entities/status.entity';

const RECONCILE_INTERVAL_MS = 3 * 60 * 1000;
const STUCK_AFTER_MS = 5 * 60 * 1000;
const BATCH_SIZE = 50;

@Injectable()
export class MediaPipelineReconcilerService implements OnModuleInit {
  private readonly logger = new Logger(MediaPipelineReconcilerService.name);
  private running = false;

  constructor(
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>,
    @InjectRepository(PostMedia)
    private readonly postMediaRepo: Repository<PostMedia>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    @InjectRepository(AdMedia)
    private readonly adMediaRepo: Repository<AdMedia>,
    @InjectRepository(Ad)
    private readonly adRepo: Repository<Ad>,
    @InjectRepository(Status)
    private readonly statusRepo: Repository<Status>,
    private readonly pipelineService: MediaPipelineService,
    private readonly contentPublishService: ContentPublishService,
  ) {}

  onModuleInit() {
    void this.reconcile();
    setInterval(() => void this.reconcile(), RECONCILE_INTERVAL_MS);
  }

  async reconcile(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
      const moderationRequeued = await this.requeueStuckModeration(cutoff);
      const transcodeRequeued = await this.requeueStuckTranscode(cutoff);
      const publishReevaluated = await this.reevaluateMissedPublish();

      if (
        moderationRequeued > 0 ||
        transcodeRequeued > 0 ||
        publishReevaluated > 0
      ) {
        this.logger.log(
          `Reconciler sweep: moderation=${moderationRequeued} transcode=${transcodeRequeued} publish=${publishReevaluated}`,
        );
      }
    } catch (err) {
      this.logger.error('Media pipeline reconciler failed', err);
    } finally {
      this.running = false;
    }
  }

  private async requeueStuckModeration(cutoff: Date): Promise<number> {
    const stuck = await this.mediaRepo.find({
      where: {
        status: MediaStatus.MODERATING,
        moderationStatus: ModerationStatus.PENDING,
        updatedAt: LessThan(cutoff),
      },
      take: BATCH_SIZE,
      order: { updatedAt: 'ASC' },
    });

    let count = 0;
    for (const media of stuck) {
      try {
        await this.pipelineService.enqueueModeration(media.id);
        count += 1;
      } catch (err) {
        this.logger.error(
          `Failed to requeue moderation for ${media.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
    return count;
  }

  private async requeueStuckTranscode(cutoff: Date): Promise<number> {
    const stuck = await this.mediaRepo.find({
      where: {
        status: MediaStatus.PROCESSING,
        moderationStatus: In([
          ModerationStatus.PASSED,
          ModerationStatus.SKIPPED,
        ]),
        updatedAt: LessThan(cutoff),
      },
      take: BATCH_SIZE,
      order: { updatedAt: 'ASC' },
    });

    let count = 0;
    for (const media of stuck) {
      try {
        await this.pipelineService.enqueueTranscode(media.id);
        count += 1;
      } catch (err) {
        this.logger.error(
          `Failed to requeue transcode for ${media.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
    return count;
  }

  /**
   * Re-run publish evaluation when media is already cleared but linked
   * content is still pending (missed onMediaTerminalUpdate).
   */
  private async reevaluateMissedPublish(): Promise<number> {
    const mediaIds = await this.findClearedMediaIdsWithPendingContent();
    let count = 0;
    for (const mediaId of mediaIds.slice(0, BATCH_SIZE)) {
      try {
        await this.contentPublishService.onMediaTerminalUpdate(mediaId);
        count += 1;
      } catch (err) {
        this.logger.error(
          `Failed to re-evaluate publish for media ${mediaId}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
    return count;
  }

  private async findClearedMediaIdsWithPendingContent(): Promise<string[]> {
    const cleared = [
      ModerationStatus.PASSED,
      ModerationStatus.SKIPPED,
    ] as const;
    const pending = ContentPublishStatus.PENDING;

    const fromPostMedia = await this.postMediaRepo
      .createQueryBuilder('pm')
      .innerJoin('pm.post', 'post')
      .innerJoin(Media, 'media', 'media.id = pm.mediaId')
      .select('media.id', 'id')
      .where('post.publishStatus = :pending', { pending })
      .andWhere('media.moderationStatus IN (:...cleared)', { cleared })
      .limit(BATCH_SIZE)
      .getRawMany<{ id: string }>();

    const fromPostSound = await this.postRepo
      .createQueryBuilder('post')
      .innerJoin(Media, 'media', 'media.id = post.sound_media_id')
      .select('media.id', 'id')
      .where('post.publishStatus = :pending', { pending })
      .andWhere('media.moderationStatus IN (:...cleared)', { cleared })
      .limit(BATCH_SIZE)
      .getRawMany<{ id: string }>();

    const fromAdMedia = await this.adMediaRepo
      .createQueryBuilder('am')
      .innerJoin('am.ad', 'ad')
      .innerJoin(Media, 'media', 'media.id = am.mediaId')
      .select('media.id', 'id')
      .where('ad.publishStatus = :pending', { pending })
      .andWhere('media.moderationStatus IN (:...cleared)', { cleared })
      .limit(BATCH_SIZE)
      .getRawMany<{ id: string }>();

    const fromAdSound = await this.adRepo
      .createQueryBuilder('ad')
      .innerJoin(Media, 'media', 'media.id = ad.sound_media_id')
      .select('media.id', 'id')
      .where('ad.publishStatus = :pending', { pending })
      .andWhere('media.moderationStatus IN (:...cleared)', { cleared })
      .limit(BATCH_SIZE)
      .getRawMany<{ id: string }>();

    const fromStatus = await this.statusRepo
      .createQueryBuilder('status')
      .innerJoin(Media, 'media', 'media.id = status.mediaId')
      .select('media.id', 'id')
      .where('status.publishStatus = :pending', { pending })
      .andWhere('media.moderationStatus IN (:...cleared)', { cleared })
      .limit(BATCH_SIZE)
      .getRawMany<{ id: string }>();

    return [
      ...new Set(
        [
          ...fromPostMedia,
          ...fromPostSound,
          ...fromAdMedia,
          ...fromAdSound,
          ...fromStatus,
        ].map((row) => row.id),
      ),
    ];
  }
}
