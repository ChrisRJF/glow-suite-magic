import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDossierOverview } from "@/hooks/useDossierOverview";

interface Hit {
  key: string;
  category: string;
  label: string;
  date: string | null;
}

/** P4 zoeken binnen één klantdossier. Nooit over klanten heen. */
export function DossierSearchCard({ customerId }: { customerId: string }) {
  const o = useDossierOverview(customerId);
  const [term, setTerm] = useState("");

  const items = useMemo<Hit[]>(() => {
    const serviceName = (id: string | null) => o.services.find((s) => s.id === id)?.name || "Afspraak";
    return [
      ...o.appointments.map((a) => ({
        key: `a-${a.id}`,
        category: "Afspraak",
        label: serviceName(a.service_id),
        date: a.appointment_date,
      })),
      ...o.forms.map((f) => ({ key: `f-${f.id}`, category: "Formulier", label: f.title, date: f.created_at })),
      ...o.records.map((r) => ({
        key: `r-${r.id}`,
        category: "Behandelverslag",
        label: `${serviceName(r.service_id)} · ${r.status === "completed" ? "afgerond" : "concept"}`,
        date: r.completed_at || r.created_at,
      })),
      ...o.journeys.map((j) => ({ key: `j-${j.id}`, category: "Traject", label: j.name, date: null })),
      ...o.documents.map((d) => ({
        key: `d-${d.id}`,
        category: "Document",
        label: `${d.scope} (${d.format.toUpperCase()})`,
        date: d.created_at,
      })),
      ...o.alerts
        .filter((a) => a.label)
        .map((a) => ({ key: `al-${a.id}`, category: "Aandachtspunt", label: a.label as string, date: null })),
    ];
  }, [o.appointments, o.forms, o.records, o.journeys, o.documents, o.alerts, o.services]);

  const q = term.trim().toLowerCase();
  const hits = q.length < 2 ? [] : items.filter((i) => `${i.category} ${i.label}`.toLowerCase().includes(q)).slice(0, 20);

  if (o.loading) return null;

  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Search className="h-4 w-4 text-primary" /> Zoek in dossier
      </h4>
      <Input placeholder="Zoek een afspraak, formulier, verslag of document" value={term} onChange={(e) => setTerm(e.target.value)} />
      {q.length >= 2 && (
        hits.length === 0 ? (
          <p className="text-xs text-muted-foreground">Niets gevonden bij deze klant.</p>
        ) : (
          <ul className="space-y-1">
            {hits.map((h) => (
              <li key={h.key} className="rounded-xl border border-border px-3 py-2 text-xs">
                <span className="text-muted-foreground">{h.category}: </span>
                <span className="text-foreground">{h.label}</span>
                {h.date && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {new Date(h.date).toLocaleDateString("nl-NL", { dateStyle: "medium" })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
