import { Inject, Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import {
  ApiResponse,
  successResponse,
} from 'src/common/helpers/response.helper';
import { InjectRepository } from '@nestjs/typeorm';
import { FeedFilterDto } from './dtos/feed-filter.dto';
import {
  CachedBaseEntity,
  FeedReposterDto,
  FollowPairRow,
  HydrateFeedOptions,
  LikeBookmarkRow,
  PostCandidateRow,
  RawFeedRow,
  RankedFeedCandidate,
  ReposterRow,
  RepostRow,
  RepostsByPostId,
  SeenPostMap,
  SeenPostRow,
  TagDto,
  TagRow,
} from './types/feed.types';
import { Ad } from 'src/modules/ads/entities/ads.entity';
import { Post } from 'src/modules/posts/entities/post.entity';
import { Follow } from 'src/modules/engagements/entities/follow.entity';
import { FeedType } from './enums/feed-type.enum';
import { REDIS_CLIENT } from 'src/common/redis/redis.constants';
import Redis from 'ioredis';
import {
  feedBaseKey,
  feedTagsKey,
  publicFeedListCacheKey,
  rankedFeedListCacheKey,
} from './feed-cache.keys';
import { UserDisplayService } from '../user/user-display.service';
import {
  collectUserIds,
  resolveUserDisplay,
  stripLegacyOwnerFields,
} from '../user/helpers/user-display.helper';
import { UserDisplay } from '../user/types/user-display.types';
import { MediaUrlResolver } from 'src/common/media/media-url.resolver';
import { Media } from 'src/modules/media/entities/media.entity';
import { PostMedia } from '../posts/entities/post-media.entity';
import { FeedRankingService } from './feed-ranking.service';
import { FEED_RANKING, FeedPoolSource } from './feed-ranking.config';
import { textModerationVisibleSql } from 'src/common/moderation/text-moderation-visibility.util';

@Injectable()
export class FeedService {
  private readonly baseEntityTtlSeconds = 300;
  private readonly tagsTtlSeconds = 300;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Post)
    private postRepo: Repository<Post>,
    @InjectRepository(Ad)
    private adRepo: Repository<Ad>,
    @InjectRepository(Follow)
    private followRepo: Repository<Follow>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly userDisplayService: UserDisplayService,
    private readonly mediaUrlResolver: MediaUrlResolver,
    private readonly feedRankingService: FeedRankingService,
  ) {}

  private encodeCursor(input: { createdAt: string; id: string }) {
    return Buffer.from(JSON.stringify(input), 'utf8').toString('base64');
  }

  private decodeCursor(
    cursor?: string,
  ): { createdAt: string; id: string } | null {
    if (!cursor) return null;
    try {
      const raw = Buffer.from(cursor, 'base64').toString('utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;

      const obj = parsed as Record<string, unknown>;

      const createdAt = obj.createdAt;
      const id = obj.id;
      if (typeof createdAt !== 'string' || typeof id !== 'string') return null;
      return { createdAt, id };
    } catch {
      return null;
    }
  }

  private async mgetJson<T>(keys: string[]): Promise<(T | null)[]> {
    if (!keys.length) return [];
    const raw = await this.redis.mget(keys);
    return raw.map((v) => {
      if (!v) return null;
      try {
        return JSON.parse(v) as T;
      } catch {
        return null;
      }
    });
  }

  private async setJson(key: string, value: unknown, ttlSeconds: number) {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  private isFeedMediaVisible(
    media: Media,
    viewerId: string | undefined,
    ownerId: string | undefined,
  ): boolean {
    const isOwner = !!viewerId && !!ownerId && viewerId === ownerId;
    return isOwner
      ? this.mediaUrlResolver.hasPlayback(media)
      : this.mediaUrlResolver.isPubliclyVisible(media);
  }

  private enrichFeedEntity<T extends CachedBaseEntity>(
    entity: T,
    displayMap: Map<string, UserDisplay>,
    viewerId?: string,
  ) {
    const base = stripLegacyOwnerFields(entity as Record<string, unknown>);
    const tags = ((entity.tags as TagDto[] | undefined) ?? []).map((tag) => {
      const user = resolveUserDisplay(displayMap, tag.userId);
      return {
        ...tag,
        user: user!,
      };
    });

    const withMedia = this.enrichFeedMedia(base as T, viewerId);

    return {
      ...withMedia,
      owner: resolveUserDisplay(
        displayMap,
        entity.ownerId as string | undefined,
      ),
      tags,
    };
  }

  private enrichFeedMedia<T extends CachedBaseEntity>(
    entity: T,
    viewerId?: string,
  ): T {
    const ownerId = entity.ownerId as string | undefined;
    const medias = (entity as { medias?: PostMedia[] }).medias;
    const sound = (entity as { sound?: Media }).sound;

    const enrichedMedias = medias
      ?.filter(
        (item) =>
          item.media &&
          this.isFeedMediaVisible(item.media, viewerId, ownerId),
      )
      .map((item) => ({
        ...item,
        media: this.mediaUrlResolver.toPlaybackPayload(item.media),
      }));

    const enrichedSound =
      sound && this.isFeedMediaVisible(sound, viewerId, ownerId)
        ? this.mediaUrlResolver.toPlaybackPayload(sound)
        : null;

    return {
      ...entity,
      ...(enrichedMedias ? { medias: enrichedMedias } : {}),
      ...(sound !== undefined ? { sound: enrichedSound } : {}),
    };
  }

  private collectFeedUserIds(
    posts: CachedBaseEntity[],
    ads: CachedBaseEntity[],
  ): string[] {
    const tagUserIds = [...posts, ...ads].flatMap((entity) =>
      ((entity.tags as TagDto[] | undefined) ?? []).map((tag) => tag.userId),
    );

    return collectUserIds(
      posts.map((post) => post.ownerId as string | undefined),
      ads.map((ad) => ad.ownerId as string | undefined),
      tagUserIds,
    );
  }

  private async getFollowingIds(viewerId: string): Promise<string[]> {
    const follows = await this.followRepo.find({
      where: { followerId: viewerId },
      select: ['followingId'],
    });
    return [...new Set(follows.map((f) => f.followingId))];
  }

  private async loadSeenPosts(
    viewerId: string,
    postIds: string[],
  ): Promise<SeenPostMap> {
    const map: SeenPostMap = new Map();
    if (!postIds.length) return map;

    const rows: SeenPostRow[] = await this.dataSource.query(
      `
      SELECT post_id, viewed_at
      FROM post_views
      WHERE viewer_id = $1 AND post_id = ANY($2)
      `,
      [viewerId, postIds],
    );

    for (const row of rows) {
      map.set(row.post_id, row.viewed_at);
    }
    return map;
  }

  private async loadFollowedRepostsByPostId(
    viewerId: string | undefined,
    postIds: string[],
    profileOwnerId?: string,
  ): Promise<RepostsByPostId> {
    const result: RepostsByPostId = new Map();
    if (!postIds.length || (!viewerId && !profileOwnerId)) return result;

    const followedRows: ReposterRow[] = viewerId
      ? await this.dataSource.query(
          `
      SELECT r.post_id, r.user_id, r.created_at
      FROM reposts r
      INNER JOIN follows f
        ON f.follower_id = $1 AND f.following_id = r.user_id
      WHERE r.post_id = ANY($2)
        AND r.created_at > NOW() - make_interval(days => $3)
      ORDER BY r.created_at DESC
      `,
          [viewerId, postIds, FEED_RANKING.REPOST_MAX_AGE_DAYS],
        )
      : [];

    let profileRows: ReposterRow[] = [];
    if (profileOwnerId) {
      profileRows = await this.dataSource.query(
        `
        SELECT r.post_id, r.user_id, r.created_at
        FROM reposts r
        WHERE r.post_id = ANY($1)
          AND r.user_id = $2
          AND r.created_at > NOW() - make_interval(days => $3)
        ORDER BY r.created_at DESC
        `,
        [postIds, profileOwnerId, FEED_RANKING.REPOST_MAX_AGE_DAYS],
      );
    }

    const grouped = new Map<string, ReposterRow[]>();
    for (const row of [...followedRows, ...profileRows]) {
      if (!grouped.has(row.post_id)) grouped.set(row.post_id, []);
      const list = grouped.get(row.post_id)!;
      if (!list.some((r) => r.user_id === row.user_id)) {
        list.push(row);
      }
    }

    const allUserIds = [
      ...new Set(
        [...grouped.values()].flatMap((rows) => rows.map((r) => r.user_id)),
      ),
    ];
    const displayMap = await this.userDisplayService.getByIds(allUserIds);

    for (const [postId, rows] of grouped) {
      const sorted = rows.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      const reposters: FeedReposterDto[] = [];
      for (const row of sorted) {
        const display = resolveUserDisplay(displayMap, row.user_id);
        if (display) {
          reposters.push({
            id: display.id,
            username: display.username,
            ...(display.profilePicture
              ? { profilePicture: display.profilePicture }
              : {}),
          });
        }
      }
      if (reposters.length) result.set(postId, reposters);
    }

    return result;
  }

  private toRankedCandidate(
    row: PostCandidateRow,
    pool: FeedPoolSource,
  ): RankedFeedCandidate {
    const type =
      row.type === 'ad'
        ? FeedType.AD
        : row.type === 'repost'
          ? 'repost'
          : FeedType.POST;

    return {
      id: row.id,
      type,
      createdAt: row.createdAt,
      pool,
      ownerId: row.ownerId,
      likeCount: row.likeCount,
      commentCount: row.commentCount,
      repostCount: row.repostCount,
      viewCount: row.viewCount,
      latestRepostAt: row.latestRepostAt,
    };
  }

  private async fetchFollowingPostCandidates(
    followingIds: string[],
    overfetch: number,
  ): Promise<RankedFeedCandidate[]> {
    if (!followingIds.length) return [];

    const rows: PostCandidateRow[] = await this.dataSource.query(
      `
      SELECT
        p.id,
        'post' AS type,
        p.created_at AS "createdAt",
        p.owner_id AS "ownerId",
        p.like_count AS "likeCount",
        p.comment_count AS "commentCount",
        p.repost_count AS "repostCount",
        p.view_count AS "viewCount"
      FROM posts p
      WHERE p.owner_id = ANY($1)
        AND p.is_public = true
        AND p.publish_status = 'published'
        AND ${textModerationVisibleSql('p')}
      ORDER BY p.created_at DESC
      LIMIT $2
      `,
      [followingIds, overfetch],
    );

    return rows.map((r) => this.toRankedCandidate(r, 'following'));
  }

  private async fetchDiscoveryPostCandidates(
    viewerId: string,
    followingIds: string[],
    overfetch: number,
  ): Promise<RankedFeedCandidate[]> {
    const rows: PostCandidateRow[] = await this.dataSource.query(
      `
      SELECT
        p.id,
        'post' AS type,
        p.created_at AS "createdAt",
        p.owner_id AS "ownerId",
        p.like_count AS "likeCount",
        p.comment_count AS "commentCount",
        p.repost_count AS "repostCount",
        p.view_count AS "viewCount"
      FROM posts p
      WHERE p.is_public = true
        AND p.publish_status = 'published'
        AND ${textModerationVisibleSql('p')}
        AND (
          p.owner_id = $1
          OR cardinality($2::uuid[]) = 0
          OR NOT (p.owner_id = ANY($2))
        )
      ORDER BY p.created_at DESC
      LIMIT $3
      `,
      [viewerId, followingIds, overfetch],
    );

    return rows.map((r) => this.toRankedCandidate(r, 'discovery'));
  }

  private async fetchFollowedRepostCandidates(
    viewerId: string,
    overfetch: number,
  ): Promise<RankedFeedCandidate[]> {
    const rows: PostCandidateRow[] = await this.dataSource.query(
      `
      WITH followed_reposts AS (
        SELECT
          r.post_id,
          r.user_id,
          r.created_at,
          MAX(r.created_at) OVER (PARTITION BY r.post_id) AS latest_repost_at,
          p.owner_id,
          p.like_count,
          p.comment_count,
          p.repost_count,
          p.view_count
        FROM reposts r
        INNER JOIN follows f
          ON f.follower_id = $1 AND f.following_id = r.user_id
        INNER JOIN posts p ON p.id = r.post_id
          AND p.is_public = true AND p.publish_status = 'published'
          AND ${textModerationVisibleSql('p')}
        WHERE r.created_at > NOW() - make_interval(days => $3)
      )
      SELECT DISTINCT ON (post_id)
        post_id AS id,
        'repost' AS type,
        latest_repost_at AS "createdAt",
        latest_repost_at AS "latestRepostAt",
        owner_id AS "ownerId",
        like_count AS "likeCount",
        comment_count AS "commentCount",
        repost_count AS "repostCount",
        view_count AS "viewCount"
      FROM followed_reposts
      ORDER BY post_id, created_at DESC
      LIMIT $2
      `,
      [viewerId, overfetch, FEED_RANKING.REPOST_MAX_AGE_DAYS],
    );

    return rows.map((r) => this.toRankedCandidate(r, 'repost'));
  }

  private async fetchAdCandidates(
    overfetch: number,
  ): Promise<RankedFeedCandidate[]> {
    const rows: PostCandidateRow[] = await this.dataSource.query(
      `
      SELECT
        a.id,
        'ad' AS type,
        a.created_at AS "createdAt",
        a.owner_id AS "ownerId"
      FROM ads a
      WHERE a.publish_status = 'published'
        AND ${textModerationVisibleSql('a')}
      ORDER BY a.created_at DESC
      LIMIT $1
      `,
      [overfetch],
    );

    return rows.map((r) => this.toRankedCandidate(r, 'ad'));
  }

  async hydrateFeed(
    viewerId: string | undefined,
    rows: RawFeedRow[],
    page: number,
    limit: number,
    total: number,
    options: HydrateFeedOptions = {},
  ) {
    const {
      repostsByPostId,
      seenPostMap,
      includeReposts = true,
    } = options;
    const postIds = [
      ...new Set(
        rows
          .filter((r) => r.type === FeedType.POST || r.type === 'repost')
          .map((r) => r.id),
      ),
    ];

    const adIds = rows.filter((r) => r.type === FeedType.AD).map((r) => r.id);

    // ----------------------------
    // Smarter caching strategy:
    // - cache base post/ad payloads (shared, non-viewer specific)
    // - cache tags (shared)
    // - compute viewer-specific flags (likes/bookmarks/follows) per request
    // ----------------------------

    // 1) Tags: fetch from cache first
    const postTagKeys = postIds.map((id) => feedTagsKey(FeedType.POST, id));

    const adTagKeys = adIds.map((id) => feedTagsKey(FeedType.AD, id));

    const cachedPostTags = await this.mgetJson<TagDto[]>(postTagKeys);

    const cachedAdTags = await this.mgetJson<TagDto[]>(adTagKeys);

    const tagsByEntity = new Map<string, TagDto[]>();
    const missingPostTagIds: string[] = [];
    const missingAdTagIds: string[] = [];

    for (let i = 0; i < postIds.length; i++) {
      const id = postIds[i];
      const tags = cachedPostTags[i];
      if (tags) tagsByEntity.set(`${FeedType.POST}:${id}`, tags);
      else missingPostTagIds.push(id);
    }
    for (let i = 0; i < adIds.length; i++) {
      const id = adIds[i];
      const tags = cachedAdTags[i];
      if (tags) tagsByEntity.set(`${FeedType.AD}:${id}`, tags);
      else missingAdTagIds.push(id);
    }

    if (missingPostTagIds.length || missingAdTagIds.length) {
      const allTags =
        missingPostTagIds.length || missingAdTagIds.length
          ? await this.dataSource.query(
              `
              SELECT 
                entity::text AS entity,
                entity_id,
                id,
                user_id,
                type,
                start_index,
                end_index,
                created_at
              FROM tags
              WHERE 
                (entity = 'post' AND entity_id = ANY($1))
                OR
                (entity = 'ad' AND entity_id = ANY($2))
              ORDER BY created_at ASC
              `,
              [
                missingPostTagIds.length ? missingPostTagIds : [null],
                missingAdTagIds.length ? missingAdTagIds : [null],
              ],
            )
          : [];

      const tagMap = new Map<string, TagDto[]>();
      for (const tag of allTags as TagRow[]) {
        const key = `${tag.entity}:${tag.entity_id}`;
        if (!tagMap.has(key)) tagMap.set(key, []);
        tagMap.get(key)!.push({
          id: tag.id,
          userId: tag.user_id,
          type: tag.type,
          ...(tag.start_index != null ? { startIndex: tag.start_index } : {}),
          ...(tag.end_index != null ? { endIndex: tag.end_index } : {}),
          createdAt: tag.created_at,
        });
      }

      // Write missing tag keys
      const pipeline = this.redis.pipeline();
      for (const id of missingPostTagIds) {
        const key = `${FeedType.POST}:${id}`;
        const tags = tagMap.get(key) || [];
        tagsByEntity.set(key, tags);
        pipeline.set(
          feedTagsKey(FeedType.POST, id),
          JSON.stringify(tags),
          'EX',
          this.tagsTtlSeconds,
        );
      }
      for (const id of missingAdTagIds) {
        const key = `${FeedType.AD}:${id}`;
        const tags = tagMap.get(key) || [];
        tagsByEntity.set(key, tags);
        pipeline.set(
          feedTagsKey(FeedType.AD, id),
          JSON.stringify(tags),
          'EX',
          this.tagsTtlSeconds,
        );
      }
      await pipeline.exec();
    }

    // 2) Base posts/ads: fetch from cache first
    const postBaseKeys = postIds.map((id) => feedBaseKey(FeedType.POST, id));

    const adBaseKeys = adIds.map((id) => feedBaseKey(FeedType.AD, id));

    const cachedPosts = await this.mgetJson<CachedBaseEntity>(postBaseKeys);

    const cachedAds = await this.mgetJson<CachedBaseEntity>(adBaseKeys);

    const missingPostIds = postIds.filter((_, idx) => !cachedPosts[idx]);

    const missingAdIds = adIds.filter((_, idx) => !cachedAds[idx]);

    const fetchedPosts = missingPostIds.length
      ? await this.postRepo
          .createQueryBuilder('post')
          .leftJoinAndSelect('post.medias', 'medias')
          .leftJoinAndSelect('post.sound', 'sound')
          .select(['post', 'medias', 'sound'])
          .leftJoinAndSelect('medias.media', 'media')
          .where('post.id IN (:...ids)', { ids: missingPostIds })
          .getMany()
      : [];

    const fetchedAds = missingAdIds.length
      ? await this.adRepo
          .createQueryBuilder('ad')
          .leftJoinAndSelect('ad.medias', 'medias')
          .leftJoinAndSelect('ad.sound', 'sound')
          .select(['ad', 'medias', 'sound'])
          .leftJoinAndSelect('medias.media', 'media')
          .where('ad.id IN (:...ids)', { ids: missingAdIds })
          .getMany()
      : [];

    // Attach tags + cache the base entities
    if (fetchedPosts.length || fetchedAds.length) {
      const pipeline = this.redis.pipeline();
      for (const p of fetchedPosts) {
        const enriched = {
          ...p,
          tags: tagsByEntity.get(`${FeedType.POST}:${p.id}`) || [],
        };
        pipeline.set(
          feedBaseKey(FeedType.POST, p.id),
          JSON.stringify(enriched),
          'EX',
          this.baseEntityTtlSeconds,
        );
      }
      for (const a of fetchedAds) {
        const enriched = {
          ...a,
          tags: tagsByEntity.get(`${FeedType.AD}:${a.id}`) || [],
        };
        pipeline.set(
          feedBaseKey(FeedType.AD, a.id),
          JSON.stringify(enriched),
          'EX',
          this.baseEntityTtlSeconds,
        );
      }
      await pipeline.exec();
    }

    // Rebuild full post/ad arrays in the same order as ids
    const fetchedPostMap = new Map(fetchedPosts.map((p) => [p.id, p]));
    const fetchedAdMap = new Map(fetchedAds.map((a) => [a.id, a]));

    const posts: CachedBaseEntity[] = postIds
      .map((id, idx) => {
        const cached = cachedPosts[idx];
        if (cached) return cached;
        const p = fetchedPostMap.get(id);
        if (!p) return null;
        return {
          ...(p as unknown as CachedBaseEntity),
          tags: tagsByEntity.get(`${FeedType.POST}:${id}`) || [],
        };
      })
      .filter((v): v is CachedBaseEntity => v != null);

    const ads: CachedBaseEntity[] = adIds
      .map((id, idx) => {
        const cached = cachedAds[idx];
        if (cached) return cached;
        const a = fetchedAdMap.get(id);
        if (!a) return null;
        return {
          ...(a as unknown as CachedBaseEntity),
          tags: tagsByEntity.get(`${FeedType.AD}:${id}`) || [],
        };
      })
      .filter((v): v is CachedBaseEntity => v != null);

    const likes: LikeBookmarkRow[] = viewerId
      ? await this.dataSource.query(
          `
        SELECT entity, entity_id
        FROM likes
        WHERE user_id = $1
          AND (
            (entity = 'post' AND entity_id = ANY($2))
            OR
            (entity = 'ad' AND entity_id = ANY($3))
          )
        `,
          [viewerId, postIds, adIds],
        )
      : [];

    const bookmarks: LikeBookmarkRow[] = viewerId
      ? await this.dataSource.query(
          `
        SELECT entity, entity_id
        FROM bookmarks
        WHERE user_id = $1
          AND (
            (entity = 'post' AND entity_id = ANY($2))
            OR
            (entity = 'ad' AND entity_id = ANY($3))
          )
        `,
          [viewerId, postIds, adIds],
        )
      : [];

    const reposts: RepostRow[] =
      viewerId && postIds.length
        ? await this.dataSource.query(
            `
        SELECT post_id
        FROM reposts
        WHERE user_id = $1
          AND post_id = ANY($2)
        `,
            [viewerId, postIds],
          )
        : [];

    const likedSet = new Set(likes.map((l) => `${l.entity}:${l.entity_id}`));

    const bookmarkedSet = new Set(
      bookmarks.map((l) => `${l.entity}:${l.entity_id}`),
    );

    const repostedSet = new Set(reposts.map((r) => r.post_id));

    // 3) Follow flags: compute in one query per page
    const ownerIds = viewerId
      ? [
          ...new Set(
            [...posts, ...ads]
              .map((e) => e.ownerId)
              .filter((id: string | undefined) => !!id && id !== viewerId),
          ),
        ]
      : [];

    const followPairs: FollowPairRow[] =
      viewerId && ownerIds.length
        ? await this.dataSource.query(
            `
            SELECT follower_id, following_id
            FROM follows
            WHERE
              (follower_id = $1 AND following_id = ANY($2))
              OR
              (following_id = $1 AND follower_id = ANY($2))
            `,
            [viewerId, ownerIds],
          )
        : [];

    const viewerFollows = new Set<string>();
    const ownerFollowsViewer = new Set<string>();
    for (const row of followPairs) {
      if (row.follower_id === viewerId) {
        viewerFollows.add(row.following_id);
      } else if (row.following_id === viewerId) {
        ownerFollowsViewer.add(row.follower_id);
      }
    }

    const reposterIds = includeReposts
      ? [...(repostsByPostId?.values() ?? [])].flatMap((reposts) =>
          reposts.map((r) => r.id),
        )
      : [];

    const displayMap = await this.userDisplayService.getByIds([
      ...this.collectFeedUserIds(posts, ads),
      ...reposterIds,
    ]);

    // Map for fast lookup
    const postMap = new Map(
      posts.map((p) => [
        p.id,
        {
          ...this.enrichFeedEntity(p, displayMap, viewerId),
          viewerHasLiked: likedSet.has(`${FeedType.POST}:${p.id}`),
          viewerHasBookmarked: bookmarkedSet.has(`${FeedType.POST}:${p.id}`),
          viewerHasReposted: viewerId ? repostedSet.has(p.id) : false,
          viewerFollowsOwner: viewerId
            ? viewerFollows.has(p.ownerId || '')
            : false,
          ownerFollowsViewer: viewerId
            ? ownerFollowsViewer.has(p.ownerId || '')
            : false,
          ...(viewerId && seenPostMap
            ? { viewerHasSeen: seenPostMap.has(p.id) }
            : {}),
        },
      ]),
    );
    const adMap = new Map(
      ads.map((a) => [
        a.id,
        {
          ...this.enrichFeedEntity(a, displayMap, viewerId),
          viewerHasLiked: likedSet.has(`${FeedType.AD}:${a.id}`),
          viewerHasBookmarked: bookmarkedSet.has(`${FeedType.AD}:${a.id}`),
          viewerHasReposted: false,
          viewerFollowsOwner: viewerId
            ? viewerFollows.has(a.ownerId || '')
            : false,
          ownerFollowsViewer: viewerId
            ? ownerFollowsViewer.has(a.ownerId || '')
            : false,
        },
      ]),
    );

    // Rebuild ordered feed
    const feed = rows.map((row) => {
      if (row.type === FeedType.POST || row.type === 'repost') {
        const postData = postMap.get(row.id);
        const reposts =
          includeReposts && repostsByPostId
            ? (repostsByPostId.get(row.id) ?? []).slice(
                0,
                FEED_RANKING.REPOSTS_DISPLAY_CAP,
              )
            : [];

        return {
          type: 'post',
          data: {
            ...postData,
            ...(includeReposts ? { reposts } : {}),
          },
        };
      }

      if (row.type === FeedType.AD) {
        return {
          type: 'ad',
          data: adMap.get(row.id),
        };
      }

      return {
        type: 'post',
        data: postMap.get(row.id),
      };
    });

    return successResponse('Operation Successful', {
      data: feed,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
    });
  }

  async getFeed(userId: string | undefined, feedFilterDto: FeedFilterDto) {
    if (!userId) {
      return this.getChronologicalFeed(userId, feedFilterDto);
    }
    return this.getRankedFeed(userId, feedFilterDto);
  }

  private async getChronologicalFeed(
    userId: string | undefined,
    feedFilterDto: FeedFilterDto,
  ) {
    const limit = Math.min(50, Number(feedFilterDto.limit) || 20);
    const decoded = this.decodeCursor(feedFilterDto.cursor);
    const cursorCreatedAt = decoded?.createdAt;
    const cursorId = decoded?.id;

    const cacheKey = publicFeedListCacheKey({
      viewerKey: userId || 'anon',
      limit,
      cursorToken: feedFilterDto.cursor || 'first',
    });

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as ApiResponse<unknown>;
      } catch {
        // ignore cache parse errors
      }
    }

    const rows: RawFeedRow[] = await this.dataSource.query(
      `
      (
        SELECT
          p.id,
          'post' AS type,
          p.created_at AS "createdAt"
        FROM posts p
        WHERE p.is_public = true
          AND p.publish_status = 'published'
        AND ${textModerationVisibleSql('p')}
          AND (
            $2::timestamp IS NULL
            OR (p.created_at, p.id) < ($2::timestamp, $3::uuid)
          )
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $1
      )
      UNION ALL
      (
        SELECT
          a.id,
          'ad' AS type,
          a.created_at AS "createdAt"
        FROM ads a
        WHERE a.publish_status = 'published'
        AND ${textModerationVisibleSql('a')}
          AND (
          $2::timestamp IS NULL
          OR (a.created_at, a.id) < ($2::timestamp, $3::uuid)
        )
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $1
      )
      ORDER BY "createdAt" DESC, id DESC
      LIMIT $1
      `,
      [limit, cursorCreatedAt || null, cursorId || null],
    );

    const page = Number(feedFilterDto.page) || 1;
    const total = limit;

    const response = await this.hydrateFeed(userId, rows, page, limit, total, {
      includeReposts: false,
    });
    const responseData = (response.data ?? {}) as Record<string, unknown>;

    const last = rows[rows.length - 1];
    const nextCursor =
      last?.createdAt && last?.id
        ? this.encodeCursor({
            createdAt: new Date(last.createdAt).toISOString(),
            id: last.id,
          })
        : null;

    const withCursor: ApiResponse<unknown> = {
      ...response,
      data: {
        ...responseData,
        nextCursor,
        hasMore: rows.length === limit,
      },
    };

    await this.redis.set(cacheKey, JSON.stringify(withCursor), 'EX', 10);
    return withCursor;
  }

  private async getRankedFeed(userId: string, feedFilterDto: FeedFilterDto) {
    const limit = Math.min(50, Number(feedFilterDto.limit) || 20);
    const decodedCursor = this.feedRankingService.decodeRankedCursor(
      feedFilterDto.cursor,
    );
    const seed = this.feedRankingService.generateSeed(
      decodedCursor?.seed ?? feedFilterDto.seed,
    );

    const cacheKey = rankedFeedListCacheKey({
      viewerId: userId,
      limit,
      cursorToken: feedFilterDto.cursor || 'first',
      seed,
    });

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as ApiResponse<unknown>;
      } catch {
        // ignore cache parse errors
      }
    }

    const overfetch = limit * FEED_RANKING.OVERFETCH_MULTIPLIER;
    const followingIds = await this.getFollowingIds(userId);

    const [followingRaw, discoveryRaw, repostRaw, adRaw] = await Promise.all([
      this.fetchFollowingPostCandidates(followingIds, overfetch),
      this.fetchDiscoveryPostCandidates(userId, followingIds, overfetch),
      this.fetchFollowedRepostCandidates(userId, overfetch),
      this.fetchAdCandidates(overfetch),
    ]);

    const allPostIds = [
      ...new Set(
        [...followingRaw, ...discoveryRaw, ...repostRaw].map((c) => c.id),
      ),
    ];
    const seenMap = await this.loadSeenPosts(userId, allPostIds);

    const scoreCtx = {
      followingIds: new Set(followingIds),
      seenMap,
      viewerId: userId,
    };

    const pools = {
      following: this.feedRankingService.rankPool(followingRaw, scoreCtx, seed),
      discovery: this.feedRankingService.rankPool(discoveryRaw, scoreCtx, seed),
      repost: this.feedRankingService.rankPool(repostRaw, scoreCtx, seed),
      ad: this.feedRankingService.rankPool(adRaw, scoreCtx, seed),
    };

    const merged = this.feedRankingService.mergeBySlots(
      pools,
      limit,
      decodedCursor,
    );
    const rows = this.feedRankingService.toRawFeedRows(merged);

    const postIds = rows
      .filter((r) => r.type === FeedType.POST || r.type === 'repost')
      .map((r) => r.id);

    const [repostsByPostId, seenPostMap] = await Promise.all([
      this.loadFollowedRepostsByPostId(userId, postIds),
      Promise.resolve(seenMap),
    ]);

    const page = Number(feedFilterDto.page) || 1;
    const total = limit;

    const response = await this.hydrateFeed(userId, rows, page, limit, total, {
      repostsByPostId,
      seenPostMap,
      includeReposts: true,
    });

    const responseData = (response.data ?? {}) as Record<string, unknown>;
    const last = merged[merged.length - 1];
    const nextCursor =
      last?.finalScore != null
        ? this.feedRankingService.encodeRankedCursor({
            score: last.finalScore,
            id: last.id,
            seed,
          })
        : null;

    const withCursor: ApiResponse<unknown> = {
      ...response,
      data: {
        ...responseData,
        nextCursor,
        hasMore: merged.length === limit,
        seed,
      },
    };

    await this.redis.set(cacheKey, JSON.stringify(withCursor), 'EX', 10);
    return withCursor;
  }

  async getMyPublishedFeed(userId: string, feedFilterDto: FeedFilterDto) {
    const page = Number(feedFilterDto.page) || 1;
    const limit = Number(feedFilterDto.limit) || 20;
    const offset = (page - 1) * limit;

    const rows: RawFeedRow[] = await this.dataSource.query(
      `
      (
        SELECT
          p.id,
          'post' AS type,
          p.created_at AS "createdAt",
          NULL::uuid AS "repostedById"
        FROM posts p WHERE p.owner_id = $3
      )
      UNION ALL
      (
        SELECT
          a.id,
          'ad' AS type,
          a.created_at AS "createdAt",
          NULL::uuid AS "repostedById"
        FROM ads a WHERE a.owner_id = $3
      )
      ORDER BY "createdAt" DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset, userId],
    );

    const totalRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT COUNT(*) FROM (
  SELECT id FROM posts WHERE owner_id = $1
  UNION ALL
  SELECT id FROM ads WHERE owner_id = $1
) t`,
      [userId],
    );

    const total = Number(totalRows[0]?.count || 0);

    const postIds = rows
      .filter((r) => r.type === FeedType.POST || r.type === 'repost')
      .map((r) => r.id);
    const repostsByPostId = await this.loadFollowedRepostsByPostId(
      userId,
      postIds,
    );

    return this.hydrateFeed(userId, rows, page, limit, total, {
      repostsByPostId,
      includeReposts: true,
    });
  }

  async getPresence(userId: string, feedFilterDto: FeedFilterDto) {
    const page = Number(feedFilterDto.page) || 1;
    const limit = Number(feedFilterDto.limit) || 20;
    const offset = (page - 1) * limit;

    const rows: RawFeedRow[] = await this.dataSource.query(
      `
      (
        SELECT
          l.entity_id AS id,
          l.entity::text AS type,
          l.created_at AS "createdAt",
          NULL::uuid AS "repostedById"
        FROM likes l
        WHERE l.user_id = $3
          AND l.entity IN ('post', 'ad')
      )
      UNION
      (
        SELECT
          b.entity_id AS id,
          b.entity::text AS type,
          b.created_at AS "createdAt",
          NULL::uuid AS "repostedById"
        FROM bookmarks b
        WHERE b.user_id = $3
          AND b.entity IN ('post', 'ad')
      )
      UNION ALL
      (
        SELECT
          r.post_id AS id,
          'post' AS type,
          r.created_at AS "createdAt",
          NULL::uuid AS "repostedById"
        FROM reposts r
        WHERE r.user_id = $3
      )
      ORDER BY "createdAt" DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset, userId],
    );
    const totalRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT COUNT(*) FROM (
      (
        SELECT
          l.entity_id AS id,
          l.entity::text AS type,
          l.created_at AS "createdAt"
        FROM likes l
        WHERE l.user_id = $1
          AND l.entity IN ('post', 'ad')
      )
      UNION
      (
        SELECT
          b.entity_id AS id,
          b.entity::text AS type,
          b.created_at AS "createdAt"
        FROM bookmarks b
        WHERE b.user_id = $1
          AND b.entity IN ('post', 'ad')
      )
      UNION ALL
      (
        SELECT
          r.post_id AS id,
          'post' AS type,
          r.created_at AS "createdAt"
        FROM reposts r
        WHERE r.user_id = $1
      )
      ) t`,
      [userId],
    );

    const total = Number(totalRows[0]?.count || 0);
    return this.hydrateFeed(userId, rows, page, limit, total, {
      includeReposts: false,
    });
  }

  async getUsersFeed(
    userId: string,
    feedFilterDto: FeedFilterDto,
    authUserId?: string,
  ) {
    const page = Number(feedFilterDto.page) || 1;
    const limit = Number(feedFilterDto.limit) || 20;
    const offset = (page - 1) * limit;
    const canViewAllPosts = authUserId && authUserId === userId;

    const rows: RawFeedRow[] = await this.dataSource.query(
      `
      (
        SELECT
          p.id,
          'post' AS type,
          p.created_at AS "createdAt",
          NULL::uuid AS "repostedById"
        FROM posts p
        WHERE p.owner_id = $3
          AND ($4::boolean = true OR (p.is_public = true AND p.publish_status = 'published' AND ${textModerationVisibleSql('p')}))
      )
      UNION ALL
      (
        SELECT
          a.id,
          'ad' AS type,
          a.created_at AS "createdAt",
          NULL::uuid AS "repostedById"
        FROM ads a WHERE a.owner_id = $3
          AND ($4::boolean = true OR (a.publish_status = 'published' AND ${textModerationVisibleSql('a')}))
      )
      UNION ALL
      (
        SELECT
          r.post_id AS id,
          'post' AS type,
          r.created_at AS "createdAt",
          r.user_id AS "repostedById"
        FROM reposts r
        WHERE r.user_id = $3
          AND EXISTS (
            SELECT 1 FROM posts p2
            WHERE p2.id = r.post_id
              AND ($4::boolean = true OR (p2.is_public = true AND p2.publish_status = 'published' AND ${textModerationVisibleSql('p2')}))
          )
      )
      ORDER BY "createdAt" DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset, userId, canViewAllPosts],
    );
    const totalRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT COUNT(*) FROM (
  SELECT id FROM posts WHERE owner_id = $1 AND ($2::boolean = true OR (is_public = true AND publish_status = 'published' AND ${textModerationVisibleSql()}))
  UNION ALL
  SELECT id FROM ads WHERE owner_id = $1 AND ($2::boolean = true OR (publish_status = 'published' AND ${textModerationVisibleSql()}))
  UNION ALL
  SELECT r.post_id AS id FROM reposts r
  WHERE r.user_id = $1
    AND EXISTS (
      SELECT 1 FROM posts p2
      WHERE p2.id = r.post_id
        AND ($2::boolean = true OR (p2.is_public = true AND p2.publish_status = 'published' AND ${textModerationVisibleSql('p2')}))
    )
) t`,
      [userId, canViewAllPosts],
    );

    const total = Number(totalRows[0]?.count || 0);

    const postIds = rows
      .filter((r) => r.type === FeedType.POST || r.type === 'repost')
      .map((r) => r.id);
    const repostsByPostId = await this.loadFollowedRepostsByPostId(
      authUserId,
      postIds,
      userId,
    );

    return this.hydrateFeed(authUserId, rows, page, limit, total, {
      repostsByPostId,
      includeReposts: true,
    });
  }

  async getMyTaggedFeed(userId: string, feedFilterDto: FeedFilterDto) {
    const page = Number(feedFilterDto.page) || 1;
    const limit = Number(feedFilterDto.limit) || 20;
    const offset = (page - 1) * limit;

    const rows: RawFeedRow[] = await this.dataSource.query(
      `SELECT
          t.entity_id AS id,
          t.entity AS type,
          t.created_at AS "createdAt"
        FROM tags t
        WHERE t.user_id = $3
          AND t.entity IN ('post', 'ad')
          AND (
            t.entity <> 'post'
            OR EXISTS (
              SELECT 1
              FROM posts p
              WHERE p.id = t.entity_id::uuid
                AND p.is_public = true
                AND p.publish_status = 'published'
        AND ${textModerationVisibleSql('p')}
            )
          )
      ORDER BY "createdAt" DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset, userId],
    );

    const totalRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT COUNT(*) FROM (SELECT
          t.entity_id AS id,
          t.entity AS type,
          t.created_at AS "createdAt"
        FROM tags t
        WHERE t.user_id = $1
          AND t.entity IN ('post', 'ad')
          AND (
            t.entity <> 'post'
            OR EXISTS (
              SELECT 1
              FROM posts p
              WHERE p.id = t.entity_id::uuid
                AND p.is_public = true
                AND p.publish_status = 'published'
        AND ${textModerationVisibleSql('p')}
            )
          )
          ) t`,
      [userId],
    );

    const total = Number(totalRows[0]?.count || 0);
    return this.hydrateFeed(userId, rows, page, limit, total);
  }

  async getUsersTaggedFeed(
    userId: string,
    feedFilterDto: FeedFilterDto,
    authUserId?: string,
  ) {
    const page = Number(feedFilterDto.page) || 1;
    const limit = Number(feedFilterDto.limit) || 20;
    const offset = (page - 1) * limit;

    const rows: RawFeedRow[] = await this.dataSource.query(
      `SELECT
          t.entity_id AS id,
          t.entity AS type,
          t.created_at AS "createdAt"
        FROM tags t
        WHERE t.user_id = $3
          AND t.entity IN ('post', 'ad')
          AND (
            t.entity <> 'post'
            OR EXISTS (
              SELECT 1
              FROM posts p
              WHERE p.id = t.entity_id::uuid
                AND p.is_public = true
                AND p.publish_status = 'published'
        AND ${textModerationVisibleSql('p')}
            )
          )
      ORDER BY "createdAt" DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset, userId],
    );

    const totalRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT COUNT(*) FROM (SELECT
          t.entity_id AS id,
          t.entity AS type,
          t.created_at AS "createdAt"
        FROM tags t
        WHERE t.user_id = $1
          AND t.entity IN ('post', 'ad')
          AND (
            t.entity <> 'post'
            OR EXISTS (
              SELECT 1
              FROM posts p
              WHERE p.id = t.entity_id::uuid
                AND p.is_public = true
                AND p.publish_status = 'published'
        AND ${textModerationVisibleSql('p')}
            )
          )
          ) t`,
      [userId],
    );

    const total = Number(totalRows[0]?.count || 0);
    return this.hydrateFeed(authUserId, rows, page, limit, total);
  }
}
