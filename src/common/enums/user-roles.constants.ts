export enum UserRoles {
  /**
   * Still accepted on existing access tokens.
   * New staff rows are stored as ADMIN. Console rank lives on admin_memberships.
   */
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  USER = 'user',
}
