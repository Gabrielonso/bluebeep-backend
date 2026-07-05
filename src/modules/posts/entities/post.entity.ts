import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { PostMedia } from './post-media.entity';
import { Media } from 'src/modules/media/entities/media.entity';
import { ContentPublishStatus } from 'src/modules/media/enums/content-publish-status.enum';
import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';

@Entity('posts')
@Index(['ownerId'])
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: true })
  content?: string;

  @Column({ name: 'content_pending', type: 'text', nullable: true })
  contentPending?: string;

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

  @Column({ type: 'text', array: true, nullable: true })
  hashtags?: string[];

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string;

  @Column({ name: 'like_count', default: 0 })
  likeCount: number;

  @Column({ name: 'comment_count', default: 0 })
  commentCount: number;

  @Column({ name: 'share_count', default: 0 })
  shareCount: number;

  @Column({ name: 'bookmark_count', default: 0 })
  bookmarkCount: number;

  @Column({ name: 'repost_count', default: 0 })
  repostCount: number;

  @Column({ name: 'view_count', default: 0 })
  viewCount: number;

  @Column({ name: 'allow_comments', default: true })
  allowComments: boolean;

  @Column({ name: 'is_public', default: true })
  isPublic: boolean;

  @Column({
    name: 'publish_status',
    type: 'enum',
    enum: ContentPublishStatus,
    default: ContentPublishStatus.PUBLISHED,
  })
  publishStatus: ContentPublishStatus;

  @Column({ name: 'location', nullable: true })
  location?: string;

  /** Relationship */

  @OneToMany(() => PostMedia, (pm) => pm.post, {
    cascade: true,
  })
  medias: PostMedia[];

  @ManyToOne(() => Media, {
    nullable: true,
    eager: true,
  })
  @JoinColumn({ name: 'sound_media_id' })
  sound?: Media;

  /*** Date Related ***/
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
