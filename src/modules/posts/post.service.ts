import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CreatePostDto } from './dtos/create-post.dto';
import { successResponse } from 'src/common/helpers/response.helper';
import { Post } from './entities/post.entity';
import { Media } from 'src/modules/media/entities/media.entity';
import { MediaProvider } from 'src/modules/media/enums/media-provider.enum';
import { PostMedia } from './entities/post-media.entity';
import { MediaType } from 'src/modules/media/enums/media-type.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { MediaUploadFolder } from 'src/modules/media/enums/media-upload-folder.enum';
import { User } from '../user/entity/user.entity';
import { FeedType } from '../feeds/enums/feed-type.enum';
import { Ad } from '../ads/entities/ads.entity';
import { normalizeHashtags } from 'src/common/utils/hashtags.util';
import { UpdatePostDto } from './dtos/update-post.dto';
import { TagType } from '../engagements/enums/tag-type.enum';
import { Tag } from '../engagements/entities/tag.entity';
import { AccountActivityService } from '../account-activity/account-activity.service';
import { NotificationDispatcher } from '../notification/notification.dispatcher';
import { TagDto } from '../engagements/dtos/tag.dto';
import { FeedCacheInvalidationService } from '../feeds/feed-cache-invalidation.service';
import { MediaAttachValidator } from '../media/media-attach.validator';
import { MediaDeletionService } from '../media/media-deletion.service';
import { ContentPublishStatus } from '../media/enums/content-publish-status.enum';
import { TextModerationPolicyService } from 'src/common/moderation/text-moderation-policy.service';
import { TextModerationSurface } from 'src/common/moderation/text-moderation.types';
import {
  buildCreateTextFields,
  buildUpdateTextFields,
  moderationSuccessMessage,
} from 'src/common/moderation/text-moderation.helper';

