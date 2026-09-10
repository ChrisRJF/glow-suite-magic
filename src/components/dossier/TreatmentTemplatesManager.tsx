import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { useDossierAccess } from "@/hooks/useDossierAccess";

export type TreatmentFieldType =
  | "short_text"
  | "long_text"
  | "yes_no"
  | "single_choice"
  | "multi_choice"
  | "number"
  | "date"
  | "info_text";

export interface TreatmentField {
  key: string;
  label: string;
  type: TreatmentFieldType;
  required: boolean;
  options?: string[];
}

interface TemplateRow {
  id: string;
  title: string;
  service_id: string | null;
  is_active: boolean;
  version: number;
  schema: { fields?: TreatmentField[] } | null;
}

export const TREATMENT_FIELD_TYPES: { value: TreatmentFieldType; label: string }[] = [
  { value: "short_text", label: "Korte tekst" },
  { value: "long_text", label: "Lange tekst" },
  { value: "yes_no", label: "Ja / nee" },
  { value: "single_choice", label: "Keuze" },
  { value: "multi_choice", label: "Meerdere keuzes" },
  { value: "number", label: "Getal" },
  { value: "date", label: "Datum" },
  { value: "info_text", label: "Toelichting" },
];

function slugKey(label: string, index: number): string {
  const base = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base || `veld_${index + 1}`;
}

export function TreatmentTemplatesManager() {
  const { canManageTemplates, loading: accessLoading } = useDossierAccess();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [t, s] = await Promise.all([
      supabase.from("treatment_record_templates").select("id, title, service_id, is_active, version, schema").order("created_at"),
      supabase.from("services").select("id, name").order("name"),
    ]);
    setTemplates((t.data as unknown as TemplateRow[]) || []);
    setServices((s.data as { id: string; name: string }[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!accessLoading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessLoading]);

  const openTemplate = useMemo(() => templates.find((t) => t.id === openId) || null, [templates, openId]);
  const fields: TreatmentField[] = openTemplate?.schema?.fields ?? [];

  if (accessLoading || !canManageTemplates) return null;

  const create = async () => {
    const title = newTitle.trim();
    if (!title) return toast.error("Geef het verslag een naam");
    const { data: tenant } = await supabase.rpc("current_tenant_id");
    const { data: demo } = await supabase.rpc("current_tenant_is_demo");
    if (!tenant) return toast.error("Geen toegang");
    const { error } = await supabase.from("treatment_record_templates").insert({
      user_id: tenant as string,
      is_demo: demo === true,
      title,
      schema: { fields: [] } as never,
    });
    if (error) return toast.error("Aanmaken mislukt");
    setNewTitle("");
    toast.success("Behandelverslag aangemaakt");
    load();
  };

  const save = async (
    id: string,
    nextFields: TreatmentField[],
    extra: Partial<Pick<TemplateRow, "title" | "is_active" | "service_id">> = {},
  ) => {
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, ...extra, schema: { fields: nextFields } } : t)));
    const { error } = await supabase
      .from("treatment_record_templates")
      .update({ ...extra, schema: { fields: nextFields } as never })
      .eq("id", id);
    if (error) toast.error("Opslaan mislukt");
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("treatment_record_templates").delete().eq("id", id);
    if (error) return toast.error("Verwijderen mislukt. Dit verslag is al gebruikt.");
    if (openId === id) setOpenId(null);
    load();
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
      <div>
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" /> Behandelverslagen
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Bepaal wat de behandelaar na een behandeling vastlegt.
        </p>
      </div>

      <div className="flex gap-2">
        <Input placeholder="Naam van het verslag" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
        <Button onClick={create}>
          <Plus className="h-4 w-4 mr-1" /> Nieuw
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Laden...</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nog geen behandelverslagen.</p>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-border">
              <div className="flex items-center justify-between gap-3 p-3">
                <button className="text-left flex-1" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                  <p className="text-sm font-medium text-foreground">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {services.find((s) => s.id === t.service_id)?.name || "Nog niet gekoppeld"}
                    {t.is_active ? "" : " · niet actief"}
                  </p>
                </button>
                <Button variant="ghost" size="icon" onClick={() => remove(t.id)} aria-label="Verwijderen">
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>

              {openId === t.id && (
                <div className="border-t border-border p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`act-${t.id}`} className="text-sm">Actief</Label>
                    <Switch id={`act-${t.id}`} checked={t.is_active} onCheckedChange={(v) => save(t.id, fields, { is_active: v })} />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-sm">Hoort bij behandeling</Label>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={t.service_id ?? ""}
                      onChange={(e) => save(t.id, fields, { service_id: e.target.value || null })}
                    >
                      <option value="">Geen behandeling</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    {fields.map((f, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                        <Input
                          className="flex-1 min-w-[160px]"
                          value={f.label}
                          placeholder="Onderdeel"
                          onChange={(e) => {
                            const next = [...fields];
                            next[i] = { ...f, label: e.target.value, key: slugKey(e.target.value, i) };
                            save(t.id, next);
                          }}
                        />
                        <select
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          value={f.type}
                          onChange={(e) => {
                            const next = [...fields];
                            const type = e.target.value as TreatmentFieldType;
                            next[i] = {
                              ...f,
                              type,
                              options: type === "single_choice" || type === "multi_choice" ? f.options ?? ["Ja", "Nee"] : undefined,
                            };
                            save(t.id, next);
                          }}
                        >
                          {TREATMENT_FIELD_TYPES.map((ft) => (
                            <option key={ft.value} value={ft.value}>{ft.label}</option>
                          ))}
                        </select>
                        {(f.type === "single_choice" || f.type === "multi_choice") && (
                          <Input
                            className="min-w-[140px] flex-1"
                            value={(f.options ?? []).join(", ")}
                            placeholder="Opties, komma gescheiden"
                            onChange={(e) => {
                              const next = [...fields];
                              next[i] = { ...f, options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) };
                              save(t.id, next);
                            }}
                          />
                        )}
                        {f.type !== "info_text" && (
                          <label className="flex items-center gap-1 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={f.required}
                              onChange={(e) => {
                                const next = [...fields];
                                next[i] = { ...f, required: e.target.checked };
                                save(t.id, next);
                              }}
                            />
                            Verplicht
                          </label>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Onderdeel verwijderen"
                          onClick={() => save(t.id, fields.filter((_, idx) => idx !== i))}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => save(t.id, [...fields, { key: slugKey("", fields.length), label: "", type: "short_text", required: false }])}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Onderdeel toevoegen
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
