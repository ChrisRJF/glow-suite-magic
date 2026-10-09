import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { History, Loader2, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useUserRole } from "@/hooks/useUserRole";
import {
  HISTORICAL_FIELDS, autoMap, matchCustomer, parseDate, parseTime, fingerprintSource, sha256,
  type CustomerLite, type HistoricalKind, type MatchResult,
} from "@/lib/historicalImport";

interface Batch { id: string; kind: string; importedAt: string; count: number }
interface Row { idx: number; raw: Record<string, string>; date: string | null; error?: string; match: MatchResult }

/**
 * Historical Salonized import (appointments + treatment notes).
 * Demo-only until validated against a real Salonized export. Server enforces the same.
 */
export function HistoricalImport() {
  const { demoMode } = useDemoMode();
  const { isAdmin } = useUserRole();
  const [kind, setKind] = useState<HistoricalKind>("treatment_note");
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [manual, setManual] = useState<Record<number, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ inserted: number; skipped: number; rejected: number; batchId: string } | null>(null);

  const [batches, setBatches] = useState<Batch[]>([]);
  const [undoTarget, setUndoTarget] = useState<Batch | null>(null);

  const loadBatches = async () => {
    const { data } = await (supabase as any).from("historical_dossier_entries").select("import_batch_id, kind, imported_at").not("import_batch_id", "is", null);
    const m = new Map<string, Batch>();
    for (const r of (data || []) as { import_batch_id: string; kind: string; imported_at: string }[]) {
      const b = m.get(r.import_batch_id) || { id: r.import_batch_id, kind: r.kind, importedAt: r.imported_at, count: 0 };
      b.count++; m.set(r.import_batch_id, b);
    }
    setBatches(Array.from(m.values()).sort((a, b) => b.importedAt.localeCompare(a.importedAt)));
  };

  // Server-side access per tenant: preview (check only) and import (write) are separate flags.
  const [access, setAccess] = useState<{ demo: boolean; preview: boolean; import: boolean } | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    supabase.rpc("history_import_access" as never).then(({ data }) => setAccess((data as never) || { demo: false, preview: false, import: false }));
  }, [isAdmin, demoMode]);
  const canPreview = !!access?.preview;
  const canImport = !!access?.import;

  useEffect(() => {
    if (!access || !isAdmin || !canPreview) return;
    if (canImport) loadBatches();
    supabase.from("customers").select("id, name, email, phone").eq("is_demo", access.demo)
      .then(({ data }) => setCustomers((data as CustomerLite[]) || []));
  }, [access, isAdmin, canPreview, canImport]);

  const fields = HISTORICAL_FIELDS[kind];
  const get = (r: Record<string, string>, k: string) => (map[k] ? String(r[map[k]] ?? "").trim() : "");

  const rows: Row[] = useMemo(() => data.map((r, idx) => {
    const date = parseDate(get(r, "date"));
    let error: string | undefined;
    if (!date) error = "Ongeldige of ontbrekende datum";
    else if (kind === "treatment_note" && !get(r, "note")) error = "Verslag ontbreekt";
    else if (kind === "appointment" && get(r, "time") && !parseTime(get(r, "time"))) error = "Ongeldige tijd";
    return { idx, raw: r, date, error, match: matchCustomer({ name: get(r, "customer_name"), email: get(r, "customer_email"), phone: get(r, "customer_phone") }, customers) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, map, customers, kind]);

  const customerFor = (r: Row) => (r.match.status === "matched" ? r.match.customerId : manual[r.idx] || null);
  const ready = rows.filter((r) => !r.error && customerFor(r));
  const toCheck = rows.filter((r) => !r.error && r.match.status === "check" && !manual[r.idx]);
  const unmatched = rows.filter((r) => !r.error && r.match.status === "none" && !manual[r.idx]);
  const invalid = rows.filter((r) => r.error);
  const missingRequired = fields.filter((f) => f.required && !map[f.key]);

  if (!isAdmin || !access) return null;

  if (!canPreview) {
    return (
      <div className="rounded-2xl border border-border p-4 opacity-70">
        <p className="text-sm font-semibold flex items-center gap-2"><History className="h-4 w-4" /> Historische dossiers uit Salonized</p>
        <p className="text-xs text-muted-foreground mt-1">Binnenkort beschikbaar. Deze import wordt eerst gecontroleerd met een echte Salonized-export.</p>
      </div>
    );
  }

  const onFile = (f: File) => {
    if (!f.name.toLowerCase().endsWith(".csv")) { toast.error("Gebruik een CSV-bestand."); return; }
    Papa.parse<Record<string, string>>(f, {
      header: true, skipEmptyLines: "greedy",
      complete: (res) => {
        const h = res.meta.fields || [];
        setHeaders(h); setData(res.data); setMap(autoMap(kind, h)); setManual({}); setConfirmed(false); setResult(null);
      },
    });
  };

  const runImport = async () => {
    if (!confirmed || ready.length === 0) return;
    setBusy(true);
    const batchId = crypto.randomUUID();
    const entries = await Promise.all(ready.map(async (r) => {
      const customerId = customerFor(r)!;
      const time = kind === "appointment" ? parseTime(get(r.raw, "time")) : null;
      const price = get(r.raw, "price").replace(/[€\s]/g, "").replace(",", ".");
      return {
        kind, customer_id: customerId, occurred_on: r.date, occurred_time: time,
        service_name: get(r.raw, "service_name") || null, employee_name: get(r.raw, "employee_name") || null,
        price: price && !isNaN(Number(price)) ? price : null, status: get(r.raw, "status") || null,
        note: kind === "treatment_note" ? get(r.raw, "note") : null,
        source_hash: await sha256(fingerprintSource(kind, customerId, { date: r.date!, time, service: get(r.raw, "service_name"), note: get(r.raw, "note") })),
      };
    }));
    const { data: res, error } = await supabase.rpc("import_historical_entries" as never, { _batch_id: batchId, _entries: entries } as never);
    setBusy(false);
    if (error) { toast.error("Import mislukt. Er is niets opgeslagen."); return; }
    const r = res as unknown as { inserted: number; skipped: number; rejected: number };
    setResult({ ...r, batchId });
    setData([]); setConfirmed(false);
    loadBatches();
  };

  const undo = async (b: Batch) => {
    const { data: n, error } = await supabase.rpc("rollback_historical_import" as never, { _batch_id: b.id } as never);
    if (error) { toast.error("Ongedaan maken mislukt."); return; }
    toast.success(`Import ongedaan gemaakt: ${n} records verwijderd`);
    setResult(null); loadBatches();
  };

  const label = kind === "appointment" ? "afspraken" : "verslagen";

  return (
    <div className="rounded-2xl border border-border p-4 space-y-4">
      <div>
        <p className="text-sm font-semibold flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Historische dossiers uit Salonized</p>
        <p className="text-xs text-muted-foreground mt-1">Alleen in de demo. Oude afspraken en verslagen worden alleen-lezen bewaard met de originele datum. Er wordt niets geboekt of verstuurd.</p>
      </div>

      <div className="flex gap-2">
        {(["treatment_note", "appointment"] as HistoricalKind[]).map((k) => (
          <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} onClick={() => { setKind(k); setData([]); setHeaders([]); setResult(null); }}>
            {k === "appointment" ? "Historische afspraken" : "Behandelverslagen"}
          </Button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer rounded-xl border border-dashed border-border p-3">
        <Upload className="h-4 w-4" /> CSV-bestand kiezen
        <input type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
      </label>

      {headers.length > 0 && data.length > 0 && (
        <>
          <div className="grid sm:grid-cols-2 gap-2">
            {fields.map((f) => (
              <label key={f.key} className="text-xs space-y-1">
                <span className="text-muted-foreground">{f.label}{f.required ? " *" : ""}</span>
                <select className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={map[f.key] || ""} onChange={(e) => setMap({ ...map, [f.key]: e.target.value })}>
                  <option value="">Niet gebruiken</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>

          {missingRequired.length > 0 ? (
            <p className="text-sm text-destructive">Vereiste velden ontbreken: {missingRequired.map((f) => f.label).join(", ")}</p>
          ) : (
            <>
              <p className="text-sm">
                {rows.length} regels · <b>{ready.length} klaar</b> · {toCheck.length} handmatig controleren · {unmatched.length} geen klant · {invalid.length} ongeldig
              </p>
              <div className="max-h-80 overflow-auto rounded-xl border border-border divide-y divide-border">
                {rows.slice(0, 50).map((r) => {
                  const cid = customerFor(r);
                  const cName = customers.find((c) => c.id === cid)?.name;
                  return (
                    <div key={r.idx} className="p-2 text-xs space-y-1">
                      <p className="font-medium">Regel {r.idx + 2}: {get(r.raw, "customer_name") || "?"} · {r.date || get(r.raw, "date") || "-"} · {get(r.raw, "service_name") || "-"}</p>
                      {r.error ? <p className="text-destructive">{r.error}</p>
                        : r.match.status === "matched" ? <p className="text-muted-foreground">Gekoppeld aan {cName} (via {r.match.via === "email" ? "e-mail" : "telefoon"})</p>
                        : (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-warning">{r.match.reason}. Kies de juiste klant:</span>
                            <select className="rounded-lg border border-border bg-background px-2 py-1" value={manual[r.idx] || ""} onChange={(e) => setManual({ ...manual, [r.idx]: e.target.value })}>
                              <option value="">Niet importeren</option>
                              {(r.match.status === "check" ? customers.filter((c) => (r.match as { candidates: string[] }).candidates.includes(c.id)) : customers).map((c) => (
                                <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ""}</option>
                              ))}
                            </select>
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                Ik heb de klantkoppelingen gecontroleerd. Importeer {ready.length} {label} als historische, alleen-lezen gegevens.
              </label>
              <Button onClick={runImport} disabled={busy || !confirmed || ready.length === 0}>
                {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Importeren
              </Button>
            </>
          )}
        </>
      )}

      {result && (
        <div className="rounded-xl bg-secondary/50 p-3 text-sm space-y-2">
          <p>{result.inserted} {label} toegevoegd · {result.skipped} al eerder geïmporteerd · {result.rejected} afgewezen</p>
          {result.inserted === 0 && <p className="text-xs text-muted-foreground">Er is niets nieuws toegevoegd. Eerdere imports kun je hieronder ongedaan maken.</p>}
        </div>
      )}
      {batches.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Eerdere historische imports</p>
          {batches.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 rounded-xl border border-border p-3">
              <p className="text-sm">
                {b.kind === "appointment" ? "Afspraken" : "Verslagen"} · {new Date(b.importedAt).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}
                <span className="block text-xs text-muted-foreground">{b.count} records</span>
              </p>
              <Button size="sm" variant="outline" onClick={() => setUndoTarget(b)}><Undo2 className="h-4 w-4 mr-1" /> Import ongedaan maken</Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!undoTarget}
        onOpenChange={(o) => !o && setUndoTarget(null)}
        title="Import ongedaan maken?"
        description={undoTarget ? `De import van ${new Date(undoTarget.importedAt).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })} (${undoTarget.kind === "appointment" ? "afspraken" : "verslagen"}) wordt teruggedraaid. ${undoTarget.count} records worden verwijderd. Klanten en andere dossiergegevens blijven staan.` : ""}
        confirmLabel={undoTarget ? `${undoTarget.count} records verwijderen` : "Verwijderen"}
        destructive
        onConfirm={async () => { if (undoTarget) await undo(undoTarget); }}
      />
    </div>
  );
}
