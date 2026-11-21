import type { Role } from "./types";

export function canWrite(role: Role | null | undefined) {
  return role === "owner" || role === "admin" || role === "billing";
}

export function canAdmin(role: Role | null | undefined) {
  return role === "owner" || role === "admin";
}

export function roleLabel(role: Role | null | undefined) {
  if (!role) return "No role";
  return role.charAt(0).toUpperCase() + role.slice(1);
}
