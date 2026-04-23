import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useUserRole } from "@/hooks/useUserRole";
import { requirePermission } from "@/lib/permissions";

type TableName = keyof import("@/integrations/supabase/types").Database["public"]["Tables"];

export function useCrud(table: TableName) {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const { roles } = useUserRole();

  const guard = (action: "insert" | "update" | "delete") => {
    if (table === "customers" && action === "insert") requirePermission(roles, "customers:create", "Je hebt geen rechten om klanten toe te voegen.");
    if (table === "customers" && action === "update") requirePermission(roles, "customers:update", "Je hebt geen rechten om klanten te wijzigen.");
    if (table === "customers" && action === "delete") requirePermission(roles, "customers:delete", "Alleen eigenaren en managers kunnen klanten verwijderen.");
    if (table === "payments" && action === "update") requirePermission(roles, "payments:update", "Alleen financiële rollen kunnen betalingen wijzigen.");
    if (table === "payment_links" && action !== "delete") requirePermission(roles, "payments:links", "Alleen financiële rollen kunnen betaalverzoeken beheren.");
    if (table === "user_roles") requirePermission(roles, "settings:team", "Alleen eigenaren kunnen gebruikersrechten wijzigen.");
    if (table === "settings") requirePermission(roles, "settings:business", "Je hebt geen rechten om deze instellingen te wijzigen.");
    if (table === "mollie_connections") requirePermission(roles, "mollie:manage", "Alleen eigenaren en beheerders kunnen Mollie beheren.");
  };

  const insert = async (data: Record<string, any>) => {
    if (!user) { toast.error("Je bent niet ingelogd"); return null; }
    try { guard("insert"); } catch (err: any) { toast.error(err.message); return null; }
    const scopedData = table === "profiles" || table === "user_roles"
      ? data
      : { ...data, is_demo: demoMode };
    const { data: result, error } = await (supabase
      .from(table) as any)
      .insert({ ...scopedData, user_id: user.id })
      .select()
      .single();
    if (error) { toast.error("Er ging iets mis: " + error.message); return null; }
    return result;
  };

  const update = async (id: string, data: Record<string, any>) => {
    if (!user) { toast.error("Je bent niet ingelogd"); return null; }
    try { guard("update"); } catch (err: any) { toast.error(err.message); return null; }
    const { data: result, error } = await (supabase
      .from(table) as any)
      .update(data)
      .eq("id", id)
      .select()
      .single();
    if (error) { toast.error("Er ging iets mis: " + error.message); return null; }
    return result;
  };

  const remove = async (id: string) => {
    if (!user) { toast.error("Je bent niet ingelogd"); return false; }
    try { guard("delete"); } catch (err: any) { toast.error(err.message); return false; }
    const { error } = await (supabase.from(table) as any).delete().eq("id", id);
    if (error) { toast.error("Er ging iets mis: " + error.message); return false; }
    return true;
  };

  return { insert, update, remove };
}
