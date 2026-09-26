import type { WorkspaceRole } from "@/lib/workspace/selection";

export function canManageConnections(role: WorkspaceRole) {
  return role === "owner" || role === "admin" || role === "connector";
}

export function canManageTeam(role: WorkspaceRole) {
  return role === "owner" || role === "admin";
}
