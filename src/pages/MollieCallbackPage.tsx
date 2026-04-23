import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export default function MollieCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Mollie koppeling afronden...");

  useEffect(() => {
    const finish = async () => {
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      const errorParam = searchParams.get("error");
      const errorDescription = searchParams.get("error_description");
      if (errorParam) {
        setStatus("error");
        setMessage(errorDescription || "De Mollie koppeling kon niet worden afgerond. Probeer opnieuw.");
        return;
      }
      if (!code || !state) {
        setStatus("error");
        setMessage("De Mollie koppeling kon niet worden afgerond. Probeer opnieuw.");
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("mollie-connect", {
        body: { action: "callback", code, state },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || (data as any)?.error) {
        setStatus("error");
        setMessage((data as any)?.error || "De Mollie koppeling kon niet worden afgerond. Probeer opnieuw.");
        return;
      }
      setStatus("success");
      setMessage("Mollie is succesvol gekoppeld.");
      window.setTimeout(() => {
        window.location.replace("/instellingen?tab=integraties&mollie=connected");
      }, 1400);
    };
    finish();
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="glass-card p-8 max-w-md w-full text-center">
        <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-4">
          {status === "loading" && <Loader2 className="w-6 h-6 text-primary animate-spin" />}
          {status === "success" && <CheckCircle2 className="w-6 h-6 text-success" />}
          {status === "error" && <XCircle className="w-6 h-6 text-destructive" />}
        </div>
        <h1 className="text-xl font-semibold mb-2">Mollie Connect</h1>
        <p className="text-sm text-muted-foreground mb-6">{message}</p>
        {status !== "loading" && <Button variant="gradient" onClick={() => navigate("/instellingen?tab=integraties")}>Terug naar integraties</Button>}
      </div>
    </div>
  );
}
