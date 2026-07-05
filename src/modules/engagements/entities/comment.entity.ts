import { FeedType } from 'src/modules/feeds/enums/feed-type.enum';
import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('comments')
@Index(['entity', 'entityId'])
@Index(['parentId'])
@Index(['userId'])
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: FeedType })
  entity: FeedType;

  @Column({ name: 'target_id', type: 'uuid' })
  entityId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({
    name: 'text_moderation_status',
    type: 'enum',
    enum: ModerationStatus,
    nullable: true,
  })
  textModerationStatus?: ModerationStatus;

  @Column({ name: 'text_moderation_labels', type: 'jsonb', nullable: true })
  textModerationLabels?: Record<string, unknown>;

  @Column({ name: 'text_moderated_at', type: 'timestamp', nullable: true })
  textModeratedAt?: Date;

  @Column({ nullable: true, name: 'parent_id', type: 'uuid' })
  parentId?: string;

  @Column({ name: 'reply_to_user_id', type: 'uuid', nullable: true })
  replyToUserId?: string;

  @Column({ name: 'reply_to_comment_id', type: 'uuid', nullable: true })
  replyToCommentId?: string;

  @Column({ name: 'reply_count', default: 0 })
  replyCount: number;

  @Column({ name: 'is_deleted', default: false })
  isDeleted: boolean;

  @Column({ name: 'deleted_at', nullable: true })
  deletedAt?: Date;

  @Column({ name: 'deleted_by', type: 'uuid', nullable: true })
  deletedBy?: string; // admin or userId

  @CreateDateColumn({ name: 'create_at' })
  createdAt: Date;
}
