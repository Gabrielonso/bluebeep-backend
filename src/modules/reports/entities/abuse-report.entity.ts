import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AbuseReportResolutionOutcome } from '../enums/abuse-report-resolution.enum';
import { AbuseReportSeverity } from '../enums/abuse-report-severity.enum';
import { AbuseReportStatus } from '../enums/abuse-report-status.enum';
import { AbuseReportType } from '../enums/abuse-report-type.enum';

@Entity('abuse_reports')
@Index(['status'])
@Index(['type'])
@Index(['assigneeId'])
@Index(['reportedUserId'])
@Index(['createdAt'])
@Index(['publicId'], { unique: true })
@Index(['status', 'slaDeadline'])
export class AbuseReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'public_id', type: 'text', unique: true })
  publicId: string;

  @Column({ name: 'reporter_id', type: 'uuid' })
  reporterId: string;

  @Column({ name: 'reported_user_id', type: 'uuid' })
  reportedUserId: string;

  @Column({
    type: 'enum',
    enum: AbuseReportType,
  })
  type: AbuseReportType;

  @Column({
    type: 'enum',
    enum: AbuseReportSeverity,
    default: AbuseReportSeverity.MEDIUM,
  })
  severity: AbuseReportSeverity;

  @Column({
    type: 'enum',
    enum: AbuseReportStatus,
    default: AbuseReportStatus.OPEN,
  })
  status: AbuseReportStatus;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'assignee_id', type: 'uuid', nullable: true })
  assigneeId: string | null;

  @Column({ name: 'live_stream_id', type: 'uuid', nullable: true })
  liveStreamId: string | null;

  @Column({ name: 'room_key', type: 'text', nullable: true })
  roomKey: string | null;

  @Column({ name: 'viewer_count', type: 'int', nullable: true })
  viewerCount: number | null;

  @Column({ name: 'recording_saved', type: 'boolean', nullable: true })
  recordingSaved: boolean | null;

  @Column({ name: 'evidence_urls', type: 'jsonb', nullable: true })
  evidenceUrls: string[] | null;

  @Column({
    name: 'resolution_outcome',
    type: 'enum',
    enum: AbuseReportResolutionOutcome,
    nullable: true,
  })
  resolutionOutcome: AbuseReportResolutionOutcome | null;

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'resolved_by_id', type: 'uuid', nullable: true })
  resolvedById: string | null;

  @Column({ name: 'sla_deadline', type: 'timestamptz' })
  slaDeadline: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
