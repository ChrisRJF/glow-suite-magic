import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** UI hint only. Every platform read is re-checked on the server (owner + AAL2). */
export function usePlatformAccess() {
  const { user, session } = useAuth() as any;
  const [state, setState] = useState<{ loading: boolean; owner: boolean; aal2: boolean }>({ loading: true, owner: false, aal2: false });

  useEffect(() => {
    let active = true;
    if (!user) { setState({ loading: false, owner: false, aal2: false }); return; }
    (async () => {
      const { data, error } = await (supabase.rpc as any)("platform_access_status");
      if (!active) return;
      const d = (data ?? {}) as { owner?: boolean; aal2?: boolean };
      setState({ loading: false, owner: !error && !!d.owner, aal2: !error && !!d.aal2 });
    })();
    return () => { active = false; };
  }, [user?.id, session?.access_token]);

  return state;
}
