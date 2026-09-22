import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('admin_audit_events')
@Index(['createdAt'])
@Index(['actorMembershipId', 'createdAt'])
export class AdminAuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ name: 'actor_membership_id', type: 'uuid', nullable: true })
  actorMembershipId: string | null;

  @Column({ type: 'text' })
  action: string;

  @Column({ name: 'target_type', type: 'text', nullable: true })
  targetType: string | null;

  @Column({ name: 'target_id', type: 'text', nullable: true })
  targetId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
