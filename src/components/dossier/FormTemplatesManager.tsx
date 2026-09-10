import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, FileText, Check } from "lucide-react";
import { toast } from "sonner";
import { useDossierAccess } from "@/hooks/useDossierAccess";

type FieldType = "text" | "textarea" | "number" | "date" | "select" | "checkbox" | "radio";

interface BuilderField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  /** Optional attention rule: "checked", "filled" or one of the options. */
  alert_when?: string;
  /** Optional wording shown to the treatment room instead of the raw answer. */
  alert_label?: string;
}

interface RequirementRow {
  id: string;
  service_id: string;
  template_id: string;
  validity_mode: string;
  validity_months: number | null;
  reissue_on_new_version: boolean;
  auto_send: boolean;
  reminder_hours: number;
}

const VALIDITY_MODES: { value: string; label: string }[] = [
  { value: "once", label: "Eenmalig invullen" },
  { value: "every_appointment", label: "Bij iedere afspraak" },
  { value: "months", label: "Opnieuw na aantal maanden" },
  { value: "new_version", label: "Opnieuw bij nieuwe versie" },
];

const REMINDER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Geen herinnering" },
  { value: 24, label: "24 uur vooraf" },
  { value: 48, label: "48 uur vooraf" },
];

interface TemplateRow {
  id: string;
  title: string;
  kind: string;
  is_active: boolean;
  require_signature: boolean;
  consent_scope: string | null;
  current_version: number;
  draft_schema: { fields?: BuilderField[]; intro?: string } | null;
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Korte tekst" },
  { value: "textarea", label: "Lange tekst" },
  { value: "number", label: "Getal" },
  { value: "date", label: "Datum" },
  { value: "select", label: "Keuzelijst" },
  { value: "radio", label: "Keuzerondjes" },
  { value: "checkbox", label: "Akkoordvinkje" },
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

export function FormTemplatesManager() {
  const { canManageTemplates, loading: accessLoading } = useDossierAccess();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [links, setLinks] = useState<RequirementRow[]>([]);

  const load = async () => {
    setLoading(true);
    const [t, s, l] = await Promise.all([
      supabase.from("form_templates").select("id, title, kind, is_active, require_signature, consent_scope, current_version, draft_schema").order("created_at", { ascending: true }),
      supabase.from("services").select("id, name").order("name"),
      supabase
        .from("service_form_requirements")
        .select("id, service_id, template_id, validity_mode, validity_months, reissue_on_new_version, auto_send, reminder_hours"),
    ]);
    setTemplates((t.data as unknown as TemplateRow[]) || []);
    setServices((s.data as { id: string; name: string }[]) || []);
    setLinks((l.data as unknown as RequirementRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!accessLoading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessLoading]);

  const openTemplate = useMemo(() => templates.find((t) => t.id === openId) || null, [templates, openId]);
  const draftFields: BuilderField[] = openTemplate?.draft_schema?.fields ?? [];

  if (accessLoading) return null;
  if (!canManageTemplates) return null;

  const createTemplate = async () => {
    const title = newTitle.trim();
    if (!title) return toast.error("Geef het formulier een naam");
    const { data: userData } = await supabase.auth.getUser();
    const { data: tenant } = await supabase.rpc("current_tenant_id");
    if (!tenant || !userData?.user) return toast.error("Geen toegang");
    const { error } = await supabase.from("form_templates").insert({
      user_id: tenant as string,
      title,
      kind: "intake",
      draft_schema: { fields: [] },
    });
    if (error) return toast.error("Aanmaken mislukt");
    setNewTitle("");
    toast.success("Formulier aangemaakt");
    load();
  };

  const saveDraft = async (
    id: string,
    fields: BuilderField[],
    extra: Partial<Pick<TemplateRow, "title" | "is_active" | "require_signature" | "consent_scope">> = {},
    intro?: string,
  ) => {
    const current = templates.find((t) => t.id === id);
    const nextIntro = intro !== undefined ? intro : current?.draft_schema?.intro ?? "";
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, ...extra, draft_schema: { fields, intro: nextIntro } } : t)));
    const { error } = await supabase
      .from("form_templates")
      .update({ draft_schema: { fields, intro: nextIntro } as never, ...extra })
      .eq("id", id);
    if (error) toast.error("Opslaan mislukt");
  };

  const publish = async (t: TemplateRow) => {
    const fields = t.draft_schema?.fields ?? [];
    if (fields.length === 0) return toast.error("Voeg eerst minimaal één vraag toe");
    const { data: tenant } = await supabase.rpc("current_tenant_id");
    if (!tenant) return toast.error("Geen toegang");
    const { data: latest } = await supabase
      .from("form_template_versions")
      .select("version")
      .eq("template_id", t.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = Math.max(latest?.version ?? 0, t.current_version || 0) + 1;
    const { error } = await supabase.from("form_template_versions").insert({
      user_id: tenant as string,
      template_id: t.id,
      version: nextVersion,
      title: t.title,
      kind: t.kind,
      require_signature: t.require_signature,
      schema: { fields, intro: t.draft_schema?.intro ?? "" } as never,
    });
    if (error) return toast.error("Publiceren mislukt");
    const { error: updErr } = await supabase.from("form_templates").update({ current_version: nextVersion }).eq("id", t.id);
    if (updErr) return toast.error("Versie opgeslagen, maar activeren mislukt");
    toast.success(`Versie ${nextVersion} gepubliceerd`);
    load();
  };

  const removeTemplate = async (id: string) => {
    const { error } = await supabase.from("form_templates").delete().eq("id", id);
    if (error) return toast.error("Verwijderen mislukt. Dit formulier is al gebruikt.");
    toast.success("Formulier verwijderd");
    if (openId === id) setOpenId(null);
    load();
  };

  const toggleServiceLink = async (templateId: string, serviceId: string) => {
    const existing = links.find((l) => l.template_id === templateId && l.service_id === serviceId);
    if (existing) {
      await supabase.from("service_form_requirements").delete().eq("id", existing.id);
    } else {
      const { data: tenant } = await supabase.rpc("current_tenant_id");
      if (!tenant) return;
      await supabase.from("service_form_requirements").insert({ user_id: tenant as string, template_id: templateId, service_id: serviceId });
    }
    load();
  };

  const updateRequirement = async (id: string, patch: Partial<RequirementRow>) => {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const { error } = await supabase.from("service_form_requirements").update(patch).eq("id", id);
    if (error) toast.error("Opslaan mislukt");
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> Klantformulieren
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Maak intake- en toestemmingsformulieren die je klant op de telefoon invult.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <Input placeholder="Naam van het formulier" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
        <Button onClick={createTemplate}>
          <Plus className="h-4 w-4 mr-1" /> Nieuw
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Laden...</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nog geen formulieren.</p>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-border">
              <div className="flex items-center justify-between gap-3 p-3">
                <button className="text-left flex-1" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                  <p className="text-sm font-medium text-foreground">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.current_version ? `Versie ${t.current_version} actief` : "Nog niet gepubliceerd"}
                    {t.require_signature ? " · handtekening vereist" : ""}
                  </p>
                </button>
                <Button variant="ghost" size="icon" onClick={() => removeTemplate(t.id)} aria-label="Verwijderen">
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>

              {openId === t.id && (
                <div className="border-t border-border p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`sig-${t.id}`} className="text-sm">Handtekening vereist</Label>
                    <Switch
                      id={`sig-${t.id}`}
                      checked={t.require_signature}
                      onCheckedChange={(v) => saveDraft(t.id, draftFields, { require_signature: v })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor={`consent-${t.id}`} className="text-sm">Legt toestemming voor foto's vast</Label>
                      <p className="text-xs text-muted-foreground">
                        Bij ondertekening wordt toestemming voor eigen kanalen vastgelegd in het dossier.
                      </p>
                    </div>
                    <Switch
                      id={`consent-${t.id}`}
                      checked={t.consent_scope === "marketing_general"}
                      onCheckedChange={(v) => saveDraft(t.id, draftFields, { consent_scope: v ? "marketing_general" : null })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`intro-${t.id}`} className="text-sm">Toelichting voor de klant (optioneel)</Label>
                    <Textarea
                      id={`intro-${t.id}`}
                      rows={3}
                      placeholder="Bijvoorbeeld: Ik verklaar dat ik bovenstaande vragen naar waarheid heb ingevuld."
                      defaultValue={t.draft_schema?.intro ?? ""}
                      onBlur={(e) => saveDraft(t.id, draftFields, {}, e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    {draftFields.map((f, i) => {
                      const alertCapable = f.type === "checkbox" || f.type === "select" || f.type === "radio";
                      const alertOn = Boolean(f.alert_when);
                      const defaultRule = f.type === "checkbox" ? "checked" : (f.options ?? [])[0] ?? "";
                      return (
                      <div key={i} className="space-y-2 rounded-lg border border-border p-2">
                        <div className="flex flex-wrap items-center gap-2">
                        <Input
                          className="flex-1 min-w-[160px]"
                          value={f.label}
                          placeholder="Vraag"
                          onChange={(e) => {
                            const next = [...draftFields];
                            next[i] = { ...f, label: e.target.value, key: slugKey(e.target.value, i) };
                            saveDraft(t.id, next);
                          }}
                        />
                        <select
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          value={f.type}
                          onChange={(e) => {
                            const next = [...draftFields];
                            const type = e.target.value as FieldType;
                            const keepAlert = type === "checkbox" || type === "select" || type === "radio";
                            next[i] = {
                              ...f,
                              type,
                              options: type === "select" || type === "radio" ? f.options ?? ["Ja", "Nee"] : undefined,
                              alert_when: keepAlert ? f.alert_when : undefined,
                              alert_label: keepAlert ? f.alert_label : undefined,
                            };
                            saveDraft(t.id, next);
                          }}
                        >
                          {FIELD_TYPES.map((ft) => (
                            <option key={ft.value} value={ft.value}>{ft.label}</option>
                          ))}
                        </select>
                        {(f.type === "select" || f.type === "radio") && (
                          <Input
                            className="min-w-[140px] flex-1"
                            value={(f.options ?? []).join(", ")}
                            placeholder="Opties, komma gescheiden"
                            onChange={(e) => {
                              const next = [...draftFields];
                              next[i] = { ...f, options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) };
                              saveDraft(t.id, next);
                            }}
                          />
                        )}
                        <label className="flex items-center gap-1 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={f.required}
                            onChange={(e) => {
                              const next = [...draftFields];
                              next[i] = { ...f, required: e.target.checked };
                              saveDraft(t.id, next);
                            }}
                          />
                          Verplicht
                        </label>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Vraag verwijderen"
                          onClick={() => saveDraft(t.id, draftFields.filter((_, idx) => idx !== i))}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        </div>

                        {alertCapable && (
                          <div className="space-y-2 border-t border-border pt-2">
                            <div className="flex items-center justify-between gap-2">
                              <Label htmlFor={`alert-${t.id}-${i}`} className="text-xs text-muted-foreground">
                                Aandachtspunt maken bij bepaald antwoord
                              </Label>
                              <Switch
                                id={`alert-${t.id}-${i}`}
                                checked={alertOn}
                                onCheckedChange={(v) => {
                                  const next = [...draftFields];
                                  next[i] = v
                                    ? { ...f, alert_when: defaultRule || undefined }
                                    : { ...f, alert_when: undefined, alert_label: undefined };
                                  saveDraft(t.id, next);
                                }}
                              />
                            </div>
                            {alertOn && (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs text-muted-foreground">Wanneer antwoord is</span>
                                {f.type === "checkbox" ? (
                                  <span className="text-xs text-foreground">aangevinkt</span>
                                ) : (
                                  <select
                                    className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                                    aria-label="Wanneer antwoord is"
                                    value={f.alert_when ?? ""}
                                    onChange={(e) => {
                                      const next = [...draftFields];
                                      next[i] = { ...f, alert_when: e.target.value || undefined };
                                      saveDraft(t.id, next);
                                    }}
                                  >
                                    {(f.options ?? []).map((o) => (
                                      <option key={o} value={o}>{o}</option>
                                    ))}
                                  </select>
                                )}
                                <Input
                                  className="min-w-[160px] flex-1 text-xs"
                                  placeholder="Label voor behandelaar (optioneel)"
                                  defaultValue={f.alert_label ?? ""}
                                  onBlur={(e) => {
                                    const value = e.target.value.trim();
                                    const next = [...draftFields];
                                    next[i] = { ...f, alert_label: value || undefined };
                                    saveDraft(t.id, next);
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      );
                    })}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        saveDraft(t.id, [...draftFields, { key: slugKey("", draftFields.length), label: "", type: "text", required: false }])
                      }
                    >
                      <Plus className="h-4 w-4 mr-1" /> Vraag toevoegen
                    </Button>
                  </div>

                  {services.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm">Hoort bij behandeling</Label>
                      <div className="flex flex-wrap gap-2">
                        {services.map((s) => {
                          const active = links.some((l) => l.template_id === t.id && l.service_id === s.id);
                          return (
                            <button
                              key={s.id}
                              onClick={() => toggleServiceLink(t.id, s.id)}
                              className={`rounded-full border px-3 py-1 text-xs ${active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                            >
                              {active && <Check className="inline h-3 w-3 mr-1" />}
                              {s.name}
                            </button>
                          );
                        })}
                      </div>

                      {links
                        .filter((l) => l.template_id === t.id)
                        .map((l) => {
                          const service = services.find((s) => s.id === l.service_id);
                          return (
                            <div key={l.id} className="space-y-2 rounded-xl border border-border p-3">
                              <p className="text-xs font-medium text-foreground">{service?.name || "Behandeling"}</p>
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                                  aria-label="Wanneer opnieuw invullen"
                                  value={l.validity_mode}
                                  onChange={(e) => updateRequirement(l.id, { validity_mode: e.target.value })}
                                >
                                  {VALIDITY_MODES.map((m) => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                  ))}
                                </select>
                                {l.validity_mode === "months" && (
                                  <Input
                                    type="number"
                                    min={1}
                                    max={60}
                                    className="w-24"
                                    aria-label="Aantal maanden geldig"
                                    value={l.validity_months ?? 12}
                                    onChange={(e) => updateRequirement(l.id, { validity_months: Math.max(1, Number(e.target.value) || 12) })}
                                  />
                                )}
                                <select
                                  className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                                  aria-label="Herinnering"
                                  value={l.reminder_hours}
                                  onChange={(e) => updateRequirement(l.id, { reminder_hours: Number(e.target.value) })}
                                >
                                  {REMINDER_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                </select>
                                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Switch
                                    checked={l.auto_send}
                                    onCheckedChange={(v) => updateRequirement(l.id, { auto_send: v })}
                                  />
                                  Automatisch versturen bij boeking
                                </label>
                                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <input
                                    type="checkbox"
                                    checked={l.reissue_on_new_version}
                                    onChange={(e) => updateRequirement(l.id, { reissue_on_new_version: e.target.checked })}
                                  />
                                  Opnieuw bij nieuwe versie
                                </label>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}

                  <Button onClick={() => publish(t)}>Publiceer versie</Button>
                  <p className="text-xs text-muted-foreground">
                    Een gepubliceerde versie blijft ongewijzigd bewaard. Wijzigingen komen in een nieuwe versie.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
