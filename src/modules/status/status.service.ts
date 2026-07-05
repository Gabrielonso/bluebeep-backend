import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource, MoreThan } from 'typeorm';
import { Status } from './entities/status.entity';
import { StatusView } from './entities/status-view.entity';
import { CreateStatusDto } from './dtos/create-status.dto';
import { StatusType } from './enums/status-type.enum';
import { Media } from '../media/entities/media.entity';
import { User } from '../user/entity/user.entity';
import { StatusFilterDto } from './dtos/status-filter.dto';
import { StatusViewsFilterDto } from './dtos/status-views-filter.dto';
import { Follow } from '../engagements/entities/follow.entity';
import { MediaUploadFolder } from '../media/enums/media-upload-folder.enum';
import { successResponse } from 'src/common/helpers/response.helper';
import { StatusCleanupService } from './status-cleanup.service';
import { UserDisplayService } from '../user/user-display.service';
import { UserDisplayDto } from '../user/types/user-display.types';
import { resolveUserDisplay } from '../user/helpers/user-display.helper';
import { MediaAttachValidator } from '../media/media-attach.validator';
import { ContentPublishService } from '../media/content-publish.service';
import { ContentPublishStatus } from '../media/enums/content-publish-status.enum';
import { TextModerationPolicyService } from 'src/common/moderation/text-moderation-policy.service';
import { TextModerationSurface } from 'src/common/moderation/text-moderation.types';
import {
  buildCreateTextFields,
  moderationSuccessMessage,
} from 'src/common/moderation/text-moderation.helper';
import { isPublicTextVisible } from 'src/common/moderation/text-moderation-visibility.util';
import {
  MediaPlaybackPayload,
  MediaUrlResolver,
} from 'src/common/media/media-url.resolver';

export type StatusWithViewMeta = Omit<Status, 'media'> & {
  media?: MediaPlaybackPayload | null;
  viewedByMe: boolean;
  viewCount?: number;
  owner: UserDisplayDto;
};

export type StatusFeedGroup = {
  ownerId: string;
  owner: UserDisplayDto;
  hasUnseenStatuses: boolean;
  statuses: StatusWithViewMeta[];
};

