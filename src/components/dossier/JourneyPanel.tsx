import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Route, Plus, CalendarPlus, CheckCircle2, Clock3, Circle } from "lucide-react";
import { toast } from "sonner";
import { useDossierAccess } from "@/hooks/useDossierAccess";

interface Journey {
  id: string;
  name: string;
  status: string;
  planned_sessions: number | null;
  service_id: string | null;
  started_on: string | null;
}

interface Session {
  id: string;
  journey_id: string | null;
  journey_session_number: number | null;
  appointment_date: string;
  status: string;
}

/** P3 behandeltrajecten: meerdere sessies van één traject bij elkaar. */
export function JourneyPanel({ customerId }: { customerId: string }) {
  const navigate = useNavigate();
  const { canViewContent, loading } = useDossierAccess();
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [plannedSessions, setPlannedSessions] = useState(3);

  const load = async () => {
    const [j, s, sv] = await Promise.all([
      supabase
        .from("treatment_journeys")
        .select("id, name, status, planned_sessions, service_id, started_on")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false }),
      supabase
        .from("appointments")
        .select("id, journey_id, journey_session_number, appointment_date, status")
        .eq("customer_id", customerId)
        .not("journey_id", "is", null),
      supabase.from("services").select("id, name").eq("is_active", true).order("name"),
    ]);
    setJourneys((j.data as Journey[]) || []);
    setSessions((s.data as Session[]) || []);
    setServices((sv.data as { id: string; name: string }[]) || []);
  };

  useEffect(() => {
    if (!loading && canViewContent) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, canViewContent, customerId]);

  if (loading || !canViewContent) return null;

  const create = async () => {
    if (!name.trim()) return toast.error("Geef het traject een naam");
    const { data: tenant } = await supabase.rpc("current_tenant_id");
    const { error } = await supabase.from("treatment_journeys").insert({
      user_id: tenant as string,
      customer_id: customerId,
      name: name.trim(),
      service_id: serviceId || null,
      planned_sessions: plannedSessions,
      started_on: new Date().toISOString().slice(0, 10),
    });
    if (error) return toast.error("Aanmaken mislukt");
    toast.success("Traject aangemaakt");
    setAdding(false);
    setName("");
    setServiceId("");
    load();
  };

  const planSession = (j: Journey, nextNumber: number) => {
    const params = new URLSearchParams({
      nieuw: "1",
      klant: customerId,
      traject: j.id,
      sessie: String(nextNumber),
    });
    if (j.service_id) params.set("behandeling", j.service_id);
    navigate(`/agenda?${params.toString()}`);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Route className="h-4 w-4 text-primary" /> Behandeltrajecten
        </h4>
        <Button variant="ghost" size="sm" onClick={() => setAdding(!adding)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Nieuw
        </Button>
      </div>

      <GuidanceHint id="traject-sessies" text="Hier zie je welke sessies klaar zijn en wat de volgende stap is." />


      {adding && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <Input placeholder="Naam, bijvoorbeeld Huidverbetering" value={name} onChange={(e) => setName(e.target.value)} />
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="w-full rounded-xl border border-border bg-secondary/50 px-3 py-2 text-sm"
          >
            <option value="">Behandeling (optioneel)</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <Input
            type="number"
            min={1}
            max={50}
            value={plannedSessions}
            onChange={(e) => setPlannedSessions(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
          />
          <Button size="sm" onClick={create}>Opslaan</Button>
        </div>
      )}

      {journeys.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nog geen traject voor deze klant.</p>
      ) : (
        journeys.map((j) => {
          const mine = sessions
            .filter((s) => s.journey_id === j.id)
            .sort((a, b) => (a.journey_session_number ?? 0) - (b.journey_session_number ?? 0));
          const next = (mine.reduce((m, s) => Math.max(m, s.journey_session_number ?? 0), 0) || 0) + 1;
          const completedCount = mine.filter((s) => ["voltooid", "completed"].includes(s.status.toLowerCase())).length;
          const plannedCount = j.planned_sessions ?? Math.max(mine.length, next);
          const upcoming = mine.find((s) => !["voltooid", "completed", "geannuleerd", "cancelled"].includes(s.status.toLowerCase()));
          return (
            <div key={j.id} className="space-y-3 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{j.name}</p>
                  <p className="text-xs text-muted-foreground">{completedCount} van {plannedCount} sessies afgerond</p>
                </div>
                <span className="text-xs font-medium text-primary">Sessie {upcoming?.journey_session_number ?? next} is de volgende stap</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {Array.from({ length: plannedCount }, (_, index) => {
                  const number = index + 1;
                  const session = mine.find((item) => item.journey_session_number === number);
                  const complete = Boolean(session && ["voltooid", "completed"].includes(session.status.toLowerCase()));
                  const planned = Boolean(session && !complete);
                  const Icon = complete ? CheckCircle2 : planned ? Clock3 : Circle;
                  return (
                    <div key={number} className={`rounded-lg border px-3 py-2 ${complete ? "border-success/20 bg-success/5" : planned ? "border-primary/25 bg-primary/5" : "border-border bg-secondary/20"}`}>
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${complete ? "text-success" : planned ? "text-primary" : "text-muted-foreground"}`} />
                        <span className="text-xs font-semibold">Sessie {number}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {complete ? "Afgerond" : planned ? "Gepland" : "Nog te plannen"}
                        {session ? ` · ${new Date(session.appointment_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}` : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
              {!upcoming && (
                <Button variant="outline" size="sm" onClick={() => planSession(j, next)}>
                  <CalendarPlus className="mr-1 h-3.5 w-3.5" /> Vervolgafspraak plannen
                </Button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
