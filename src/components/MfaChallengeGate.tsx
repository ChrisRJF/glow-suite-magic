import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck, Loader2 } from "lucide-react";

/**
 * Shows a code prompt when the signed-in account has a verified authenticator
 * but the current session has not passed it yet (aal1 while aal2 is possible).
 * Uses only Supabase Auth MFA; nothing is stored or logged.
 */
export function MfaChallengeGate() {
  const [needed, setNeeded] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data && data.nextLevel === "aal2" && data.currentLevel !== "aal2") {
      const { data: f } = await supabase.auth.mfa.listFactors();
      const totp = f?.totp?.find((x) => x.status === "verified");
      if (totp) { setFactorId(totp.id); setNeeded(true); return; }
    }
    setNeeded(false);
  };

  useEffect(() => {
    check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { setTimeout(check, 0); });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!needed || !factorId) return null;

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false); setCode("");
    if (error) { setError("Code onjuist of verlopen. Probeer het opnieuw."); return; }
    await check();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4">
      <form onSubmit={verify} className="glass-card w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Tweestapsverificatie</h2>
        </div>
        <p className="text-sm text-muted-foreground">Vul de 6-cijferige code uit je authenticator-app in.</p>
        <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" aria-label="Verificatiecode" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Bevestigen
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => supabase.auth.signOut()}>Uitloggen</Button>
      </form>
    </div>
  );
}
