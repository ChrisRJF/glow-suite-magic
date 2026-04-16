import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import logoFull from "@/assets/logo-full.png";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Supabase parses the recovery hash automatically into a session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { toast.error("Wachtwoord moet minstens 6 tekens zijn"); return; }
    if (password !== confirm) { toast.error("Wachtwoorden komen niet overeen"); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Wachtwoord bijgewerkt — je bent nu ingelogd");
      navigate("/", { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Bijwerken mislukt");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src={logoFull} alt="GlowSuite" className="h-12 w-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nieuw wachtwoord instellen</p>
        </div>
        <form onSubmit={handleSubmit} className="glass-card p-6 space-y-4">
          {!ready && (
            <p className="text-xs text-muted-foreground text-center">
              Link verifiëren... Open deze pagina via de link in je e-mail.
            </p>
          )}
          <div>
            <label className="text-xs text-muted-foreground">Nieuw wachtwoord</label>
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Minimaal 6 tekens" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Bevestig wachtwoord</label>
            <input type="password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <Button type="submit" variant="gradient" className="w-full" disabled={loading || !ready}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {loading ? "Opslaan..." : "Wachtwoord opslaan"}
          </Button>
        </form>
      </div>
    </div>
  );
}
