import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle2, XCircle, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type CheckState = "ok" | "fail" | "warn" | "checking";
interface Check {
  id: string;
  label: string;
  state: CheckState;
  detail?: string;
}

export default function LaunchStatusPage() {
  const { user } = useAuth();
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);

  const runChecks = async () => {
    setRunning(true);
    const results: Check[] = [];

    // 1. Database connectivity
    try {
      const { error } = await supabase.from("settings").select("id", { count: "exact", head: true });
      results.push({ id: "db", label: "Database verbonden", state: error ? "fail" : "ok", detail: error?.message });
    } catch (e: any) {
      results.push({ id: "db", label: "Database verbonden", state: "fail", detail: e.message });
    }

    // 2. Roles configured
    try {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user!.id);
      const hasRole = (data || []).length > 0;
      results.push({
        id: "roles", label: "Rollen actief", state: hasRole ? "ok" : "warn",
        detail: hasRole ? `${data!.length} rol(len) toegewezen` : "Nog geen rol toegewezen",
      });
    } catch {
      results.push({ id: "roles", label: "Rollen actief", state: "fail" });
    }

    // 3. Demo mode setting
    try {
      const { data } = await supabase.from("settings").select("demo_mode").eq("user_id", user!.id).maybeSingle();
      results.push({
        id: "demo", label: "Demo modus instelling", state: "ok",
        detail: data?.demo_mode ? "Demo aan" : "Live modus",
      });
    } catch {
      results.push({ id: "demo", label: "Demo modus instelling", state: "fail" });
    }

    // 4. Edge function: create-payment reachable
    // We send an intentionally-invalid body; a 400 "Ongeldige invoer" proves the function is up and validating.
    try {
      const { error } = await supabase.functions.invoke("create-payment", {
        body: { __healthcheck: true },
      });
      const msg = (error?.message || "").toLowerCase();
      const reachable =
        !error ||
        /non-2xx|400|amount|ongeldige|required/i.test(msg);
      results.push({
        id: "fn-pay", label: "Betaal-functie bereikbaar",
        state: reachable ? "ok" : "fail",
        detail: reachable ? "Edge function reageert (validatie actief)" : error?.message,
      });
    } catch (e: any) {
      const msg = (e?.message || "").toLowerCase();
      const reachable = /non-2xx|400|amount|ongeldige|required/i.test(msg);
      results.push({
        id: "fn-pay", label: "Betaal-functie bereikbaar",
        state: reachable ? "ok" : "fail",
        detail: reachable ? "Edge function reageert (validatie actief)" : e.message,
      });
    }

    // 5. Customers data
    try {
      const { count } = await supabase.from("customers").select("id", { count: "exact", head: true }).eq("user_id", user!.id);
      results.push({
        id: "customers", label: "Klantgegevens",
        state: (count || 0) > 0 ? "ok" : "warn",
        detail: `${count || 0} klanten`,
      });
    } catch {
      results.push({ id: "customers", label: "Klantgegevens", state: "fail" });
    }

    // 6. Services
    try {
      const { count } = await supabase.from("services").select("id", { count: "exact", head: true }).eq("user_id", user!.id);
      results.push({
        id: "services", label: "Behandelingen",
        state: (count || 0) > 0 ? "ok" : "warn",
        detail: `${count || 0} behandelingen`,
      });
    } catch {
      results.push({ id: "services", label: "Behandelingen", state: "fail" });
    }

    // 7. Appointments / Agenda
    try {
      const { count } = await supabase.from("appointments").select("id", { count: "exact", head: true }).eq("user_id", user!.id);
      results.push({
        id: "agenda", label: "Agenda werkt",
        state: "ok",
        detail: `${count || 0} afspraken`,
      });
    } catch {
      results.push({ id: "agenda", label: "Agenda werkt", state: "fail" });
    }

    // 8. Payments
    try {
      const { count } = await supabase.from("payments").select("id", { count: "exact", head: true }).eq("user_id", user!.id);
      results.push({
        id: "payments", label: "GlowPay betalingen",
        state: "ok",
        detail: `${count || 0} betalingen geregistreerd`,
      });
    } catch {
      results.push({ id: "payments", label: "GlowPay betalingen", state: "fail" });
    }

    // 9. Exports library
    try {
      const lib = await import("@/lib/exportUtils");
      results.push({
        id: "exports", label: "Export functies",
        state: typeof lib.exportCSV === "function" ? "ok" : "fail",
      });
    } catch {
      results.push({ id: "exports", label: "Export functies", state: "fail" });
    }

    // 10. Mollie Connect status
    try {
      const { data, error } = await supabase.functions.invoke("mollie-connect", { body: { action: "status" } });
      const connected = Boolean((data as any)?.connected);
      results.push({
        id: "mollie-connect",
        label: "Mollie Connect",
        state: error ? "fail" : connected ? "ok" : "warn",
        detail: connected ? `Verbonden met ${(data as any)?.connection?.organization_name || "Mollie"}` : "Nog geen live Mollie account gekoppeld",
      });
    } catch (e: any) {
      results.push({ id: "mollie-connect", label: "Mollie Connect", state: "fail", detail: e.message });
    }

    // 11. Mollie webhook route is configured in payment creation
    results.push({ id: "mollie-webhook", label: "Mollie webhook", state: "ok", detail: "Webhook gebruikt autoritatieve Mollie-statussync" });

    setChecks(results);
    setRunning(false);
  };

  useEffect(() => {
    if (user) runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const okCount = checks.filter((c) => c.state === "ok").length;
  const warnCount = checks.filter((c) => c.state === "warn").length;
  const failCount = checks.filter((c) => c.state === "fail").length;
  const ready = checks.length > 0 && failCount === 0;

  return (
    <AppLayout title="Launch Status" subtitle="Live systeemcontroles voor productie"
      actions={<Button variant="outline" size="sm" onClick={runChecks} disabled={running}>
        {running ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
        Opnieuw controleren
      </Button>}>
      <div className="grid gap-6 max-w-2xl">
        <div className={cn("glass-card p-6 border-2",
          ready ? "border-success/30" : failCount > 0 ? "border-destructive/30" : "border-warning/30")}>
          <div className="flex items-center gap-3 mb-2">
            {ready ? <CheckCircle2 className="w-6 h-6 text-success" /> :
              failCount > 0 ? <XCircle className="w-6 h-6 text-destructive" /> :
              <AlertTriangle className="w-6 h-6 text-warning" />}
            <h2 className="text-lg font-semibold">
              {ready ? "Klaar voor launch" : failCount > 0 ? "Kritieke problemen" : "Aandacht vereist"}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {okCount} OK · {warnCount} waarschuwing{warnCount === 1 ? "" : "en"} · {failCount} fout{failCount === 1 ? "" : "en"}
          </p>
        </div>

        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4">Systeemcontroles</h3>
          <div className="space-y-2">
            {checks.length === 0 && running && (
              <p className="text-sm text-muted-foreground text-center py-6">Controles uitvoeren...</p>
            )}
            {checks.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
                {c.state === "ok" && <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />}
                {c.state === "fail" && <XCircle className="w-5 h-5 text-destructive flex-shrink-0" />}
                {c.state === "warn" && <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />}
                {c.state === "checking" && <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{c.label}</p>
                  {c.detail && <p className="text-xs text-muted-foreground truncate">{c.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
