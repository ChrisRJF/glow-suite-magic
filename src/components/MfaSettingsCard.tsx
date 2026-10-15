import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { usePlatformAccess } from "@/hooks/usePlatformAccess";
import { canOfferRemoval, unverifiedTotpFactors, verifiedTotpFactors } from "@/lib/mfaFactors";

type Enroll = { factorId: string; qr: string };
type Factor = { id: string; status: string; factor_type?: string; friendly_name?: string | null; created_at?: string };

/** Authenticator-app (TOTP) setup via Supabase Auth MFA. Secrets are never shown or logged; only the QR image is rendered. */
export function MfaSettingsCard() {
  const platform = usePlatformAccess();
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState<Factor[]>([]);
  const [aal2, setAal2] = useState(false);
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    const { data } = await supabase.auth.mfa.listFactors();
    setVerified(verifiedTotpFactors((data?.all ?? data?.totp ?? []) as Factor[]));
    const { data: lvl } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setAal2(lvl?.currentLevel === "aal2");
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const ownerStatus: "owner" | "not_owner" | "unknown" = platform.loading ? "unknown" : platform.owner ? "owner" : "not_owner";
  const removable = canOfferRemoval({ verifiedCount: verified.length, ownerStatus, aal2 });
  const finalOwnerFactor = ownerStatus !== "not_owner" && verified.length === 1;

  const start = async () => {
    setBusy(true);
    // Only unfinished (unverified) setups are cleaned up. Verified factors are never touched here.
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of unverifiedTotpFactors((data?.all ?? []) as Factor[])) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const n = verified.length + 1;
    const { data: e, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `GlowSuite app ${n} ${Date.now()}` });
    setBusy(false);
    if (error || !e) { toast.error("Instellen starten is niet gelukt."); return; }
    setEnroll({ factorId: e.id, qr: e.totp.qr_code });
  };

  const confirm = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!enroll) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.factorId, code: code.trim() });
    setBusy(false); setCode("");
    if (error) { toast.error("Code onjuist of verlopen. Probeer het opnieuw."); return; }
    setEnroll(null);
    toast.success(verified.length > 0 ? "Extra authenticator is toegevoegd." : "Tweestapsverificatie is actief.");
    await refresh();
  };

  const cancel = async () => {
    if (enroll) await supabase.auth.mfa.unenroll({ factorId: enroll.factorId });
    setEnroll(null); setCode("");
  };

  // Removal requires a fresh code from the factor being removed.
  const remove = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!removingId || !removable) return;
    setBusy(true);
    const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: removingId, code: code.trim() });
    if (vErr) { setBusy(false); setCode(""); toast.error("Code onjuist of verlopen."); return; }
    const { error } = await supabase.auth.mfa.unenroll({ factorId: removingId });
    setBusy(false); setCode(""); setRemovingId(null);
    if (error) { toast.error("Verwijderen is niet gelukt."); return; }
    await supabase.auth.refreshSession();
    toast.success("Authenticator is verwijderd.");
    await refresh();
  };

  const codeInput = (
    <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" aria-label="Verificatiecode" className="max-w-[10rem]" />
  );

  const enrollForm = enroll && (
    <form onSubmit={confirm} className="space-y-3">
      <p className="text-sm text-muted-foreground">Scan de QR-code met je authenticator-app. Vul daarna de 6-cijferige code in. De app telt pas mee na deze controle.</p>
      <img src={enroll.qr} alt="QR-code voor authenticator-app" className="h-44 w-44 rounded-lg bg-card p-2" />
      <div className="flex flex-wrap items-center gap-2">
        {codeInput}
        <Button type="submit" size="sm" disabled={busy || code.length !== 6}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Bevestigen
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={cancel}>Annuleren</Button>
      </div>
    </form>
  );

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h3 className="text-base font-semibold">Tweestapsverificatie</h3>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : verified.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-medium text-success">MFA actief.</span> Bij inloggen vragen we een code uit je authenticator-app.
          </p>
          <p className="text-sm text-muted-foreground" data-testid="mfa-count">
            {verified.length === 1 ? "1 authenticator actief." : `${verified.length} authenticators actief.`}
          </p>
          <ul className="space-y-2">
            {verified.map((f, i) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
                <Smartphone className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm flex-1">Authenticator {i + 1}</span>
                {removable && removingId !== f.id && (
                  <Button variant="outline" size="sm" onClick={() => { setRemovingId(f.id); setCode(""); }}>Verwijderen</Button>
                )}
                {removingId === f.id && (
                  <form onSubmit={remove} className="flex w-full flex-wrap items-center gap-2">
                    <span className="w-full text-xs text-muted-foreground">Vul een code in uit deze authenticator.</span>
                    {codeInput}
                    <Button type="submit" variant="destructive" size="sm" disabled={busy || code.length !== 6}>Bevestig verwijderen</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setRemovingId(null); setCode(""); }}>Annuleren</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {finalOwnerFactor && (
            <p className="text-xs text-muted-foreground" data-testid="mfa-owner-note">
              Als platformeigenaar kun je je laatste authenticator hier niet verwijderen. Voeg eerst een tweede authenticator toe als reserve.
            </p>
          )}
          {enroll ? enrollForm : (
            <Button size="sm" variant="outline" onClick={start} disabled={busy || !aal2}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Extra authenticator toevoegen
            </Button>
          )}
        </div>
      ) : enroll ? enrollForm : (
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
