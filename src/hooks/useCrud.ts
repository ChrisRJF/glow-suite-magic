import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type TableName = keyof import("@/integrations/supabase/types").Database["public"]["Tables"];

export function useCrud(table: TableName) {
  const { user } = useAuth();

  const insert = async (data: Record<string, any>) => {
    if (!user) { toast.error("Je bent niet ingelogd"); return null; }
    const { data: result, error } = await (supabase
      .from(table) as any)
      .insert({ ...data, user_id: user.id })
      .select()
      .single();
    if (error) { toast.error("Er ging iets mis: " + error.message); return null; }
    return result;
  };

  const update = async (id: string, data: Record<string, any>) => {
    if (!user) { toast.error("Je bent niet ingelogd"); return null; }
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
    const { error } = await (supabase.from(table) as any).delete().eq("id", id);
    if (error) { toast.error("Er ging iets mis: " + error.message); return false; }
    return true;
  };

  return { insert, update, remove };
}
