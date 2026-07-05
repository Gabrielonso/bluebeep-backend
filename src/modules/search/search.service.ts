import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { successResponse } from 'src/common/helpers/response.helper';
import { UserRoles } from 'src/common/enums/user-roles.constants';
import { User } from '../user/entity/user.entity';
import { Thought } from '../thought/entities/thought.entity';
import { FeedService } from '../feeds/feed.service';
import { UserDisplayService } from '../user/user-display.service';
import { resolveUserDisplay } from '../user/helpers/user-display.helper';
import { UserDisplayDto } from '../user/types/user-display.types';
import { GlobalSearchQueryDto } from './dtos/global-search-query.dto';
import { SearchTypeEnum } from './enums/search-type.enum';
import { RawFeedRow } from '../feeds/types/feed.types';
import {
  textModerationVisibleSql,
  resolveDisplayBio,
} from 'src/common/moderation/text-moderation-visibility.util';

type TrendSearchRow = {
  tag: string;
  postCount: number;
  lastUsedAt: Date;
};

export type ThoughtSearchItem = Thought & { owner: UserDisplayDto };

type PaginatedBucket<T> = {
  data: T[];
  currentPage: number;
  totalPages: number;
  total?: number;
};

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Thought)
    private readonly thoughtRepository: Repository<Thought>,
    private readonly dataSource: DataSource,
    private readonly feedService: FeedService,
    private readonly userDisplayService: UserDisplayService,
  ) {}

  async search(query: GlobalSearchQueryDto, viewerId?: string) {
    const term = query.q.trim();
    const page = Number(query.page) || 1;
    const limit = Math.min(50, Number(query.limit) || 10);
    const types = query.types ?? SearchTypeEnum.ALL;
    const perTypeLimit =
      types === SearchTypeEnum.ALL ? Math.min(limit, 10) : limit;

    const likeTerm = `%${term}%`;
    const hashtagTerm = term.startsWith('#')
      ? term.slice(1).toLowerCase()
      : term.toLowerCase();

    const payload: Record<string, unknown> = { query: term };

    const include = (type: SearchTypeEnum) =>
      types === SearchTypeEnum.ALL || types === type;

    if (include(SearchTypeEnum.PEOPLE)) {
      payload.people = await this.searchPeople(
        likeTerm,
        page,
        perTypeLimit,
        viewerId,
      );
    }

    if (include(SearchTypeEnum.POSTS)) {
      payload.posts = await this.searchPosts(
        likeTerm,
        hashtagTerm,
        page,
        perTypeLimit,
        viewerId,
      );
    }

    if (include(SearchTypeEnum.HASHTAGS)) {
      payload.hashtags = await this.searchHashtags(
        likeTerm,
        page,
        perTypeLimit,
      );
    }

    // if (include(SearchTypeEnum.THOUGHTS)) {
    //   payload.thoughts = await this.searchThoughts(
    //     likeTerm,
    //     page,
    //     perTypeLimit,
    //     viewerId,
    //   );
    // }

    return successResponse('Operation Successful', payload);
  }

  private async searchPeople(
    likeTerm: string,
    page: number,
    limit: number,
    viewerId?: string,
  ): Promise<PaginatedBucket<Record<string, unknown>>> {
    const skip = (page - 1) * limit;

    const qb = this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.firstName',
        'user.lastName',
        'user.username',
        'user.profilePicture',
        'user.bio',
        'user.userRefId',
      ])
      .where('user.verified = :verified', { verified: true })
      .andWhere('user.role = :role', { role: UserRoles.USER })
      .andWhere(
        `(user.firstName ILIKE :search
          OR user.lastName ILIKE :search
          OR user.username ILIKE :search
          OR user.bio ILIKE :search
          OR user.userRefId ILIKE :search)`,
        { search: likeTerm },
      );

    if (viewerId) {
      qb.andWhere(
        `NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id::uuid = :viewerId AND b.blocked_id::uuid = user.id)
             OR (b.blocked_id::uuid = :viewerId AND b.blocker_id::uuid = user.id)
        )`,
        { viewerId },
      );
    }

    qb.orderBy('user.createdAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data: data.map((user) => {
        const bioDisplay = resolveDisplayBio(user, user.id, viewerId);
        return {
          ...user,
          bio: bioDisplay.bio,
          bioModerationPending: bioDisplay.bioModerationPending,
        };
      }),
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      total,
    };
  }

  private postBlockClause(
    viewerParamIndex: number,
    ownerColumn: string,
  ): string {
    return `AND NOT EXISTS (
      SELECT 1 FROM blocks b
      WHERE (b.blocker_id::uuid = $${viewerParamIndex}::uuid AND b.blocked_id::uuid = ${ownerColumn}::uuid)
         OR (b.blocked_id::uuid = $${viewerParamIndex}::uuid AND b.blocker_id::uuid = ${ownerColumn}::uuid)
    )`;
  }

  private async searchPosts(
    likeTerm: string,
    hashtagTerm: string,
    page: number,
    limit: number,
    viewerId?: string,
  ) {
    const offset = (page - 1) * limit;
    const hashtagPattern = `%${hashtagTerm}%`;

    const params: (string | number)[] = [likeTerm, hashtagPattern];
    let limitIdx = 3;
    let offsetIdx = 4;

    let postBlock = '';
    let adBlock = '';
    if (viewerId) {
      params.push(viewerId);
      postBlock = this.postBlockClause(3, 'p.owner_id');
      adBlock = this.postBlockClause(3, 'a.owner_id');
      limitIdx = 4;
      offsetIdx = 5;
    }

    params.push(limit, offset);

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
            p.content ILIKE $1
            OR p.location ILIKE $1
            OR EXISTS (
              SELECT 1 FROM unnest(COALESCE(p.hashtags, ARRAY[]::text[])) AS tag
              WHERE tag ILIKE $2
            )
          )
          ${postBlock}
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
            a.content ILIKE $1
            OR EXISTS (
              SELECT 1 FROM unnest(COALESCE(a.hashtags, ARRAY[]::text[])) AS tag
              WHERE tag ILIKE $2
            )
          )
          ${adBlock}
      )
      ORDER BY "createdAt" DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      params,
    );

    const countParams: (string | number)[] = [likeTerm, hashtagPattern];
    let countViewerIdx = 0;
    let countPostBlock = '';
    let countAdBlock = '';
    if (viewerId) {
      countParams.push(viewerId);
      countViewerIdx = 3;
      countPostBlock = this.postBlockClause(countViewerIdx, 'p.owner_id');
      countAdBlock = this.postBlockClause(countViewerIdx, 'a.owner_id');
    }

    const totalRows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM (
        SELECT p.id FROM posts p
        WHERE p.is_public = true
          AND p.publish_status = 'published'
          AND ${textModerationVisibleSql('p')}
          AND (
            p.content ILIKE $1
            OR p.location ILIKE $1
            OR EXISTS (
              SELECT 1 FROM unnest(COALESCE(p.hashtags, ARRAY[]::text[])) AS tag
              WHERE tag ILIKE $2
            )
          )
          ${countPostBlock}
        UNION ALL
        SELECT a.id FROM ads a
        WHERE a.publish_status = 'published'
          AND ${textModerationVisibleSql('a')}
          AND (
            a.content ILIKE $1
            OR EXISTS (
              SELECT 1 FROM unnest(COALESCE(a.hashtags, ARRAY[]::text[])) AS tag
              WHERE tag ILIKE $2
            )
          )
          ${countAdBlock}
      ) t`,
      countParams,
    );

    const total = Number(totalRows[0]?.count ?? 0);
    const hydrated = await this.feedService.hydrateFeed(
      viewerId,
      rows,
      page,
      limit,
      total,
    );

    const hydratedData = (hydrated.data ?? {}) as Record<string, unknown>;
    return {
      ...hydratedData,
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      total,
    };
  }

  private async searchHashtags(
    likeTerm: string,
    page: number,
    limit: number,
  ): Promise<PaginatedBucket<TrendSearchRow>> {
    const offset = (page - 1) * limit;
    const tagPattern = likeTerm.replace(/^%#?/, '%').replace(/#$/, '%');

    const data: TrendSearchRow[] = await this.dataSource.query(
      `
      WITH tags AS (
        SELECT unnest(COALESCE(p.hashtags, ARRAY[]::text[])) AS tag, p.created_at AS created_at
        FROM posts p
        WHERE p.is_public = true
          AND p.publish_status = 'published'
          AND ${textModerationVisibleSql('p')}
        UNION ALL
        SELECT unnest(COALESCE(a.hashtags, ARRAY[]::text[])) AS tag, a.created_at AS created_at
        FROM ads a
        WHERE a.publish_status = 'published'
          AND ${textModerationVisibleSql('a')}
      )
      SELECT
        tag,
        COUNT(*)::int AS "postCount",
        MAX(created_at) AS "lastUsedAt"
      FROM tags
      WHERE tag IS NOT NULL AND tag <> '' AND tag ILIKE $1
      GROUP BY tag
      ORDER BY "postCount" DESC, "lastUsedAt" DESC
      LIMIT $2 OFFSET $3
      `,
      [tagPattern, limit, offset],
    );

    const totalRows = await this.dataSource.query(
      `
      WITH tags AS (
        SELECT unnest(COALESCE(p.hashtags, ARRAY[]::text[])) AS tag
        FROM posts p
        WHERE p.is_public = true
          AND p.publish_status = 'published'
          AND ${textModerationVisibleSql('p')}
        UNION ALL
        SELECT unnest(COALESCE(a.hashtags, ARRAY[]::text[])) AS tag
        FROM ads a
        WHERE a.publish_status = 'published'
          AND ${textModerationVisibleSql('a')}
      )
      SELECT COUNT(DISTINCT tag)::int AS count
      FROM tags
      WHERE tag IS NOT NULL AND tag <> '' AND tag ILIKE $1
      `,
      [tagPattern],
    );

    const total = Number(totalRows[0]?.count ?? 0);

    return {
      data,
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      total,
    };
  }

  private async searchThoughts(
    likeTerm: string,
    page: number,
    limit: number,
    viewerId?: string,
  ): Promise<PaginatedBucket<ThoughtSearchItem>> {
    const skip = (page - 1) * limit;

    const qb = this.thoughtRepository
      .createQueryBuilder('thought')
      .where('thought.is_public = true')
      .andWhere(
        '(thought.title ILIKE :search OR thought.content ILIKE :search)',
        { search: likeTerm },
      );

    if (viewerId) {
      qb.andWhere(
        `NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id::uuid = :viewerId AND b.blocked_id::uuid = thought.owner_id::uuid)
             OR (b.blocked_id::uuid = :viewerId AND b.blocker_id::uuid = thought.owner_id::uuid)
        )`,
        { viewerId },
      );
    }

    qb.orderBy('thought.createdAt', 'DESC').skip(skip).take(limit);

    const [thoughts, total] = await qb.getManyAndCount();
    const ownerIds = [...new Set(thoughts.map((t) => t.ownerId))];
    const displayMap = await this.userDisplayService.getByIds(ownerIds);

    const data: ThoughtSearchItem[] = thoughts.map((thought) => ({
      ...thought,
      owner: resolveUserDisplay(displayMap, thought.ownerId)!,
    }));

    return {
      data,
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      total,
    };
  }
}
