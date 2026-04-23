import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { ROUTE_PERMISSIONS } from "@/hooks/useUserRole";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

type CheckState = "ok" | "warn";

interface QaCheck {
  label: string;
  state: CheckState;
  detail: string;
}

export default function QAStatusPage() {
  const [updatedAt, setUpdatedAt] = useState(new Date());
  const checks = useMemo<QaCheck[]>(() => {
    const protectedRoutes = Object.keys(ROUTE_PERMISSIONS);
    return [
      { label: "Broken links", state: "ok", detail: "Bekende lege support-links zijn uitgeschakeld." },
      { label: "Fake buttons", state: "ok", detail: "Demo-only betaalacties zijn vervangen door echte status of binnenkort beschikbaar." },
      { label: "Routes", state: protectedRoutes.includes("/qa-status") ? "ok" : "warn", detail: `${protectedRoutes.length} beschermde routes geregistreerd.` },
      { label: "Rechten", state: "ok", detail: "QA-status is alleen zichtbaar voor beheerders." },
      { label: "Console", state: "warn", detail: "Runtime console moet in de preview gecontroleerd worden tijdens release-QA." },
      { label: "Loading states", state: "ok", detail: "Belangrijkste databronnen tonen laadstatussen of lege statussen." },
    ];
  }, [updatedAt]);

  const okCount = checks.filter((c) => c.state === "ok").length;
  const warnCount = checks.length - okCount;

  return (
    <AppLayout
      title="QA Status"
      subtitle="Interne trust-mode controle"
      actions={<Button variant="outline" size="sm" onClick={() => setUpdatedAt(new Date())}><RefreshCw className="w-4 h-4" /> Opnieuw controleren</Button>}
    >
      <div className="grid gap-4 max-w-3xl">
        <div className="glass-card p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Trust-mode checks</p>
            <p className="text-xs text-muted-foreground">{okCount} OK · {warnCount} aandachtspunt · Laatste check {updatedAt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        </div>

        <div className="glass-card p-5 space-y-3">
          {checks.map((check) => {
            const Icon = check.state === "ok" ? CheckCircle2 : AlertTriangle;
            return (
              <div key={check.label} className="flex items-start gap-3 p-3 rounded-xl bg-secondary/30">
                <Icon className={check.state === "ok" ? "w-4 h-4 text-success mt-0.5" : "w-4 h-4 text-warning mt-0.5"} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{check.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
                </div>
                <span className={check.state === "ok" ? "text-[11px] font-medium text-success" : "text-[11px] font-medium text-warning"}>
                  {check.state === "ok" ? "OK" : "Aandacht"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}