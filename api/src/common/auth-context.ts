export interface AuthContext {
  id: string;
  email?: string;
  token: string;
  /** Hint from the JWT. RLS still checks membership. */
  tenantId?: string;
  tenantRole?: string;
}
