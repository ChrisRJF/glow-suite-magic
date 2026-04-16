import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AppRole = "eigenaar" | "admin" | "medewerker" | "financieel";

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
      // Safety: if the user has no roles (legacy account), assume eigenaar
      setRoles(list.length > 0 ? list : ["eigenaar"]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [user, authLoading]);

  const hasRole = (role: AppRole) => roles.includes(role);
  const hasAny = (...checks: AppRole[]) => checks.some((r) => roles.includes(r));
  const isOwner = hasRole("eigenaar");
  const isAdmin = hasAny("eigenaar", "admin");
  const isStaff = hasAny("eigenaar", "admin", "medewerker");
  const isFinance = hasAny("eigenaar", "admin", "financieel");

  return { roles, loading, hasRole, hasAny, isOwner, isAdmin, isStaff, isFinance };
}

// Map of which roles may access each route path (prefix match)
export const ROUTE_PERMISSIONS: Record<string, AppRole[]> = {
  "/": ["eigenaar", "admin", "medewerker", "financieel"],
  "/agenda": ["eigenaar", "admin", "medewerker"],
  "/klanten": ["eigenaar", "admin", "medewerker"],
  "/wachtlijst": ["eigenaar", "admin", "medewerker"],
  "/behandelingen": ["eigenaar", "admin"],
  "/producten": ["eigenaar", "admin"],
  "/kassa": ["eigenaar", "admin", "medewerker"],
  "/cadeaubonnen": ["eigenaar", "admin", "medewerker"],
  "/webshop": ["eigenaar", "admin"],
  "/abonnementen": ["eigenaar", "admin"],
  "/herboekingen": ["eigenaar", "admin", "medewerker"],
  "/marketing": ["eigenaar", "admin"],
  "/social-studio": ["eigenaar", "admin"],
  "/acties": ["eigenaar", "admin"],
  "/leads": ["eigenaar", "admin", "medewerker"],
  "/automatiseringen": ["eigenaar", "admin"],
  "/whatsapp": ["eigenaar", "admin"],
  "/glowpay": ["eigenaar", "admin", "financieel"],
  "/omzet": ["eigenaar", "admin", "financieel"],
  "/rapporten": ["eigenaar", "admin", "financieel"],
  "/instellingen": ["eigenaar", "admin"],
  "/support": ["eigenaar", "admin", "medewerker", "financieel"],
  "/launch-status": ["eigenaar"],
};

export function canAccessRoute(path: string, roles: AppRole[]): boolean {
  if (roles.length === 0) return false;
  const allowed = ROUTE_PERMISSIONS[path];
  if (!allowed) return true; // unknown routes default to allowed
  return allowed.some((r) => roles.includes(r));
}
