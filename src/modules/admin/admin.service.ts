import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { successResponse } from 'src/common/helpers/response.helper';
import { TextModerationSurface } from 'src/common/moderation/text-moderation.types';
import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';
import { Comment } from '../engagements/entities/comment.entity';
import { Post } from '../posts/entities/post.entity';
import { Ad } from '../ads/entities/ads.entity';
import { Thought } from '../thought/entities/thought.entity';
import { Status } from '../status/entities/status.entity';
import { User } from '../user/entity/user.entity';
import { CommentsService } from '../engagements/services/comments.services';
import { TextModerationQueryDto } from './dtos/text-moderation-query.dto';

type QueueItem = {
  id: string;
  entityType: TextModerationSurface;
  content: string | null;
  ownerId: string;
  createdAt: Date;
  textModerationStatus?: ModerationStatus | null;
  textModerationLabels?: Record<string, unknown> | null;
};

@Injectable()
export class AdminService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    @InjectRepository(Ad)
    private readonly adRepo: Repository<Ad>,
    @InjectRepository(Thought)
    private readonly thoughtRepo: Repository<Thought>,
    @InjectRepository(Status)
    private readonly statusRepo: Repository<Status>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly commentsService: CommentsService,
  ) {}

  async getTextModerationQueue(query: TextModerationQueryDto) {
    const status = query.status ?? ModerationStatus.PENDING;
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const entityTypes = query.entity
      ? [query.entity]
      : Object.values(TextModerationSurface);

    const buckets = await Promise.all(
      entityTypes.map((entityType) =>
        this.fetchQueueBucket(entityType, status, page, limit),
      ),
    );

    const data = buckets
      .flat()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);

    return successResponse('Operation successful', {
      data,
      currentPage: page,
      totalPages: 1,
    });
  }

  async approveTextModeration(entityType: TextModerationSurface, id: string) {
    return this.dataSource.transaction(async (manager) => {
      if (entityType === TextModerationSurface.BIO) {
        return this.approveBio(manager, id);
      }
      if (entityType === TextModerationSurface.COMMENT) {
        return this.approveComment(manager, id);
      }
      return this.approveContentEntity(manager, entityType, id, true);
    });
  }

  async rejectTextModeration(entityType: TextModerationSurface, id: string) {
    return this.dataSource.transaction(async (manager) => {
      if (entityType === TextModerationSurface.BIO) {
        return this.rejectBio(manager, id);
      }
      if (entityType === TextModerationSurface.COMMENT) {
        return this.rejectComment(manager, id);
      }
      return this.approveContentEntity(manager, entityType, id, false);
    });
  }

  private async fetchQueueBucket(
    entityType: TextModerationSurface,
    status: ModerationStatus,
    page: number,
    limit: number,
  ): Promise<QueueItem[]> {
    const skip = (page - 1) * limit;

    if (entityType === TextModerationSurface.BIO) {
      const users = await this.userRepo.find({
        where: { bioModerationStatus: status },
        order: { bioModeratedAt: 'DESC' },
        skip,
        take: limit,
      });
      return users.map((user) => ({
        id: user.id,
        entityType,
        content: user.bioPending ?? user.bio,
        ownerId: user.id,
        createdAt: user.bioModeratedAt ?? new Date(0),
        textModerationStatus: user.bioModerationStatus,
        textModerationLabels: user.bioModerationLabels,
      }));
    }

    if (entityType === TextModerationSurface.COMMENT) {
      const comments = await this.commentRepo.find({
        where: { textModerationStatus: status },
        order: { textModeratedAt: 'DESC' },
        skip,
        take: limit,
      });
      return comments.map((comment) => ({
        id: comment.id,
        entityType,
        content: comment.content,
        ownerId: comment.userId,
        createdAt: comment.textModeratedAt ?? comment.createdAt,
        textModerationStatus: comment.textModerationStatus,
        textModerationLabels: comment.textModerationLabels,
      }));
    }

    const repo = this.getContentRepo(entityType);
    const rows = await repo.find({
      where: { textModerationStatus: status },
      order: { textModeratedAt: 'DESC' },
      skip,
      take: limit,
    });

    return rows.map((row: any) => ({
      id: row.id,
      entityType,
      content: row.contentPending ?? row.content ?? null,
      ownerId: row.ownerId,
      createdAt: row.textModeratedAt ?? row.createdAt,
      textModerationStatus: row.textModerationStatus,
      textModerationLabels: row.textModerationLabels,
    }));
  }

  private getContentRepo(entityType: TextModerationSurface) {
    switch (entityType) {
      case TextModerationSurface.POST:
        return this.postRepo;
      case TextModerationSurface.AD:
        return this.adRepo;
      case TextModerationSurface.THOUGHT:
        return this.thoughtRepo;
      case TextModerationSurface.STATUS:
        return this.statusRepo;
      default:
        throw new BadRequestException(`Unsupported entity type: ${entityType}`);
    }
  }

  private async approveComment(manager: DataSource['manager'], id: string) {
    const comment = await manager.getRepository(Comment).findOne({
      where: { id },
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    if (comment.textModerationStatus !== ModerationStatus.PENDING) {
      throw new BadRequestException('Comment is not pending moderation');
    }

    comment.textModerationStatus = ModerationStatus.PASSED;
    comment.textModeratedAt = new Date();
    await manager.save(comment);
    await this.commentsService.finalizePendingComment(comment, manager);

    return successResponse('Comment approved');
  }

  private async rejectComment(manager: DataSource['manager'], id: string) {
    const comment = await manager.getRepository(Comment).findOne({
      where: { id },
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    comment.textModerationStatus = ModerationStatus.REJECTED;
    comment.textModeratedAt = new Date();
    await manager.save(comment);

    return successResponse('Comment rejected');
  }

  private async approveBio(manager: DataSource['manager'], id: string) {
    const user = await manager.getRepository(User).findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.bioModerationStatus !== ModerationStatus.PENDING) {
      throw new BadRequestException('Bio is not pending moderation');
    }

    if (user.bioPending != null) {
      user.bio = user.bioPending;
    }
    user.bioPending = undefined;
    user.bioModerationStatus = ModerationStatus.PASSED;
    user.bioModeratedAt = new Date();
    await manager.save(user);

    return successResponse('Bio approved');
  }

  private async rejectBio(manager: DataSource['manager'], id: string) {
    const user = await manager.getRepository(User).findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.bioPending = undefined;
    user.bioModerationStatus = ModerationStatus.REJECTED;
    user.bioModeratedAt = new Date();
    await manager.save(user);

    return successResponse('Bio rejected');
  }

  private async approveContentEntity(
    manager: DataSource['manager'],
    entityType: TextModerationSurface,
    id: string,
    approve: boolean,
  ) {
    const repo = manager.getRepository(
      entityType === TextModerationSurface.POST
        ? Post
        : entityType === TextModerationSurface.AD
          ? Ad
          : entityType === TextModerationSurface.THOUGHT
            ? Thought
            : Status,
    );
    const entity = await repo.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`${entityType} not found`);
    }
    if (entity.textModerationStatus !== ModerationStatus.PENDING) {
      throw new BadRequestException(`${entityType} is not pending moderation`);
    }

    if (approve) {
      const pendingPayload = entity.textModerationLabels?.pendingPayload as
        | { topic?: string; content?: string; title?: string }
        | undefined;

      if (pendingPayload?.topic != null && entityType === TextModerationSurface.AD) {
        (entity as unknown as Ad).topic = pendingPayload.topic;
      }
      if (pendingPayload?.title != null && entityType === TextModerationSurface.THOUGHT) {
        (entity as unknown as Thought).title = pendingPayload.title;
      }
      if (pendingPayload?.content != null) {
        entity.content = pendingPayload.content;
      } else if (entity.contentPending) {
        entity.content = entity.contentPending;
      }

      entity.contentPending = undefined;
      entity.textModerationStatus = ModerationStatus.PASSED;
    } else {
      entity.contentPending = undefined;
      entity.textModerationStatus = ModerationStatus.REJECTED;
    }

    entity.textModeratedAt = new Date();
    await repo.save(entity);

    return successResponse(
      approve ? `${entityType} approved` : `${entityType} rejected`,
    );
  }
}
