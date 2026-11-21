/** UX gate only. The API rejects /admin for everyone else. */
export function isSuperAdmin(me?: { is_super_admin?: boolean } | null) {
  return me?.is_super_admin === true;
}
