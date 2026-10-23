/**
 * Actors, roles and permissions.
 *
 * Permissions are dotted strings: "<module>.<capability>", e.g. "bim.read",
 * "bim.write", "bim.delete", "platform.approve". Wildcards: "*" and "bim.*".
 * An AI agent is an actor like any other: it gets roles, and its writes can be
 * forced through human approval.
 */

export type ActorKind = "human" | "ai" | "system";

export interface Actor {
  id: string;
  name: string;
  kind: ActorKind;
  roles: string[];
}

export type RoleTable = Record<string, string[]>;

export const DEFAULT_ROLES: RoleTable = {
  admin: ["*"],
  bim_manager: ["bim.*", "infra.*", "files.*", "platform.approve", "platform.undo", "platform.audit"],
  modeler: ["files.read", "files.write", "bim.read", "bim.write", "bim.export", "infra.read", "infra.write", "infra.export", "platform.undo", "platform.audit"],
  viewer: ["files.read", "bim.read", "bim.export", "infra.read", "infra.export"],
  ai_agent: ["files.read", "files.write", "bim.read", "bim.write", "bim.delete", "bim.export", "infra.read", "infra.write", "infra.delete", "infra.export", "platform.undo", "platform.audit"],
};

export function permissionsOf(actor: Actor, roles: RoleTable = DEFAULT_ROLES): string[] {
  const out = new Set<string>();
  for (const r of actor.roles) for (const p of roles[r] ?? []) out.add(p);
  return [...out];
}

export function can(actor: Actor, permission: string, roles: RoleTable = DEFAULT_ROLES): boolean {
  for (const p of permissionsOf(actor, roles)) {
    if (p === "*" || p === permission) return true;
    if (p.endsWith(".*") && permission.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}