@Injectable()
export class PostService {
  private readonly logger = new Logger(PostService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Post)
    private postRepo: Repository<Post>,
    @InjectRepository(Ad)
    private adRepo: Repository<Ad>,
    private readonly accountActivityService: AccountActivityService,
    private readonly notificationDispatcher: NotificationDispatcher,
    private readonly feedCacheInvalidation: FeedCacheInvalidationService,
    private readonly mediaAttachValidator: MediaAttachValidator,
    private readonly mediaDeletionService: MediaDeletionService,
    private readonly textModerationPolicy: TextModerationPolicyService,
  ) {}

  private async notifyPostTags(
    authorId: string,
    authorUsername: string | undefined,
    postId: string,
    tags: TagDto[],
  ) {
    const notified = new Set<string>();
    for (const tag of tags) {
      const key = `${tag.userId}:${tag.type}`;
      if (!tag.userId || tag.userId === authorId || notified.has(key)) {
        continue;
      }
      notified.add(key);
      await this.notificationDispatcher.notify({
        event: this.notificationDispatcher.eventForTagType(tag.type),
        recipientId: tag.userId,
        actorId: authorId,
        context: {
          actorUsername: authorUsername,
          entity: FeedType.POST,
          entityId: postId,
          tagType: tag.type,
        },
      });
    }
  }

  private async safeInvalidateFeedCaches(
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(
        `Feed cache invalidation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async createPost(dto: CreatePostDto, userId: string) {
    try {
      const result = await this.dataSource.manager.transaction(
        async (entityManager) => {
          const postRepo = entityManager.getRepository(Post);
          const mediaRepo = entityManager.getRepository(Media);
          const postMediaRepo = entityManager.getRepository(PostMedia);
          const userRepo = entityManager.getRepository(User);
          const tagRepo = entityManager.getRepository(Tag);
          const user = await userRepo.findOne({
            where: { id: userId },
            select: ['id', 'username', 'profilePicture'],
          });
          if (!user) {
            throw new HttpException(
              {
                statusCode: HttpStatus.NOT_FOUND,
                message: 'User not found',
              },
              HttpStatus.NOT_FOUND,
            );
          }
          let soundMedia: Media | null = null;
          if (dto.sound) {
            const m = dto.sound;
            if (
              !m.sourceIdOrKey.startsWith(
                `${MediaUploadFolder.POSTS}/${userId}/`,
              )
            ) {
              throw new ForbiddenException('Invalid sound ownership or folder');
            }

            if (m.type !== MediaType.AUDIO) {
              throw new HttpException(
                {
                  statusCode: HttpStatus.BAD_REQUEST,
                  message: 'Post sounds must be of type audio',
                },
                HttpStatus.BAD_REQUEST,
              );
            }

            const isCloudinary = m.provider === MediaProvider.CLOUDINARY;

            const sound = mediaRepo.create({
              provider: m.provider,
              type: m.type,
              sourceIdOrKey: m.sourceIdOrKey,
              duration: m.duration,
              status: this.mediaAttachValidator.resolveLegacyStatus(
                m.provider,
                m.type,
              ),
              originalUrl: m.originalUrl,
              streamUrl: m.streamUrl,
              size: m.size,
            });

            soundMedia = await mediaRepo.save(sound);
          }

          let mediaEntities: Media[] = [];
          if (dto.mediaIds?.length) {
            mediaEntities =
              await this.mediaAttachValidator.validateMediaIdsForAttachPending(
                dto.mediaIds,
                userId,
                MediaUploadFolder.POSTS,
              );
          }
          // else if (dto.media?.length) {
          //   const created = dto.media.map((m) => {
          //     if (
          //       !m.sourceIdOrKey.startsWith(
          //         `${MediaUploadFolder.POSTS}/${userId}/`,
          //       )
          //     ) {
          //       throw new ForbiddenException(
          //         'Invalid media ownership or folder',
          //       );
          //     }

          //     return mediaRepo.create({
          //       provider: m.provider,
          //       type: m.type,
          //       sourceIdOrKey: m.sourceIdOrKey,
          //       width: m.width,
          //       height: m.height,
          //       duration: m.duration,
          //       status: this.mediaAttachValidator.resolveLegacyStatus(
          //         m.provider,
          //         m.type,
          //       ),
          //       originalUrl: m.originalUrl,
          //       streamUrl: m.streamUrl,
          //       size: m.size,
          //     });
          //   });
          //   mediaEntities = await mediaRepo.save(created);
          // }
          else {
            throw new BadRequestException('Provide mediaIds or media');
          }

          const publishStatus =
            this.mediaAttachValidator.resolveInitialPublishStatus(
              mediaEntities,
              soundMedia,
            );

          const captionEvaluation = dto.caption
            ? await this.textModerationPolicy.evaluateText(
                dto.caption,
                TextModerationSurface.POST,
              )
            : null;

          const post = postRepo.create({
            hashtags: normalizeHashtags(dto.hashtags),
            ownerId: user.id,
            sound: soundMedia || undefined,
            allowComments: dto.allowComments ?? true,
            isPublic: dto.isPublic ?? true,
            location: dto.location,
            publishStatus,
            ...(captionEvaluation && dto.caption
              ? buildCreateTextFields(captionEvaluation, dto.caption)
              : {}),
          });
          const savedPost = await postRepo.save(post);

          const postMedias = mediaEntities.map((media, index) =>
            postMediaRepo.create({
              position: index,
              post: savedPost,
              media,
            }),
          );

          await postMediaRepo.save(postMedias);

          if (dto.tags?.length) {
            for (const tag of dto.tags || []) {
              if (tag.type === TagType.MENTION) {
                if (tag.startIndex == null || tag.endIndex == null) {
                  throw new BadRequestException(
                    'Mentions must include startIndex and endIndex',
                  );
                }
              }
            }

            const tagEntities = dto.tags.map((tag) =>
              tagRepo.create({
                entity: FeedType.POST,
                entityId: savedPost.id,
                userId: tag.userId,
                ...(tag.startIndex != null && { startIndex: tag.startIndex }),
                ...(tag.endIndex != null && { endIndex: tag.endIndex }),
                type: tag.type,
              }),
            );

            await tagRepo.save(tagEntities);

            if (publishStatus === ContentPublishStatus.PUBLISHED) {
              await this.notifyPostTags(
                userId,
                user.username,
                savedPost.id,
                dto.tags,
              );
            }
          }

          // enqueue processing ONLY for S3 videos
          mediaEntities
            .filter(
              (m) =>
                m.provider === MediaProvider.S3 && m.type === MediaType.VIDEO,
            )
            .forEach(() => undefined);

          // this.eventBus.publish(
          //   new PostCreatedEvent(post.id, userId),
          // );

          await this.accountActivityService.log({
            userId,
            action: 'post.created',
            metadata: {
              postId: savedPost.id,
              isPublic: savedPost.isPublic,
              allowComments: savedPost.allowComments,
              location: savedPost.location,
              tagsCount: dto.tags?.length || 0,
            },
          });

          return successResponse(
            moderationSuccessMessage(
              'Successfully created post',
              captionEvaluation?.moderationPending ?? false,
            ),
            {
              postId: savedPost.id,
              publishStatus: savedPost.publishStatus,
              moderationPending: captionEvaluation?.moderationPending ?? false,
            },
          );
        },
      );
      if (
        (result.data as { publishStatus?: ContentPublishStatus })
          ?.publishStatus === ContentPublishStatus.PUBLISHED
      ) {
        await this.safeInvalidateFeedCaches(() =>
          this.feedCacheInvalidation.invalidatePublicFeedListCaches(),
        );
      }
      return result;
    } catch (error) {
      throw error;
    }
  }

  async updatePost(postId: string, dto: UpdatePostDto, userId: string) {
    try {
      const post = await this.postRepo.findOne({ where: { id: postId } });
      if (!post) {
        throw new HttpException(
          { statusCode: HttpStatus.NOT_FOUND, message: 'Post not found' },
          HttpStatus.NOT_FOUND,
        );
      }

      if (post.ownerId !== userId) {
        throw new ForbiddenException('You are not allowed to edit this post');
      }

      const updatePayload: Partial<Post> = {};
      let moderationPending = false;
      if (dto.caption !== undefined) {
        const evaluation = await this.textModerationPolicy.evaluateText(
          dto.caption,
          TextModerationSurface.POST,
        );
        Object.assign(
          updatePayload,
          buildUpdateTextFields(evaluation, dto.caption, post.content),
        );
        moderationPending = evaluation.moderationPending;
      }
      if (dto.hashtags !== undefined)
        updatePayload.hashtags = normalizeHashtags(dto.hashtags);
      if (dto.allowComments !== undefined)
        updatePayload.allowComments = dto.allowComments;
      if (dto.isPublic !== undefined) updatePayload.isPublic = dto.isPublic;
      if (dto.location !== undefined) updatePayload.location = dto.location;

      await this.postRepo.update({ id: postId }, updatePayload as any);

      if (dto.tags?.length) {
        await this.dataSource.transaction(async (manager) => {
          const tagRepo = manager.getRepository(Tag);
          const user = await manager.getRepository(User).findOne({
            where: { id: userId },
            select: ['id', 'username'],
          });
          if (!user) return;

          for (const tag of dto.tags || []) {
            if (tag.type === TagType.MENTION) {
              if (tag.startIndex == null || tag.endIndex == null) {
                throw new BadRequestException(
                  'Mentions must include startIndex and endIndex',
                );
              }
            }
          }

          const existingTags = await tagRepo.find({
            where: { entity: FeedType.POST, entityId: postId },
            select: ['userId'],
          });
          const existingUserIds = new Set(existingTags.map((t) => t.userId));

          const newTags = (dto.tags || []).filter(
            (t) => t.userId && !existingUserIds.has(t.userId),
          );
          if (!newTags.length) return;

          const tagEntities = newTags.map((tag) =>
            tagRepo.create({
              entity: FeedType.POST,
              entityId: postId,
              userId: tag.userId,
              ...(tag.startIndex != null && { startIndex: tag.startIndex }),
              ...(tag.endIndex != null && { endIndex: tag.endIndex }),
              type: tag.type,
            }),
          );
          await tagRepo.save(tagEntities);
          await this.notifyPostTags(userId, user.username, postId, newTags);
        });
      }

      await this.accountActivityService.log({
        userId,
        action: 'post.updated',
        metadata: { postId },
      });

      await this.safeInvalidateFeedCaches(() =>
        this.feedCacheInvalidation.invalidatePostAndPublicList(postId),
      );

      return successResponse(
        moderationSuccessMessage('Successfully updated post', moderationPending),
        { moderationPending },
      );
    } catch (error) {
      throw error;
    }
  }

  // async getMyPostFeeds(postFilterDto: PostFilterDto, userId: string) {
  //   try {
  //     const page = Number(postFilterDto.page) || 1;
  //     const limit = Number(postFilterDto.limit) || 20;
  //     const offset = (page - 1) * limit;

  //     const rows = await this.dataSource.query(
  //       `
  //       (
  //         SELECT
  //           p.id,
  //           'post' AS type,
  //           p.created_at AS "createdAt"
  //         FROM posts p WHERE p.owner_id = $3
  //       )
  //       UNION ALL
  //       (
  //         SELECT
  //           a.id,
  //           'ad' AS type,
  //           a.created_at AS "createdAt"
  //         FROM ads a WHERE a.owner_id = $3
  //       )
  //       ORDER BY "createdAt" DESC
  //       LIMIT $1 OFFSET $2
  //       `,
  //       [limit, offset, userId],
  //     );

  //     return this.hydrateMyFeed(userId, rows, page, limit);
  //   } catch (error) {
  //     throw error;
  //   }
  // }

  // private async hydrateMyFeed(
  //   viewerId: string,
  //   rows: RawFeedRow[],
  //   page: number,
  //   limit: number,
  // ) {
  //   const postIds = rows
  //     .filter((r) => r.type === FeedType.POST)
  //     .map((r) => r.id);

  //   const adIds = rows.filter((r) => r.type === FeedType.AD).map((r) => r.id);

  //   // Fetch posts exactly how you already do
  //   const posts = postIds.length
  //     ? await this.postRepo
  //         .createQueryBuilder('post')
  //         .leftJoinAndSelect('post.medias', 'medias')
  //         .select(['post', 'medias'])
  //         .leftJoinAndSelect('medias.media', 'media')
  //         .where('post.id IN (:...ids)', { ids: postIds })
  //         .getMany()
  //     : [];

  //   // Fetch ads (simple)
  //   const ads = adIds.length
  //     ? await this.adRepo
  //         .createQueryBuilder('ad')
  //         .leftJoinAndSelect('ad.medias', 'medias')
  //         .select(['ad', 'medias'])
  //         .leftJoinAndSelect('medias.media', 'media')
  //         .where('ad.id IN (:...ids)', { ids: adIds })
  //         .getMany()
  //     : [];

  //   const likes = viewerId
  //     ? await this.dataSource.query(
  //         `
  //       SELECT entity, entity_id
  //       FROM likes
  //       WHERE user_id = $1
  //         AND (
  //           (entity = 'post' AND entity_id = ANY($2))
  //           OR
  //           (entity = 'ad' AND entity_id = ANY($3))
  //         )
  //       `,
  //         [viewerId, postIds, adIds],
  //       )
  //     : [];

  //   const bookmarks = viewerId
  //     ? await this.dataSource.query(
  //         `
  //       SELECT entity, entity_id
  //       FROM bookmarks
  //       WHERE user_id = $1
  //         AND (
  //           (entity = 'post' AND entity_id = ANY($2))
  //           OR
  //           (entity = 'ad' AND entity_id = ANY($3))
  //         )
  //       `,
  //         [viewerId, postIds, adIds],
  //       )
  //     : [];

  //   const likedSet = new Set(likes?.map((l) => `${l?.entity}:${l?.entity_id}`));

  //   const bookmarkedSet = new Set(
  //     bookmarks?.map((l) => `${l?.entity}:${l?.entity_id}`),
  //   );

  //   // Map for fast lookup
  //   const postMap = new Map(
  //     posts.map((p) => [
  //       p.id,
  //       {
  //         ...p,
  //         viewerHasLiked: likedSet.has(`${FeedType.POST}:${p.id}`),
  //         viewerHasBookmarked: bookmarkedSet.has(`${FeedType.POST}:${p.id}`),
  //       },
  //     ]),
  //   );
  //   const adMap = new Map(
  //     ads.map((a) => [
  //       a.id,
  //       {
  //         ...a,
  //         viewerHasLiked: likedSet.has(`${FeedType.AD}:${a.id}`),
  //         viewerHasBookmarked: bookmarkedSet.has(`${FeedType.AD}:${a.id}`),
  //       },
  //     ]),
  //   );

  //   // Rebuild ordered feed
  //   const feed = rows.map((row) => {
  //     if (row.type === FeedType.POST) {
  //       return {
  //         type: 'post',
  //         data: postMap.get(row.id),
  //       };
  //     }

  //     return {
  //       type: 'ad',
  //       data: adMap.get(row.id),
  //     };
  //   });

  //   return successResponse('Operation Successful', {
  //     data: feed,
  //     currentPage: page,
  //     totalPages: Math.ceil(feed.length / limit),
  //   });
  // }

  async deletePost(postId: string, userId: string) {
    try {
      let mediaIdsToCleanup: string[] = [];

      const result = await this.dataSource.manager.transaction(
        async (entityManager) => {
          const postRepo = entityManager.getRepository(Post);
          const postMediaRepo = entityManager.getRepository(PostMedia);
          const tagRepo = entityManager.getRepository(Tag);
          const post = await postRepo.findOne({
            where: { id: postId },
            relations: { medias: { media: true }, sound: true },
          });
          if (!post) {
            throw new HttpException(
              { statusCode: HttpStatus.NOT_FOUND, message: 'Post not found' },
              HttpStatus.NOT_FOUND,
            );
          }

          if (post.ownerId !== userId) {
            throw new ForbiddenException(
              'You are not allowed to delete this post',
            );
          }

          mediaIdsToCleanup = [
            ...(post.medias ?? []).map((pm) => pm.media?.id),
            post.sound?.id,
          ].filter((id): id is string => !!id);

          await postMediaRepo.delete({ post: { id: postId } });
          await postRepo.delete({ id: postId });

          await tagRepo.delete({ entity: FeedType.POST, entityId: postId });
          await this.accountActivityService.log({
            userId,
            action: 'post.deleted',
            metadata: { postId },
          });

          return successResponse('Successfully deleted post');
        },
      );

      if (mediaIdsToCleanup.length > 0) {
        await this.mediaDeletionService.deleteOrphanMedias(mediaIdsToCleanup);
      }

      await this.safeInvalidateFeedCaches(() =>
        this.feedCacheInvalidation.invalidatePostAndPublicList(postId),
      );
      return result;
    } catch (error) {
      throw error;
    }
  }
}
