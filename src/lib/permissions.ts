export type AppRole = "eigenaar" | "manager" | "admin" | "medewerker" | "financieel" | "receptie";

type Permission =
  | "customers:create"
  | "customers:update"
  | "customers:delete"
  | "payments:update"
  | "payments:refund"
  | "payments:links"
  | "reports:export"
  | "settings:business"
  | "settings:finance"
  | "settings:team"
  | "settings:integrations"
  | "settings:demo"
  | "mollie:manage"
  | "memberships:manage"
  | "memberships:delete"
  | "automations:manage"
  | "automations:delete";

const ROLE_PERMISSIONS: Record<AppRole, Permission[]> = {
  eigenaar: ["customers:create", "customers:update", "customers:delete", "payments:update", "payments:refund", "payments:links", "reports:export", "settings:business", "settings:finance", "settings:team", "settings:integrations", "settings:demo", "mollie:manage", "memberships:manage", "memberships:delete", "automations:manage", "automations:delete"],
  manager: ["customers:create", "customers:update", "customers:delete", "payments:update", "payments:refund", "payments:links", "reports:export", "settings:business", "settings:integrations", "mollie:manage", "memberships:manage", "automations:manage"],
  admin: ["customers:create", "customers:update", "customers:delete", "payments:update", "payments:refund", "payments:links", "reports:export", "settings:business", "settings:integrations", "mollie:manage", "memberships:manage", "automations:manage"],
  medewerker: ["customers:create", "customers:update"],
  receptie: ["customers:create", "customers:update"],
  financieel: ["payments:update", "payments:links", "reports:export"],
};

export function hasPermission(roles: AppRole[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission));
}

export function requirePermission(roles: AppRole[], permission: Permission, message = "Je hebt geen rechten voor deze actie.") {
  if (!hasPermission(roles, permission)) throw new Error(message);
}