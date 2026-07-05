import { ModerationStatus } from 'src/modules/media/enums/moderation-status.enum';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('thoughts')
@Index(['ownerId'])
export class Thought {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: true })
  title?: string;

  @Column({ type: 'text', nullable: true })
  content: string;

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

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string;

  @Column({ name: 'is_public', default: true })
  isPublic: boolean;

  /*** Date Related ***/
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
