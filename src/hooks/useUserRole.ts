import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { hasPermission, type AppRole } from "@/lib/permissions";

export type { AppRole };

export function useUserRole() {
  const { user, loading: authLoading } = useAuth();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setRoles([]);
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (!active) return;
      const list = (data || []).map((r: any) => r.role as AppRole);
      setRoles(list);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [user, authLoading]);

  const hasRole = (role: AppRole) => roles.includes(role);
  const hasAny = (...checks: AppRole[]) => checks.some((r) => roles.includes(r));
  const isOwner = hasRole("eigenaar");
  const isAdmin = hasAny("eigenaar", "manager", "admin");
  const isStaff = hasAny("eigenaar", "manager", "admin", "medewerker", "receptie");
  const isFinance = hasAny("eigenaar", "manager", "admin", "financieel");

  return { roles, loading, hasRole, hasAny, can: (permission: Parameters<typeof hasPermission>[1]) => hasPermission(roles, permission), isOwner, isAdmin, isStaff, isFinance };
}

// Map of which roles may access each route path (prefix match)
export const ROUTE_PERMISSIONS: Record<string, AppRole[]> = {
  "/": ["eigenaar", "manager", "admin", "medewerker", "financieel", "receptie"],
  "/eigenaar": ["eigenaar", "manager"],
  "/agenda": ["eigenaar", "manager", "admin", "medewerker", "receptie"],
  "/klanten": ["eigenaar", "manager", "admin", "medewerker", "receptie"],
  "/wachtlijst": ["eigenaar", "manager", "admin", "medewerker", "receptie"],
  "/behandelingen": ["eigenaar", "manager", "admin"],
  "/medewerkers": ["eigenaar", "manager", "admin"],
  "/boeken": ["eigenaar", "manager", "admin"],
  "/producten": ["eigenaar", "manager", "admin"],
  "/kassa": ["eigenaar", "manager", "admin", "medewerker", "receptie"],
  "/cadeaubonnen": ["eigenaar", "manager", "admin", "medewerker", "receptie"],
  "/webshop": ["eigenaar", "manager", "admin"],
  "/abonnementen": ["eigenaar", "manager", "admin"],
  "/herboekingen": ["eigenaar", "manager", "admin", "medewerker", "receptie"],
  "/marketing": ["eigenaar", "manager", "admin"],
  "/social-studio": ["eigenaar", "manager", "admin"],
  "/acties": ["eigenaar", "manager", "admin"],
  "/leads": ["eigenaar", "manager", "admin", "medewerker", "receptie"],
  "/automatiseringen": ["eigenaar", "manager", "admin", "medewerker", "receptie"],
  "/automations": ["eigenaar", "manager", "admin", "medewerker", "receptie"],
  "/whatsapp": ["eigenaar", "manager", "admin"],
  "/glowpay": ["eigenaar", "manager", "financieel"],
  "/refunds": ["eigenaar", "manager", "admin", "financieel"],
  "/omzet": ["eigenaar", "manager", "admin", "financieel"],
  "/rapporten": ["eigenaar", "manager", "admin", "financieel"],
  "/instellingen": ["eigenaar", "manager", "admin", "financieel"],
  "/support": ["eigenaar", "manager", "admin", "medewerker", "financieel", "receptie"],
  "/mijn-abonnement": ["eigenaar"],
  "/launch-status": ["eigenaar"],
  "/qa-status": ["eigenaar", "manager", "admin"],
  "/admin/email-templates": ["eigenaar", "manager", "admin"],
};

export function canAccessRoute(path: string, roles: AppRole[]): boolean {
  if (roles.length === 0) return false;
  const allowed = ROUTE_PERMISSIONS[path];
  if (!allowed) return false;
  return allowed.some((r) => roles.includes(r));
}
