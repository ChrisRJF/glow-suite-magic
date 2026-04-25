import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  bootstrapReady: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  bootstrapReady: false,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapReady, setBootstrapReady] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setAuthLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!session?.user) {
      setBootstrapReady(false);
      setBootstrapping(false);
      return;
    }

    let cancelled = false;
    setBootstrapping(true);
    setBootstrapReady(false);

    const runBootstrap = async () => {
      const { error } = await (supabase.rpc as any)("bootstrap_current_user");
      if (cancelled) return;
      if (error) console.error("Account bootstrap mislukt", error);
      setBootstrapReady(!error);
      setBootstrapping(false);

      // Day 0 welcome email — idempotent server-side, safe to call on every login
      if (!error) {
        supabase.functions.invoke("send-welcome-email").catch((e) => {
          console.warn("welcome email trigger failed", e);
        });
      }
    };

    runBootstrap();
    return () => { cancelled = true; };
  }, [authLoading, session?.user?.id]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const loading = authLoading || bootstrapping;

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, bootstrapReady, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
