import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LiveStreamStatus } from '../enums/live-stream-status.enum';

/**
 * Minimal livestream foundation. Product APIs (start/join/end) come later.
 * Admin Command Center counts rows with status = live.
 */
@Entity('live_streams')
@Index(['hostId'])
@Index(['status'])
export class LiveStream {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'host_id', type: 'uuid' })
  hostId: string;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({
    type: 'enum',
    enum: LiveStreamStatus,
    default: LiveStreamStatus.SCHEDULED,
  })
  status: LiveStreamStatus;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'ended_at', type: 'timestamp', nullable: true })
  endedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
