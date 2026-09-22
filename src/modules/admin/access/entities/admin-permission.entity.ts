import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('admin_permissions')
export class AdminPermission {
  @PrimaryColumn({ type: 'text' })
  key: string;

  @Column({ type: 'text' })
  group: string;

  @Column({ type: 'text' })
  label: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