@Injectable()
export class StatusService {
  constructor(
    @InjectRepository(Status) private readonly statusRepo: Repository<Status>,
    @InjectRepository(StatusView)
    private readonly statusViewRepo: Repository<StatusView>,
    @InjectRepository(Media) private readonly mediaRepo: Repository<Media>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Follow) private readonly followRepo: Repository<Follow>,
    private readonly dataSource: DataSource,
    private readonly statusCleanup: StatusCleanupService,
    private readonly userDisplayService: UserDisplayService,
    private readonly mediaAttachValidator: MediaAttachValidator,
    private readonly contentPublishService: ContentPublishService,
    private readonly mediaUrlResolver: MediaUrlResolver,
    private readonly textModerationPolicy: TextModerationPolicyService,
  ) {}

  private getExpiryDate(hours = 24) {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  private isVisibleToViewer(status: Status, viewerId?: string): boolean {
    if (
      status.textModerationStatus &&
      !isPublicTextVisible(status.textModerationStatus) &&
      status.ownerId !== viewerId
    ) {
      return false;
    }

    if (status.publishStatus === ContentPublishStatus.PUBLISHED) {
      return true;
    }
    return !!viewerId && status.ownerId === viewerId;
  }

  private async getFeedOwnerIds(viewerId: string): Promise<string[]> {
    const follows = await this.followRepo.find({
      where: { followerId: viewerId },
      select: ['followingId'],
    });
    return Array.from(new Set(follows.map((f) => f.followingId)));
  }

  private async canViewStatus(
    status: Status,
    viewerId: string,
  ): Promise<boolean> {
    const now = new Date();
    if (status.expiresAt <= now) return false;
    if (!this.isVisibleToViewer(status, viewerId)) return false;
    if (status.ownerId === viewerId) return true;
    const follow = await this.followRepo.findOne({
      where: { followerId: viewerId, followingId: status.ownerId },
    });
    return !!follow;
  }

  private async getViewedStatusIds(
    statusIds: string[],
    viewerId: string,
  ): Promise<Set<string>> {
    if (statusIds.length === 0) return new Set();
    const views = await this.statusViewRepo.find({
      where: { statusId: In(statusIds), viewerId },
      select: ['statusId'],
    });
    return new Set(views.map((v) => v.statusId));
  }

  /** Tray: unseen owners by latest activity, then seen owners by latest (no self pin). */
  private sortFeedOwnerIds(
    ownerRows: { ownerId: string; latest: Date | string }[],
    unseenOwners: Set<string>,
  ): string[] {
    const byLatestDesc = (
      a: { ownerId: string; latest: Date | string },
      b: { ownerId: string; latest: Date | string },
    ) => new Date(b.latest).getTime() - new Date(a.latest).getTime();

    const unseen = ownerRows
      .filter((r) => unseenOwners.has(r.ownerId))
      .sort(byLatestDesc);
    const seen = ownerRows
      .filter((r) => !unseenOwners.has(r.ownerId))
      .sort(byLatestDesc);

    return [...unseen.map((r) => r.ownerId), ...seen.map((r) => r.ownerId)];
  }

  private async getUnseenOwnerIds(
    ownerIds: string[],
    viewerId: string,
    now: Date,
  ): Promise<Set<string>> {
    if (ownerIds.length === 0) return new Set();
    const rows = await this.statusRepo
      .createQueryBuilder('s')
      .leftJoin(
        'status_views',
        'v',
        'v.status_id = s.id AND v.viewer_id = :viewerId',
        { viewerId },
      )
      .where('s.ownerId IN (:...ownerIds)', { ownerIds })
      .andWhere('s.expiresAt > :now', { now })
      .andWhere('s.publishStatus = :published', {
        published: ContentPublishStatus.PUBLISHED,
      })
      .andWhere('v.id IS NULL')
      .select('DISTINCT s.ownerId', 'ownerId')
      .getRawMany<{ ownerId: string }>();
    return new Set(rows.map((r) => r.ownerId));
  }

  private async getViewCounts(
    statusIds: string[],
  ): Promise<Map<string, number>> {
    if (statusIds.length === 0) return new Map();
    const rows = await this.statusViewRepo
      .createQueryBuilder('v')
      .select('v.status_id', 'statusId')
      .addSelect('COUNT(*)', 'count')
      .where('v.status_id IN (:...statusIds)', { statusIds })
      .groupBy('v.status_id')
      .getRawMany<{ statusId: string; count: string }>();
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.statusId, parseInt(r.count, 10) || 0);
    }
    return map;
  }

  private enrichStatusMedia(
    status: Status,
    viewerId?: string,
  ): MediaPlaybackPayload | null | undefined {
    const media = status.media;
    if (!media) {
      return media ?? undefined;
    }

    const isOwner = !!viewerId && viewerId === status.ownerId;
    const visible = isOwner
      ? this.mediaUrlResolver.hasPlayback(media)
      : this.mediaUrlResolver.isPubliclyVisible(media);

    return visible ? this.mediaUrlResolver.toPlaybackPayload(media) : null;
  }

  private enrichStatuses(
    statuses: Status[],
    viewedSet: Set<string>,
    ownerDisplay: UserDisplayDto,
    options?: { viewerId?: string; viewCounts?: Map<string, number> },
  ): StatusWithViewMeta[] {
    return statuses.map((status) => ({
      ...status,
      media: this.enrichStatusMedia(status, options?.viewerId),
      owner: ownerDisplay,
      viewedByMe: viewedSet.has(status.id),
      ...(options?.viewCounts && {
        viewCount: options.viewCounts.get(status.id) ?? 0,
      }),
    }));
  }

  async createStatus(dto: CreateStatusDto, ownerId: string) {
    try {
      return await this.dataSource.manager.transaction(
        async (entityManager) => {
          const mediaRepo = entityManager.getRepository(Media);
          const userRepo = entityManager.getRepository(User);
          const statusRepo = entityManager.getRepository(Status);

          if (
            !dto.content &&
            // && !dto.media
            !dto.mediaId
          ) {
            throw new BadRequestException(
              'Provide at least one of: content, media, mediaId',
            );
          }

          const owner = await userRepo.findOne({
            where: { id: ownerId },
            select: ['id'],
          });
          if (!owner) throw new NotFoundException('User not found');

          let media: Media | null = null;
          if (dto.mediaId) {
            const [attached] =
              await this.mediaAttachValidator.validateMediaIdsForAttachPending(
                [dto.mediaId],
                ownerId,
                MediaUploadFolder.STATUS,
              );
            media = attached;
          }
          // else if (dto.media) {
          //   const m = dto.media;

          //   if (
          //     !m.sourceIdOrKey.startsWith(
          //       `${MediaUploadFolder.STATUS}/${ownerId}/`,
          //     )
          //   ) {
          //     throw new ForbiddenException('Invalid media ownership or folder');
          //   }

          //   const created = mediaRepo.create({
          //     provider: m.provider,
          //     type: m.type,
          //     sourceIdOrKey: m.sourceIdOrKey,
          //     duration: m.duration,
          //     status: this.mediaAttachValidator.resolveLegacyStatus(
          //       m.provider,
          //       m.type,
          //     ),
          //     originalUrl: m.originalUrl,
          //     streamUrl: m.streamUrl,
          //     size: m.size,
          //   });

          //   media = await mediaRepo.save(created);
          // }

          const publishStatus = media
            ? this.mediaAttachValidator.resolveInitialPublishStatus([media])
            : ContentPublishStatus.PUBLISHED;

          const expiresAt =
            publishStatus === ContentPublishStatus.PENDING
              ? this.contentPublishService.getPendingStatusExpiryDate()
              : this.getExpiryDate(24);

          const trimmedContent = dto.content?.trim() || undefined;
          const textEvaluation = trimmedContent
            ? await this.textModerationPolicy.evaluateText(
                trimmedContent,
                TextModerationSurface.STATUS,
              )
            : null;

          const status = statusRepo.create({
            ownerId,
            content: trimmedContent,
            type: trimmedContent ? StatusType.THOUGHT : StatusType.MEDIA,
            expiresAt,
            publishStatus,
            media: media ?? undefined,
            ...(textEvaluation && trimmedContent
              ? buildCreateTextFields(textEvaluation, trimmedContent)
              : {}),
          });

          const savedStatus = await statusRepo.save(status);
          return successResponse(
            moderationSuccessMessage(
              'Successfully created status',
              textEvaluation?.moderationPending ?? false,
            ),
            {
              statusId: savedStatus.id,
              publishStatus: savedStatus.publishStatus,
              moderationPending: textEvaluation?.moderationPending ?? false,
            },
          );
        },
      );
    } catch (error) {
      throw error;
    }
  }

  async getMyActive(ownerId: string, filter: StatusFilterDto) {
    try {
      const data = await this.getActiveByOwner(ownerId, filter, ownerId);
      return successResponse('Operation Successful', data);
    } catch (error) {
      throw error;
    }
  }

  async getActiveByOwner(
    ownerId: string,
    filter: StatusFilterDto,
    viewerId?: string,
  ) {
    const page = Number(filter.page) || 1;
    const limit = Number(filter.limit) || null;
    const skip = limit ? (page - 1) * limit : 0;

    const [items, total] = await this.statusRepo.findAndCount({
      where: { ownerId },
      relations: { media: true },
      order: { createdAt: 'ASC' },
      skip,
      ...(limit && { take: limit }),
    });

    const now = new Date();
    const active = items
      .filter((s) => s.expiresAt > now)
      .filter((s) => this.isVisibleToViewer(s, viewerId));

    let data: StatusWithViewMeta[];
    const ownerDisplayMap = await this.userDisplayService.getByIds([ownerId]);
    const ownerDisplay = resolveUserDisplay(ownerDisplayMap, ownerId)!;

    if (viewerId) {
      const viewedSet = await this.getViewedStatusIds(
        active.map((s) => s.id),
        viewerId,
      );
      const viewCounts =
        viewerId === ownerId
          ? await this.getViewCounts(active.map((s) => s.id))
          : undefined;
      data = this.enrichStatuses(active, viewedSet, ownerDisplay, {
        viewerId,
        viewCounts,
      });
    } else {
      data = active.map((status) => ({
        ...status,
        media: this.enrichStatusMedia(status),
        owner: ownerDisplay,
        viewedByMe: false,
      }));
    }

    return {
      currentPage: page,
      data,
      totalPages: limit ? Math.ceil(total / limit) : 1,
    };
  }

  async getFeed(viewerId: string, filter: StatusFilterDto) {
    try {
      const page = Number(filter.page) || 1;
      const limit = Number(filter.limit) || null;
      const skip = limit ? (page - 1) * limit : 0;

      const ids = await this.getFeedOwnerIds(viewerId);
      const now = new Date();

      if (ids.length === 0) {
        return successResponse('Operation successful', {
          currentPage: page,
          data: [] as StatusFeedGroup[],
          totalPages: 1,
        });
      }

      const totalOwnersRaw = await this.statusRepo
        .createQueryBuilder('s')
        .where('s.ownerId IN (:...ids)', { ids })
        .andWhere('s.expiresAt > :now', { now })
        .andWhere('s.publishStatus = :published', {
          published: ContentPublishStatus.PUBLISHED,
        })
        .select('COUNT(DISTINCT s.ownerId)', 'cnt')
        .getRawOne<{ cnt: string }>();
      const totalOwners = parseInt(totalOwnersRaw?.cnt ?? '0', 10) || 0;

      const ownerRows = await this.statusRepo
        .createQueryBuilder('s')
        .where('s.ownerId IN (:...ids)', { ids })
        .andWhere('s.expiresAt > :now', { now })
        .andWhere('s.publishStatus = :published', {
          published: ContentPublishStatus.PUBLISHED,
        })
        .select('s.ownerId', 'ownerId')
        .addSelect('MAX(s.createdAt)', 'latest')
        .groupBy('s.ownerId')
        .getRawMany<{ ownerId: string; latest: Date }>();

      const allOwnerIds = ownerRows.map((r) => r.ownerId);
      const unseenOwners = await this.getUnseenOwnerIds(
        allOwnerIds,
        viewerId,
        now,
      );

      const sortedOwnerIds = this.sortFeedOwnerIds(ownerRows, unseenOwners);
      const orderedOwnerIds = limit
        ? sortedOwnerIds.slice(skip, skip + limit)
        : sortedOwnerIds;

      if (orderedOwnerIds.length === 0) {
        return successResponse('Operation successful', {
          currentPage: page,
          data: [] as StatusFeedGroup[],
          totalPages: limit ? Math.ceil(totalOwners / limit) || 1 : 1,
        });
      }

      const statuses = await this.statusRepo.find({
        where: {
          ownerId: In(orderedOwnerIds),
          expiresAt: MoreThan(now),
          publishStatus: ContentPublishStatus.PUBLISHED,
        },
        relations: { media: true },
        order: { createdAt: 'ASC' },
      });

      const statusIds = statuses.map((s) => s.id);
      const viewedSet = await this.getViewedStatusIds(statusIds, viewerId);
      const ownerDisplayMap =
        await this.userDisplayService.getByIds(orderedOwnerIds);

      const byOwner = new Map<string, Status[]>();
      for (const s of statuses) {
        const list = byOwner.get(s.ownerId) ?? [];
        list.push(s);
        byOwner.set(s.ownerId, list);
      }

      const data: StatusFeedGroup[] = orderedOwnerIds.map((uid) => {
        const list = byOwner.get(uid) ?? [];
        const owner = resolveUserDisplay(ownerDisplayMap, uid)!;
        return {
          ownerId: uid,
          owner,
          hasUnseenStatuses: unseenOwners.has(uid),
          statuses: this.enrichStatuses(list, viewedSet, owner, { viewerId }),
        };
      });

      return successResponse('Operation successful', {
        currentPage: page,
        data,
        totalPages: limit ? Math.ceil(totalOwners / limit) || 1 : 1,
      });
    } catch (error) {
      throw error;
    }
  }

  async markView(statusId: string, viewerId: string) {
    const status = await this.statusRepo.findOne({
      where: { id: statusId },
    });
    if (!status) throw new NotFoundException('Status not found');

    if (!(await this.canViewStatus(status, viewerId))) {
      throw new ForbiddenException('You cannot view this status');
    }

    if (status.ownerId === viewerId) {
      return successResponse('View recorded', { viewedByMe: true });
    }

    await this.statusViewRepo.upsert(
      { statusId, viewerId },
      {
        conflictPaths: ['statusId', 'viewerId'],
        skipUpdateIfNoValuesChanged: true,
      },
    );

    return successResponse('View recorded', { viewedByMe: true });
  }

  async getViewers(
    statusId: string,
    ownerId: string,
    filter: StatusViewsFilterDto,
  ) {
    const status = await this.statusRepo.findOne({
      where: { id: statusId, ownerId },
    });
    if (!status) throw new NotFoundException('Status not found');

    const page = Number(filter.page) || 1;
    const limit = Number(filter.limit) || 20;
    const skip = (page - 1) * limit;

    const [views, total] = await this.statusViewRepo.findAndCount({
      where: { statusId },
      relations: { viewer: true },
      order: { viewedAt: 'DESC' },
      skip,
      take: limit,
    });

    const data = views.map((v) => ({
      viewer: {
        id: v.viewerId,
        username: v.viewer?.username ?? 'unknown',
        ...(v.viewer?.profilePicture
          ? { profilePicture: v.viewer.profilePicture }
          : {}),
      },
      viewedAt: v.viewedAt,
    }));

    return successResponse('Operation successful', {
      currentPage: page,
      data,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  }

  async delete(statusId: string, ownerId: string) {
    try {
      const status = await this.statusRepo.findOne({
        where: { id: statusId, ownerId },
        relations: { media: true },
      });
      if (!status) throw new NotFoundException('Status not found');

      const mediaId = status.media?.id;

      await this.statusViewRepo.delete({ statusId });
      await this.statusRepo.delete({ id: statusId });

      if (mediaId) {
        await this.statusCleanup.deleteOrphanMedias([mediaId]);
      }

      return successResponse('Successfully deleted status');
    } catch (error) {
      throw error;
    }
  }
}
