import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Enroll = { factorId: string; qr: string; secret: string };

/** Authenticator-app (TOTP) setup via Supabase Auth MFA. Secrets stay in memory only, never logged. */
export function MfaSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [activeFactorId, setActiveFactorId] = useState<string | null>(null);
  const [aal2, setAal2] = useState(false);
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp?.find((f) => f.status === "verified");
    setActiveFactorId(verified?.id ?? null);
    const { data: lvl } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setAal2(lvl?.currentLevel === "aal2");
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const start = async () => {
    setBusy(true);
    // Clean up earlier unfinished setups so a fresh QR can be issued.
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.all ?? []) {
      if (f.factor_type === "totp" && f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data: e, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `GlowSuite ${Date.now()}` });
    setBusy(false);
    if (error || !e) { toast.error("Instellen starten is niet gelukt."); return; }
    setEnroll({ factorId: e.id, qr: e.totp.qr_code, secret: e.totp.secret });
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enroll) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.factorId, code: code.trim() });
    setBusy(false); setCode("");
    if (error) { toast.error("Code onjuist of verlopen. Probeer het opnieuw."); return; }
    setEnroll(null);
    toast.success("Tweestapsverificatie is actief.");
    await refresh();
  };

  const cancel = async () => {
    if (enroll) await supabase.auth.mfa.unenroll({ factorId: enroll.factorId });
    setEnroll(null); setCode("");
  };

  // Removal requires a fresh code in this session (re-authentication with the second factor).
  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFactorId) return;
    setBusy(true);
    const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: activeFactorId, code: code.trim() });
    if (vErr) { setBusy(false); setCode(""); toast.error("Code onjuist of verlopen."); return; }
    const { error } = await supabase.auth.mfa.unenroll({ factorId: activeFactorId });
    setBusy(false); setCode(""); setRemoving(false);
    if (error) { toast.error("Uitschakelen is niet gelukt."); return; }
    await supabase.auth.refreshSession();
    toast.success("Tweestapsverificatie is uitgeschakeld.");
    await refresh();
  };

  const codeInput = (
    <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" aria-label="Verificatiecode" className="max-w-[10rem]" />
  );

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h3 className="text-base font-semibold">Tweestapsverificatie</h3>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : activeFactorId ? (
        <div className="space-y-3">
          <p className="text-sm"><span className="font-medium text-success">MFA actief.</span> Bij inloggen vragen we een code uit je authenticator-app.</p>
          {!removing ? (
            <Button variant="outline" size="sm" onClick={() => setRemoving(true)} disabled={!aal2}>Uitschakelen</Button>
          ) : (
            <form onSubmit={remove} className="flex flex-wrap items-center gap-2">
              {codeInput}
              <Button type="submit" variant="destructive" size="sm" disabled={busy || code.length !== 6}>Bevestig uitschakelen</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setRemoving(false); setCode(""); }}>Annuleren</Button>
            </form>
          )}
        </div>
      ) : enroll ? (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-sm text-muted-foreground">Scan de QR-code met je authenticator-app en vul daarna de 6-cijferige code in.</p>
          <img src={enroll.qr} alt="QR-code voor authenticator-app" className="h-44 w-44 rounded-lg bg-card p-2" />
          <div className="text-xs text-muted-foreground">
            Handmatige sleutel: <code className="break-all font-mono text-foreground">{enroll.secret}</code>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {codeInput}
            <Button type="submit" size="sm" disabled={busy || code.length !== 6}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Bevestigen
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>Annuleren</Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Niet ingeschakeld. Beveilig je account met een code uit een authenticator-app.</p>
          <Button size="sm" onClick={start} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Activeren
          </Button>
        </div>
      )}
    </div>
  );
}
