import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AdminDashboardRole } from '../enums/admin-dashboard-role.enum';
import { AdminMembershipStatus } from '../enums/admin-membership-status.enum';

@Entity('admin_memberships')
@Index('uq_admin_memberships_open_email', ['email'], {
  unique: true,
  where: `"status" IN ('pending', 'active')`,
})
@Index('uq_admin_memberships_active_user', ['userId'], {
  unique: true,
  where: `"status" = 'active' AND "user_id" IS NOT NULL`,
})
export class AdminMembership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  email: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({
    type: 'enum',
    enum: AdminDashboardRole,
    enumName: 'admin_dashboard_role_enum',
  })
  role: AdminDashboardRole;

  @Column({
    type: 'enum',
    enum: AdminMembershipStatus,
    enumName: 'admin_membership_status_enum',
    default: AdminMembershipStatus.PENDING,
  })
  status: AdminMembershipStatus;

  @Column({ name: 'invited_by_id', type: 'uuid', nullable: true })
  invitedById: string | null;

  @Column({ name: 'invited_at', type: 'timestamptz', nullable: true })
  invitedAt: Date | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'two_factor_enabled', type: 'boolean', default: false })
  twoFactorEnabled: boolean;

  @Column({ name: 'last_active_at', type: 'timestamptz', nullable: true })
  lastActiveAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
