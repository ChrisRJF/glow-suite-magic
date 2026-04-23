import { useLocation, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole, canAccessRoute, type AppRole } from "@/hooks/useUserRole";
import { AppLayout } from "@/components/AppLayout";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

interface Props {
  children: React.ReactNode;
  /** Optional: restrict to specific roles (overrides ROUTE_PERMISSIONS map) */
  allow?: AppRole[];
}

export function RoleProtectedRoute({ children, allow }: Props) {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRole();
  const location = useLocation();

  if (authLoading || rolesLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground text-sm">Laden...</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const allowed = allow
    ? allow.some((r) => roles.includes(r))
    : canAccessRoute(location.pathname, roles);

  if (!allowed) {
    const hasNoRole = roles.length === 0;
    return (
      <AppLayout title="Geen toegang" subtitle={hasNoRole ? "Je account heeft nog geen rechten" : "Je hebt geen rechten voor deze pagina"}>
        <div className="flex flex-col items-center justify-center text-center py-16 max-w-md mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
            <ShieldAlert className="w-8 h-8 text-destructive" />
          </div>
          <h2 className="text-lg font-semibold mb-2">Geen toegang tot deze pagina</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {hasNoRole
              ? "Je account heeft nog geen rechten. Neem contact op met de eigenaar."
              : `Je huidige rol (${roles.join(", ")}) heeft geen toegang tot dit gedeelte. Vraag de eigenaar om je rechten aan te passen.`}
          </p>
          <Link to="/"><Button variant="gradient" size="sm">Terug naar overzicht</Button></Link>
        </div>
      </AppLayout>
    );
  }

  return <>{children}</>;
}
