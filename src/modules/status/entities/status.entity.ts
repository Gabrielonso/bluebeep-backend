import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Media } from 'src/modules/media/entities/media.entity';
import { ContentPublishStatus } from 'src/modules/media/enums/content-publish-status.enum';
import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';
import { StatusType } from '../enums/status-type.enum';

@Entity('statuses')
@Index(['ownerId'])
@Index(['expiresAt'])
export class Status {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'enum', enum: StatusType, default: StatusType.MEDIA })
  type: StatusType;

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

  @Column({
    name: 'publish_status',
    type: 'enum',
    enum: ContentPublishStatus,
    default: ContentPublishStatus.PUBLISHED,
  })
  publishStatus: ContentPublishStatus;

  @ManyToOne(() => Media, {
    onDelete: 'SET NULL',
    nullable: true,
    eager: true,
  })
  media?: Media | null;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', select: false })
  deletedAt: Date | null;
}
