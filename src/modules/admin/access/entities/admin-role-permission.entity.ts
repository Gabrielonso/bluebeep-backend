import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AdminDashboardRole } from '../enums/admin-dashboard-role.enum';

@Entity('admin_role_permissions')
@Index('uq_admin_role_permissions_role_key', ['role', 'permissionKey'], {
  unique: true,
})
export class AdminRolePermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: AdminDashboardRole,
    enumName: 'admin_dashboard_role_enum',
  })
  role: AdminDashboardRole;

  @Column({ name: 'permission_key', type: 'text' })
  permissionKey: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;
}
