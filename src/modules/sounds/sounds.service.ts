import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { successResponse } from 'src/common/helpers/response.helper';
import { FeedService } from '../feeds/feed.service';
import { SoundFilterDto } from './dtos/sound-filter.dto';
import { RawFeedRow } from '../feeds/types/feed.types';
import { Media } from '../media/entities/media.entity';
import { MediaUrlResolver } from 'src/common/media/media-url.resolver';

type SoundUsageRow = {
  id: string;
  usageCount: number;
  lastUsedAt: Date;
};

@Injectable()
export class SoundsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly feedService: FeedService,
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>,
    private readonly mediaUrlResolver: MediaUrlResolver,
  ) {}

  async getSounds(filter: SoundFilterDto) {
    const page = Number(filter.page) || 1;
    const limit = Number(filter.limit) || 20;
    const offset = (page - 1) * limit;

    const { startDate, endDate } = filter;

    const params: unknown[] = [];
    let idx = 1;

    let postDateFilter = '';
    let adDateFilter = '';
    if (startDate) {
      postDateFilter += ` AND p.created_at >= $${idx}`;
      adDateFilter += ` AND a.created_at >= $${idx}`;
      params.push(startDate);
      idx++;
    }
    if (endDate) {
      postDateFilter += ` AND p.created_at <= $${idx}`;
      adDateFilter += ` AND a.created_at <= $${idx}`;
      params.push(endDate);
      idx++;
    }

    params.push(limit, offset);

    const rows: SoundUsageRow[] = await this.dataSource.query(
      `
      WITH sound_usage AS (
        SELECT p.sound_media_id AS media_id, p.created_at
        FROM posts p
        WHERE p.sound_media_id IS NOT NULL AND p.is_public = true AND p.publish_status = 'published' ${postDateFilter}
        UNION ALL
        SELECT a.sound_media_id AS media_id, a.created_at
        FROM ads a
        WHERE a.sound_media_id IS NOT NULL ${adDateFilter}
      )
      SELECT
        m.id,
        COUNT(su.media_id)::int AS "usageCount",
        MAX(su.created_at) AS "lastUsedAt"
      FROM sound_usage su
      JOIN medias m ON m.id = su.media_id
      WHERE m.status IN ('processing', 'ready')
        AND m.status NOT IN ('rejected', 'uploading')
        AND (
          m.moderation_status IN ('passed', 'skipped')
          OR (m.status = 'ready' AND m.moderation_status IS NULL)
        )
      GROUP BY m.id
      ORDER BY "usageCount" DESC, "lastUsedAt" DESC
      LIMIT $${idx++} OFFSET $${idx}
      `,
      params,
    );

    const mediaIds = rows.map((row) => row.id);
    const mediaList =
      mediaIds.length > 0
        ? await this.mediaRepo.find({ where: { id: In(mediaIds) } })
        : [];
    const mediaById = new Map(mediaList.map((media) => [media.id, media]));

    const sounds = rows
      .map((row) => {
        const media = mediaById.get(row.id);
        if (!media || !this.mediaUrlResolver.isPubliclyVisible(media)) {
          return null;
        }
        const playback = this.mediaUrlResolver.resolve(media);
        const dims = this.mediaUrlResolver.mediaDimensions(media);
        return {
          id: row.id,
          originalUrl: playback.original,
          streamUrl: playback.stream,
          duration: dims.duration,
          width: dims.width,
          height: dims.height,
          usageCount: row.usageCount,
          lastUsedAt: row.lastUsedAt,
        };
      })
      .filter((sound): sound is NonNullable<typeof sound> => sound != null);

    return successResponse('Operation Successful', {
      data: sounds,
      currentPage: page,
      totalPages: sounds.length < limit ? page : page + 1,
    });
  }

  async getTrendingSounds(filter: SoundFilterDto) {
    return this.getSounds(filter);
  }

  async getSoundUsage(
    soundId: string,
    viewerId: string | undefined,
    filter: SoundFilterDto,
  ) {
    const page = Number(filter.page) || 1;
    const limit = Number(filter.limit) || 20;
    const offset = (page - 1) * limit;

    const rows: RawFeedRow[] = await this.dataSource.query(
      `
      (
        SELECT
          p.id,
          'post' AS type,
          p.created_at AS "createdAt"
        FROM posts p
        WHERE p.sound_media_id = $3
          AND p.is_public = true
          AND p.publish_status = 'published'
      )
      UNION ALL
      (
        SELECT
          a.id,
          'ad' AS type,
          a.created_at AS "createdAt"
        FROM ads a
        WHERE a.sound_media_id = $3
      )
      ORDER BY "createdAt" DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset, soundId],
    );

    const total = await this.dataSource.query(
      `SELECT COUNT(*) FROM ((
        SELECT
          p.id,
          'post' AS type,
          p.created_at AS "createdAt"
        FROM posts p
        WHERE p.sound_media_id = $1
          AND p.is_public = true
          AND p.publish_status = 'published'
      )
      UNION ALL
      (
        SELECT
          a.id,
          'ad' AS type,
          a.created_at AS "createdAt"
        FROM ads a
        WHERE a.sound_media_id = $1
      )
      ) t`,
      [soundId],
    );

    return this.feedService.hydrateFeed(
      viewerId,
      rows,
      page,
      limit,
      total[0]?.count,
    );
  }
}
