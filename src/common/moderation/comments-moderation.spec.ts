import { DataSource } from 'typeorm';
import { CommentsService } from '../../modules/engagements/services/comments.services';
import { Comment } from '../../modules/engagements/entities/comment.entity';
import { NotificationDispatcher } from '../../modules/notification/notification.dispatcher';
import { UserDisplayService } from '../../modules/user/user-display.service';
import { TextModerationPolicyService } from './text-moderation-policy.service';
import { ModerationStatus } from '../../modules/media/enums/moderation-status.enum';
import { FeedType } from '../../modules/feeds/enums/feed-type.enum';

describe('CommentsService finalizePendingComment', () => {
  let service: CommentsService;
  const manager = {
    getRepository: jest.fn().mockReturnValue({
      findOne: jest.fn().mockResolvedValue({ id: 'user-1', username: 'alice' }),
    }),
  };

  beforeEach(() => {
    service = new CommentsService(
      {} as any,
      {} as DataSource,
      { notify: jest.fn(), eventForFeedComment: jest.fn() } as any,
      { getByIds: jest.fn() } as any,
      {} as TextModerationPolicyService,
    );

    jest
      .spyOn(service as any, 'incrementCommentCounter')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'notifyFeedComment')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'incrementCommentReplyCounter')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs deferred side effects for approved pending comments', async () => {
    const comment = {
      id: 'comment-1',
      userId: 'user-1',
      entity: FeedType.POST,
      entityId: 'post-1',
      textModerationStatus: ModerationStatus.PENDING,
    } as Comment;

    await service.finalizePendingComment(comment, manager as any);

    expect((service as any).incrementCommentCounter).toHaveBeenCalledWith(
      manager,
      FeedType.POST,
      'post-1',
    );
    expect((service as any).notifyFeedComment).toHaveBeenCalled();
  });

  it('skips when comment is not pending', async () => {
    const comment = {
      id: 'comment-1',
      textModerationStatus: ModerationStatus.PASSED,
    } as Comment;

    await service.finalizePendingComment(comment, manager as any);

    expect((service as any).incrementCommentCounter).not.toHaveBeenCalled();
  });
});
