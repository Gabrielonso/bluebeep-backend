import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { successResponse } from 'src/common/helpers/response.helper';

import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../user/entity/user.entity';

import { AccountActivityService } from '../account-activity/account-activity.service';
import { Thought } from './entities/thought.entity';
import { CreateThoughtDto } from './dtos/create-thought.dto';
import { UpdateThoughtDto } from './dtos/update-thought.dto';
import { ThoughtsFilterDto } from './dtos/thoughts-filter.dto';
import { UserDisplayService } from '../user/user-display.service';
import { resolveUserDisplay } from '../user/helpers/user-display.helper';
import { UserDisplayDto } from '../user/types/user-display.types';
import { TextModerationPolicyService } from 'src/common/moderation/text-moderation-policy.service';
import { TextModerationSurface } from 'src/common/moderation/text-moderation.types';
import {
  buildTextModerationMeta,
  moderationSuccessMessage,
} from 'src/common/moderation/text-moderation.helper';
import {
  isPublicTextVisible,
  resolveDisplayText,
} from 'src/common/moderation/text-moderation-visibility.util';

export type ThoughtResponse = Thought & {
  owner: UserDisplayDto;
};

@Injectable()
export class ThoughtService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Thought)
    private thoughtRepo: Repository<Thought>,
    private readonly accountActivityService: AccountActivityService,
    private readonly userDisplayService: UserDisplayService,
    private readonly textModerationPolicy: TextModerationPolicyService,
  ) {}

  private mapThoughtForViewer(
    thought: Thought,
    viewerId?: string,
    viewerRole?: string,
  ): Thought | null {
    if (
      thought.isPublic &&
      thought.textModerationStatus &&
      !isPublicTextVisible(thought.textModerationStatus) &&
      thought.ownerId !== viewerId
    ) {
      return null;
    }

    const display = resolveDisplayText(
      thought,
      thought.ownerId,
      viewerId,
      viewerRole,
    );

    return {
      ...thought,
      content: display.content ?? thought.content,
      moderationPending: display.moderationPending,
      textModerationStatus: display.textModerationStatus,
    } as Thought;
  }

  private async enrichThoughts(thoughts: Thought[]): Promise<ThoughtResponse[]> {
    const ownerIds = [...new Set(thoughts.map((thought) => thought.ownerId))];
    const displayMap = await this.userDisplayService.getByIds(ownerIds);

    return thoughts.map((thought) => ({
      ...thought,
      owner: resolveUserDisplay(displayMap, thought.ownerId)!,
    }));
  }

  async createThought(dto: CreateThoughtDto, userId: string) {
    try {
      return await this.dataSource.manager.transaction(
        async (entityManager) => {
          const thoughtRepo = entityManager.getRepository(Thought);
          const userRepo = entityManager.getRepository(User);
          const user = await userRepo.findOne({
            where: { id: userId },
            select: ['id'],
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

          const textToModerate = this.textModerationPolicy.combineText([
            dto.title,
            dto.content,
          ]);
          const evaluation = await this.textModerationPolicy.evaluateText(
            textToModerate,
            TextModerationSurface.THOUGHT,
          );

          const thought = thoughtRepo.create({
            title: dto.title,
            content: dto.content,
            ownerId: user.id,
            isPublic: dto.isPublic ?? true,
            ...buildTextModerationMeta(evaluation),
            textModerationLabels: {
              ...evaluation.labels,
              moderatedText: textToModerate,
            },
          });
          const savedThought = await thoughtRepo.save(thought);

          await this.accountActivityService.log({
            userId,
            action: 'thought.created',
            metadata: {
              thoughtId: savedThought.id,
              isPublic: savedThought.isPublic,
            },
          });

          return successResponse(
            moderationSuccessMessage(
              'Successfully created thought',
              evaluation.moderationPending,
            ),
            {
              thoughtId: savedThought.id,
              moderationPending: evaluation.moderationPending,
            },
          );
        },
      );
    } catch (error) {
      throw error;
    }
  }

  async updateThought(
    thoughtId: string,
    dto: UpdateThoughtDto,
    userId: string,
  ) {
    try {
      const thought = await this.thoughtRepo.findOne({
        where: { id: thoughtId },
      });
      if (!thought) {
        throw new HttpException(
          { statusCode: HttpStatus.NOT_FOUND, message: 'Thought not found' },
          HttpStatus.NOT_FOUND,
        );
      }

      if (thought.ownerId !== userId) {
        throw new ForbiddenException(
          'You are not allowed to edit this thought',
        );
      }

      const updatePayload: Partial<Thought> = {};
      let moderationPending = false;
      const nextTitle = dto.title !== undefined ? dto.title : thought.title;
      const nextContent =
        dto.content !== undefined ? dto.content : thought.content;
      const textChanged = dto.title !== undefined || dto.content !== undefined;

      if (dto.isPublic !== undefined) updatePayload.isPublic = dto.isPublic;

      if (textChanged) {
        const textToModerate = this.textModerationPolicy.combineText([
          nextTitle,
          nextContent,
        ]);
        const evaluation = await this.textModerationPolicy.evaluateText(
          textToModerate,
          TextModerationSurface.THOUGHT,
        );
        moderationPending = evaluation.moderationPending;

        if (evaluation.moderationPending) {
          Object.assign(updatePayload, {
            ...buildTextModerationMeta(evaluation),
            contentPending: textToModerate,
            textModerationLabels: {
              ...evaluation.labels,
              pendingPayload: {
                title: nextTitle,
                content: nextContent,
              },
            },
          });
        } else {
          if (dto.title !== undefined) updatePayload.title = dto.title;
          if (dto.content !== undefined) updatePayload.content = dto.content;
          Object.assign(updatePayload, buildTextModerationMeta(evaluation));
        }
      }

      await this.thoughtRepo.update({ id: thoughtId }, updatePayload as any);

      await this.accountActivityService.log({
        userId,
        action: 'thought.updated',
        metadata: { thoughtId },
      });

      return successResponse(
        moderationSuccessMessage('Successfully updated thought', moderationPending),
        { moderationPending },
      );
    } catch (error) {
      throw error;
    }
  }

  async getMyThoughts(userId: string, thoughtFilterDto: ThoughtsFilterDto) {
    const page = Number(thoughtFilterDto.page) || 1;
    const limit = Number(thoughtFilterDto.limit) || 20;
    const skip = (page - 1) * limit;

    const [thoughts, total] = await this.thoughtRepo.findAndCount({
      where: { ownerId: userId },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    const mapped = thoughts
      .map((thought) => this.mapThoughtForViewer(thought, userId))
      .filter((thought): thought is Thought => thought != null);

    return successResponse('Operation Successful', {
      data: await this.enrichThoughts(mapped),
      currentPage: page,
      totalPages: Math.ceil(total / limit) || 1,
    });
  }

  async getUsersThoughts(
    userId: string,
    thoughtFilterDto: ThoughtsFilterDto,
    authUserId?: string,
  ) {
    const page = Number(thoughtFilterDto.page) || 1;
    const limit = Number(thoughtFilterDto.limit) || 20;
    const skip = (page - 1) * limit;

    const [thoughts, total] = await this.thoughtRepo.findAndCount({
      where: { ownerId: userId, isPublic: true },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    const mapped = thoughts
      .map((thought) => this.mapThoughtForViewer(thought, authUserId))
      .filter((thought): thought is Thought => thought != null);

    return successResponse('Operation Successful', {
      data: await this.enrichThoughts(mapped),
      currentPage: page,
      totalPages: Math.ceil(total / limit) || 1,
    });
  }

  async deleteThought(thoughtId: string, userId: string) {
    try {
      const thought = await this.thoughtRepo.findOne({
        where: { id: thoughtId },
      });
      if (!thought) {
        throw new HttpException(
          { statusCode: HttpStatus.NOT_FOUND, message: 'Thought not found' },
          HttpStatus.NOT_FOUND,
        );
      }

      if (thought.ownerId !== userId) {
        throw new ForbiddenException(
          'You are not allowed to delete this thought',
        );
      }

      await this.thoughtRepo.delete({ id: thoughtId });

      await this.accountActivityService.log({
        userId,
        action: 'thought.deleted',
        metadata: { thoughtId },
      });

      return successResponse('Successfully deleted thought');
    } catch (error) {
      throw error;
    }
  }
}
