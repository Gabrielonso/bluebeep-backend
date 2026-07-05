import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from 'src/modules/user/entity/user.entity';
import { AdMedia } from './ads-media.entity';
import { Gender } from 'src/common/enums/gender.enum';
import { Media } from 'src/modules/media/entities/media.entity';
import { ContentPublishStatus } from 'src/modules/media/enums/content-publish-status.enum';
import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';

@Entity('ads')
export class Ad {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: true })
  topic?: string;

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

  @Column({ name: 'target_country', type: 'text' })
  targetCountry: string;

  @Column({ name: 'target_gender', type: 'enum', nullable: true, enum: Gender })
  targetGender?: Gender;

  @Column({ name: 'min_age', type: 'int', nullable: true })
  minAge?: number;

  @Column({ name: 'max_age', type: 'int', nullable: true })
  maxAge?: number;

  @Column({ name: 'daily_reach_limit', type: 'int', nullable: true })
  dailyReachLimit: number;

  @Column({ name: 'daily_reach_used', type: 'int', default: 0 })
  dailyReachUsed: number;

  @Column({ default: 'active' })
  status: 'active' | 'paused' | 'ended';

  @Column({
    name: 'publish_status',
    type: 'enum',
    enum: ContentPublishStatus,
    default: ContentPublishStatus.PUBLISHED,
  })
  publishStatus: ContentPublishStatus;

  @Column({ name: 'like_count', default: 0 })
  likeCount: number;

  @Column({ name: 'comment_count', default: 0 })
  commentCount: number;

  @Column({ name: 'share_count', default: 0 })
  shareCount: number;

  @Column({ name: 'bookmark_count', default: 0 })
  bookmarkCount: number;

  /** Relationship */
  @OneToMany(() => AdMedia, (pm) => pm.ad, {
    cascade: true,
  })
  medias: AdMedia[];

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
