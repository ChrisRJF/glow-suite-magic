import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardList, Lock } from "lucide-react";
import { toast } from "sonner";
import { useDossierAccess } from "@/hooks/useDossierAccess";
import type { TreatmentField } from "./TreatmentTemplatesManager";
import { DocumentExportDialog } from "./DocumentExportDialog";

interface RecordRow {
  id: string;
  status: string;
  values: Record<string, unknown>;
  template_snapshot: { fields?: TreatmentField[] } | null;
  template_version: number;
  completed_at: string | null;
  locked_at: string | null;
}

interface Props {
  customerId: string;
  appointmentId: string;
  serviceId?: string | null;
  onChanged?: () => void;
}

export function TreatmentRecordPanel({ customerId, appointmentId, serviceId, onChanged }: Props) {
  const { canViewContent, loading: accessLoading } = useDossierAccess();
  const [template, setTemplate] = useState<{ id: string; title: string; schema: { fields?: TreatmentField[] } | null } | null>(null);
  const [record, setRecord] = useState<RecordRow | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: tpl }, { data: rec }] = await Promise.all([
      serviceId
        ? supabase
            .from("treatment_record_templates")
            .select("id, title, schema")
            .eq("service_id", serviceId)
            .eq("is_active", true)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("treatment_records")
        .select("id, status, values, template_snapshot, template_version, completed_at, locked_at")
        .eq("appointment_id", appointmentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    setTemplate((tpl as unknown as { id: string; title: string; schema: { fields?: TreatmentField[] } | null }) || null);
    const row = (rec as unknown as RecordRow) || null;
    setRecord(row);
    setValues((row?.values as Record<string, unknown>) || {});
  };

  useEffect(() => {
    if (!accessLoading && canViewContent) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessLoading, canViewContent, appointmentId, serviceId]);

  if (accessLoading || !canViewContent) return null;
  if (!template && !record) return null;

  const fields: TreatmentField[] = record?.template_snapshot?.fields ?? template?.schema?.fields ?? [];
  const locked = Boolean(record?.locked_at);

  const submit = async (action: "save" | "complete") => {
    if (action === "complete") {
      const missing = fields.filter((f) => f.required && f.type !== "info_text" && !values[f.key]);
      if (missing.length > 0) return toast.error(`Vul eerst in: ${missing.map((f) => f.label).join(", ")}`);
      if (!confirm("Na afronden kan dit verslag niet meer worden gewijzigd. Doorgaan?")) return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("treatment-records", {
      body: {
        action,
        record_id: record?.id ?? null,
        customer_id: customerId,
        appointment_id: appointmentId,
        template_id: template?.id ?? null,
        values,
      },
    });
    setBusy(false);
    if (error || (data as { error?: string })?.error) return toast.error("Opslaan mislukt");
    toast.success(action === "complete" ? "Verslag afgerond" : "Concept opgeslagen");
    load();
    onChanged?.();
  };

  const setValue = (key: string, value: unknown) => setValues((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" /> Behandelverslag
        </h4>
        <div className="flex items-center gap-1">
          {locked && record && (
            <DocumentExportDialog
              customerId={customerId}
              appointmentId={appointmentId}
              scope="treatment_record"
              sourceId={record.id}
              triggerLabel="PDF"
            />
          )}
          <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
            {open ? "Verberg" : locked ? "Bekijk" : record ? "Verder invullen" : "Invullen"}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {locked
          ? `Afgerond op ${new Date(record!.completed_at || record!.locked_at!).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}`
          : record
            ? "Concept opgeslagen, nog niet afgerond."
            : "Nog niet ingevuld."}
      </p>

      {open && (
        <div className="space-y-3 rounded-xl border border-border p-3">
          {locked && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" /> Dit verslag is afgerond en kan niet meer worden gewijzigd.
            </p>
          )}
          {fields.map((f) => {
            const value = values[f.key];
            if (f.type === "info_text") {
              return <p key={f.key} className="text-sm text-muted-foreground">{f.label}</p>;
            }
            return (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-sm">
                  {f.label}
                  {f.required ? " *" : ""}
                </Label>
                {f.type === "long_text" ? (
                  <Textarea rows={3} disabled={locked} value={String(value ?? "")} onChange={(e) => setValue(f.key, e.target.value)} />
                ) : f.type === "yes_no" ? (
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    disabled={locked}
                    value={String(value ?? "")}
                    onChange={(e) => setValue(f.key, e.target.value)}
                  >
                    <option value="">Kies</option>
                    <option value="Ja">Ja</option>
                    <option value="Nee">Nee</option>
                  </select>
                ) : f.type === "single_choice" ? (
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    disabled={locked}
                    value={String(value ?? "")}
                    onChange={(e) => setValue(f.key, e.target.value)}
                  >
                    <option value="">Kies</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : f.type === "multi_choice" ? (
                  <div className="flex flex-wrap gap-2">
                    {(f.options ?? []).map((o) => {
                      const list = Array.isArray(value) ? (value as string[]) : [];
                      const active = list.includes(o);
                      return (
                        <button
                          key={o}
                          disabled={locked}
                          onClick={() => setValue(f.key, active ? list.filter((x) => x !== o) : [...list, o])}
                          className={`rounded-full border px-3 py-1 text-xs ${active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                        >
                          {o}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <Input
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                    disabled={locked}
                    value={String(value ?? "")}
                    onChange={(e) => setValue(f.key, e.target.value)}
                  />
                )}
              </div>
            );
          })}

          {!locked && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => submit("save")}>
                Concept opslaan
              </Button>
              <Button size="sm" disabled={busy} onClick={() => submit("complete")}>
                Verslag afronden
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
