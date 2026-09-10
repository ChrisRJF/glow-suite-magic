import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DossierAccess {
  loading: boolean;
  /** May see that a form was sent/completed, never the answers. */
  canViewStatus: boolean;
  /** May see answers, signature and snapshot. */
  canViewContent: boolean;
  canSend: boolean;
  canManageTemplates: boolean;
}

/**
 * Single source of truth for dossier permissions: the database decides.
 * The UI only mirrors what RLS would allow anyway.
 */
export function useDossierAccess(): DossierAccess {
  const [state, setState] = useState<DossierAccess>({
    loading: true,
    canViewStatus: false,
    canViewContent: false,
    canSend: false,
    canManageTemplates: false,
  });

  useEffect(() => {
    let active = true;
    (async () => {
      const [status, content, send, manage] = await Promise.all([
        supabase.rpc("can_view_dossier_status"),
        supabase.rpc("can_view_dossier_content"),
        supabase.rpc("can_send_customer_form"),
        supabase.rpc("can_manage_form_templates"),
      ]);
      if (!active) return;
      setState({
        loading: false,
        canViewStatus: status.data === true,
        canViewContent: content.data === true,
        canSend: send.data === true,
        canManageTemplates: manage.data === true,
      });
    })();
    return () => {
      active = false;
    };
  }, []);

  return state;
}
