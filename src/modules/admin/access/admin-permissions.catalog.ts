import { AdminDashboardRole } from './enums/admin-dashboard-role.enum';

export const ADMINS_MANAGE_PERMISSION = 'admins.manage';

export const ADMIN_PERMISSION_GROUPS: { key: string; label: string }[] = [
  { key: 'user_management', label: 'User management' },
  { key: 'payments_wallets', label: 'Payments & wallets' },
  { key: 'trust_safety', label: 'Trust & safety' },
  { key: 'admin_system', label: 'Admin & system' },
];

export type AdminPermissionDefinition = {
  key: string;
  group: string;
  label: string;
  description: string;
  sortOrder: number;
};

export const ADMIN_PERMISSIONS: AdminPermissionDefinition[] = [
  {
    key: 'users.view',
    group: 'user_management',
    label: 'View users',
    description: 'Browse all profiles',
    sortOrder: 10,
  },
  {
    key: 'users.edit',
    group: 'user_management',
    label: 'Edit users',
    description: 'Update profile data',
    sortOrder: 20,
  },
  {
    key: 'users.suspend',
    group: 'user_management',
    label: 'Suspend accounts',
    description: 'Temporary suspension',
    sortOrder: 30,
  },
  {
    key: 'users.delete',
    group: 'user_management',
    label: 'Delete accounts',
    description: 'Permanent removal',
    sortOrder: 40,
  },
  {
    key: 'transactions.view',
    group: 'payments_wallets',
    label: 'View transactions',
    description: 'Read-only access',
    sortOrder: 50,
  },
  {
    key: 'payouts.approve',
    group: 'payments_wallets',
    label: 'Approve payouts',
    description: 'Release funds',
    sortOrder: 60,
  },
  {
    key: 'wallets.freeze',
    group: 'payments_wallets',
    label: 'Freeze wallets',
    description: 'Lock user funds',
    sortOrder: 70,
  },
  {
    key: 'payments.refund',
    group: 'payments_wallets',
    label: 'Refund payments',
    description: 'Issue reversals',
    sortOrder: 80,
  },
  {
    key: 'reports.review',
    group: 'trust_safety',
    label: 'Review reports',
    description: 'Trust queue access',
    sortOrder: 90,
  },
  {
    key: 'disputes.resolve',
    group: 'trust_safety',
    label: 'Resolve disputes',
    description: 'Close cases',
    sortOrder: 100,
  },
  {
    key: 'bans.manage',
    group: 'trust_safety',
    label: 'Manage bans',
    description: 'Issue / lift bans',
    sortOrder: 110,
  },
  {
    key: 'risk.override',
    group: 'trust_safety',
    label: 'Risk overrides',
    description: 'Override engine scores',
    sortOrder: 120,
  },
  {
    key: 'admins.manage',
    group: 'admin_system',
    label: 'Manage admins',
    description: 'Invite & edit roles',
    sortOrder: 130,
  },
  {
    key: 'audit.view',
    group: 'admin_system',
    label: 'View audit trail',
    description: 'Full log access',
    sortOrder: 140,
  },
  {
    key: 'platform.config',
    group: 'admin_system',
    label: 'Platform config',
    description: 'Change settings',
    sortOrder: 150,
  },
  {
    key: 'data.export',
    group: 'admin_system',
    label: 'Export data',
    description: 'CSV & report exports',
    sortOrder: 160,
  },
];

const SENIOR_ADMIN_DISABLED = new Set(['admins.manage', 'platform.config']);

const ADMIN_ENABLED = new Set([
  'users.view',
  'users.edit',
  'users.suspend',
  'transactions.view',
  'wallets.freeze',
  'reports.review',
  'disputes.resolve',
  'bans.manage',
  'audit.view',
]);

const READ_ONLY_ENABLED = new Set([
  'users.view',
  'transactions.view',
  'audit.view',
]);

export function isDefaultEnabled(
  role: AdminDashboardRole,
  permissionKey: string,
): boolean {
  if (role === AdminDashboardRole.SUPER_ADMIN) return true;
  if (role === AdminDashboardRole.SENIOR_ADMIN) {
    return !SENIOR_ADMIN_DISABLED.has(permissionKey);
  }
  if (role === AdminDashboardRole.ADMIN) {
    return ADMIN_ENABLED.has(permissionKey);
  }
  return READ_ONLY_ENABLED.has(permissionKey);
}

export const ADMIN_ROLE_META: {
  role: AdminDashboardRole;
  label: string;
  description: string;
  accent: 'red' | 'blue' | 'green' | 'purple';
}[] = [
  {
    role: AdminDashboardRole.SUPER_ADMIN,
    label: 'Super Admin',
    description:
      'Full platform access. Can manage all admins, settings, and platform config. No restrictions.',
    accent: 'red',
  },
  {
    role: AdminDashboardRole.SENIOR_ADMIN,
    label: 'Senior Admin',
    description:
      'Full operational access. Cannot manage admin roles or change platform configuration.',
    accent: 'blue',
  },
  {
    role: AdminDashboardRole.ADMIN,
    label: 'Admin',
    description:
      'Standard operations. Can manage users, review disputes, and process payouts under threshold.',
    accent: 'green',
  },
  {
    role: AdminDashboardRole.READ_ONLY,
    label: 'Read-only',
    description:
      'View-only access. No write permissions. Suitable for analysts and auditors.',
    accent: 'purple',
  },
];

export function roleLabel(role: AdminDashboardRole): string {
  return ADMIN_ROLE_META.find((item) => item.role === role)?.label ?? role;
}

export const AdminAuditAction = {
  INVITED: 'admin.invited',
  ROLE_CHANGED: 'admin.role_changed',
  REVOKED: 'admin.revoked',
  ACCEPTED: 'admin.accepted',
  PERMISSIONS_UPDATED: 'permissions.updated',
  PERMISSIONS_RESET: 'permissions.reset',
  SETTINGS_UPDATED: 'settings.updated',
} as const;

export const PERMISSION_CHANGE_ACTIONS = [
  AdminAuditAction.PERMISSIONS_UPDATED,
  AdminAuditAction.PERMISSIONS_RESET,
  AdminAuditAction.ROLE_CHANGED,
];
