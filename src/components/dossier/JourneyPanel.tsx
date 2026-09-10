import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Route, Plus, CalendarPlus } from "lucide-react";
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
          return (
            <div key={j.id} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{j.name}</p>
                <span className="text-xs text-muted-foreground">
                  {mine.length}/{j.planned_sessions ?? "?"} sessies
                </span>
              </div>
              {mine.map((s) => (
                <p key={s.id} className="text-xs text-muted-foreground">
                  Sessie {s.journey_session_number ?? "?"} ·{" "}
                  {new Date(s.appointment_date).toLocaleDateString("nl-NL", { dateStyle: "medium" })}
                </p>
              ))}
              <Button variant="outline" size="sm" onClick={() => planSession(j, next)}>
                <CalendarPlus className="mr-1 h-3.5 w-3.5" /> Controle-afspraak plannen
              </Button>
            </div>
          );
        })
      )}
    </div>
  );
}
