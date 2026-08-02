import { UserRoles } from 'src/common/enums/user-roles.constants';

/** End-user role for admin dashboard metrics (excludes staff/admin accounts). */
export const ADMIN_METRICS_USER_ROLE = UserRoles.USER;

export function endUserRoleClause(alias = 'u'): string {
  return `${alias}.role = '${ADMIN_METRICS_USER_ROLE}'`;
}
