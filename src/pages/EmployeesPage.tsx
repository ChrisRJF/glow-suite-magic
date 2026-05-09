import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useEmployees, useEmployeeAvailabilityExceptions } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { supabase } from "@/integrations/supabase/client";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { useState, useRef, useMemo } from "react";
import { Plus, Trash2, Camera, X, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { STATUS_OPTIONS, statusMeta, parseBreaks, type EmployeeBreak, type EmployeeStatus } from "@/lib/employeeAvailability";

const DAY_LABELS = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
const DEFAULT_COLORS = ["#7B61FF", "#FF6B9D", "#4ECDC4", "#FFB347", "#5B8DEF", "#F87171", "#A78BFA", "#34D399"];

interface EmployeeForm {
  id?: string;
  name: string;
  role: string;
  color: string;
  photo_url: string | null;
  email: string;
  phone: string;
  working_days: number[];
  breaks: EmployeeBreak[];
  status: EmployeeStatus;
  status_note: string;
  status_from: string;
  status_until: string;
  is_active: boolean;
}

const emptyForm = (): EmployeeForm => ({
  name: "",
  role: "",
  color: DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)],
  photo_url: null,
  email: "",
  phone: "",
  working_days: [1, 2, 3, 4, 5],
  breaks: [{ start: "12:00", end: "12:30", label: "Pauze" }],
  status: "werkzaam",
  status_note: "",
  status_from: "",
  status_until: "",
  is_active: true,
});

const EXCEPTION_TYPES: { value: string; label: string }[] = [
  { value: "sick", label: "Ziek" },
  { value: "vacation", label: "Vakantie" },
  { value: "absent", label: "Afwezig" },
  { value: "unavailable", label: "Niet beschikbaar (tijdvak)" },
  { value: "custom_hours", label: "Aangepaste uren" },
];

export default function EmployeesPage() {
  const { user } = useAuth();
  const { isDemoMode } = useDemoMode();
  const { data: employees, refetch, loading } = useEmployees();
  const { data: exceptions, refetch: refetchExceptions } = useEmployeeAvailabilityExceptions();
  const { insert, update, remove } = useCrud("employees");
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<"profiel" | "werkdagen" | "pauzes" | "afwezigheid" | "uitzonderingen">("profiel");
  const [form, setForm] = useState<EmployeeForm>(emptyForm());
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New exception form (only used when editing existing employee)
  const [newEx, setNewEx] = useState({
    type: "sick" as string,
    label: "",
    start_date: "",
    end_date: "",
    start_time: "",
    end_time: "",
    note: "",
  });

  const employeeExceptions = useMemo(
    () => (form.id ? (exceptions || []).filter((e: any) => e.employee_id === form.id) : []),
    [exceptions, form.id]
  );

  const openNew = () => {
    setForm(emptyForm());
    setTab("profiel");
    setShowForm(true);
  };

  const openEdit = (e: any) => {
    setForm({
      id: e.id,
      name: e.name || "",
      role: e.role || "",
      color: e.color || "#7B61FF",
      photo_url: e.photo_url || null,
      email: e.email || "",
      phone: e.phone || "",
      working_days: Array.isArray(e.working_days) && e.working_days.length ? e.working_days : [1, 2, 3, 4, 5],
      breaks: parseBreaks(e.breaks, e.break_start, e.break_end),
      status: (e.status as EmployeeStatus) || "werkzaam",
      status_note: e.status_note || "",
      status_from: e.status_from || "",
      status_until: e.status_until || "",
      is_active: e.is_active !== false,
    });
    setTab("profiel");
    setShowForm(true);
  };

  const handlePhotoUpload = async (file: File) => {
    if (!user) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Alleen JPG, PNG of WEBP toegestaan");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Foto is groter dan 2MB");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("employee-photos")
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("employee-photos").getPublicUrl(path);
      setForm((f) => ({ ...f, photo_url: data.publicUrl }));
      toast.success("Foto geüpload");
    } catch (err: any) {
      console.error("upload error", err);
      toast.error("Upload mislukt — je kunt het profiel toch opslaan");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Naam is verplicht");
      return;
    }
    // Keep legacy break_start/break_end mirroring the first break for backwards compat.
    const firstBreak = form.breaks[0];
    const payload = {
      name: form.name.trim(),
      role: form.role.trim(),
      color: form.color,
      photo_url: form.photo_url,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      working_days: form.working_days.length ? form.working_days : [1, 2, 3, 4, 5],
      breaks: form.breaks.filter((b) => b.start && b.end),
      break_start: firstBreak?.start || null,
      break_end: firstBreak?.end || null,
      status: form.status,
      status_note: form.status_note.trim() || null,
      status_from: form.status_from || null,
      status_until: form.status_until || null,
      is_active: form.is_active,
    };
    try {
      if (form.id) {
        await update(form.id, payload);
        toast.success("Medewerker bijgewerkt");
      } else {
        await insert({ ...payload, sort_order: (employees?.length || 0) });
        toast.success("Medewerker toegevoegd");
      }
      setShowForm(false);
      refetch();
    } catch (err: any) {
      console.error(err);
      toast.error("Opslaan mislukt");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Medewerker verwijderen?")) return;
    try {
      await remove(id);
      toast.success("Verwijderd");
      refetch();
    } catch {
      toast.error("Verwijderen mislukt");
    }
  };

  const toggleDay = (day: number) => {
    setForm((f) => ({
      ...f,
      working_days: f.working_days.includes(day) ? f.working_days.filter((d) => d !== day) : [...f.working_days, day].sort(),
    }));
  };

  const addBreak = () => {
    setForm((f) => ({ ...f, breaks: [...f.breaks, { start: "13:00", end: "13:15", label: "" }] }));
  };
  const updateBreak = (idx: number, patch: Partial<EmployeeBreak>) => {
    setForm((f) => ({ ...f, breaks: f.breaks.map((b, i) => (i === idx ? { ...b, ...patch } : b)) }));
  };
  const removeBreak = (idx: number) => {
    setForm((f) => ({ ...f, breaks: f.breaks.filter((_, i) => i !== idx) }));
  };
  const toggleBreakDay = (idx: number, day: number) => {
    setForm((f) => ({
      ...f,
      breaks: f.breaks.map((b, i) => {
        if (i !== idx) return b;
        const days = b.days || [];
        return { ...b, days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort() };
      }),
    }));
  };

  const handleAddException = async () => {
    if (!form.id || !user) return;
    if (!newEx.start_date) { toast.error("Kies een startdatum"); return; }
    try {
      const { error } = await supabase.from("employee_availability_exceptions" as any).insert({
        user_id: user.id,
        employee_id: form.id,
        type: newEx.type,
        label: newEx.label || null,
        start_date: newEx.start_date,
        end_date: newEx.end_date || null,
        start_time: newEx.start_time || null,
        end_time: newEx.end_time || null,
        note: newEx.note || null,
        is_demo: !!isDemoMode,
      });
      if (error) throw error;
      toast.success("Uitzondering toegevoegd");
      setNewEx({ type: "sick", label: "", start_date: "", end_date: "", start_time: "", end_time: "", note: "" });
      refetchExceptions();
    } catch (err: any) {
      console.error(err);
      toast.error("Toevoegen mislukt");
    }
  };

  const handleDeleteException = async (id: string) => {
    try {
      const { error } = await supabase.from("employee_availability_exceptions" as any).delete().eq("id", id);
      if (error) throw error;
      refetchExceptions();
    } catch {
      toast.error("Verwijderen mislukt");
    }
  };

  return (
    <AppLayout
      title="Medewerkers"
      subtitle="Beheer team, werkdagen, pauzes en afwezigheid."
      actions={
        <Button onClick={openNew} className="h-11 gap-2">
          <Plus className="h-4 w-4" /> Nieuw
        </Button>
      }
    >
      <div className="max-w-5xl mx-auto w-full max-w-full overflow-x-hidden">
        {loading ? (
          <div className="text-center py-12 text-muted-foreground text-sm">Laden…</div>
        ) : !employees?.length ? (
          <div className="text-center py-12 border border-dashed rounded-2xl bg-card">
            <p className="text-muted-foreground mb-4">Nog geen medewerkers</p>
            <Button onClick={openNew} variant="outline">Eerste medewerker toevoegen</Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {employees.map((e: any) => {
              const meta = statusMeta(e.status);
              const isAbsent = (e.status || "werkzaam") !== "werkzaam";
              return (
                <div
                  key={e.id}
                  className="group flex items-center gap-3 p-3 sm:p-4 rounded-2xl border bg-card hover:shadow-sm transition-shadow min-w-0"
                >
                  <EmployeeAvatar employee={e} size="xl" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-semibold truncate">{e.name}</div>
                      {isAbsent && (
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 border-0", meta.tone)}>
                          {meta.label}
                        </Badge>
                      )}
                    </div>
                    {e.role && <div className="text-xs text-muted-foreground truncate">{e.role}</div>}
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {DAY_LABELS.map((lbl, i) => {
                        const day = i + 1;
                        const active = (e.working_days || []).includes(day);
                        return (
                          <span
                            key={day}
                            className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded font-medium",
                              active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground/50"
                            )}
                          >
                            {lbl}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openEdit(e)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => handleDelete(e.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-background w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-background border-b px-5 py-4 flex items-center justify-between z-10">
              <h2 className="font-semibold truncate pr-2">{form.id ? "Medewerker bewerken" : "Nieuwe medewerker"}</h2>
              <button onClick={() => setShowForm(false)} className="h-9 w-9 rounded-full hover:bg-muted flex items-center justify-center shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
                <div className="overflow-x-auto max-w-full [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
                  <TabsList className="inline-flex w-max">
                    <TabsTrigger value="profiel">Profiel</TabsTrigger>
                    <TabsTrigger value="werkdagen">Werkdagen</TabsTrigger>
                    <TabsTrigger value="pauzes">Pauzes</TabsTrigger>
                    <TabsTrigger value="afwezigheid">Afwezigheid</TabsTrigger>
                    <TabsTrigger value="uitzonderingen" disabled={!form.id}>Uitzonderingen</TabsTrigger>
                  </TabsList>
                </div>

                {/* Profiel */}
                <TabsContent value="profiel" className="space-y-5 pt-4">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <EmployeeAvatar employee={form} size="xl" />
                      {uploading && (
                        <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center">
                          <Loader2 className="h-5 w-5 text-white animate-spin" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 space-y-2 min-w-0">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handlePhotoUpload(file);
                          e.target.value = "";
                        }}
                      />
                      <div className="flex gap-2 flex-wrap">
                        <Button type="button" variant="outline" size="sm" className="h-9 gap-2" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                          <Camera className="h-4 w-4" />
                          {form.photo_url ? "Vervang foto" : "Foto uploaden"}
                        </Button>
                        {form.photo_url && (
                          <Button type="button" variant="ghost" size="sm" className="h-9 text-destructive" onClick={() => setForm((f) => ({ ...f, photo_url: null }))}>
                            Verwijderen
                          </Button>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">JPG/PNG/WEBP · max 2MB</p>
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Kleur</Label>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {DEFAULT_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, color: c }))}
                          className={cn(
                            "h-8 w-8 rounded-full border-2 transition",
                            form.color === c ? "border-foreground scale-110" : "border-transparent"
                          )}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Naam *</Label>
                      <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11" />
                    </div>
                    <div>
                      <Label className="text-xs">Functie</Label>
                      <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Kapper / Stylist" className="h-11" />
                    </div>
                    <div>
                      <Label className="text-xs">E-mail</Label>
                      <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-11" />
                    </div>
                    <div>
                      <Label className="text-xs">Telefoon</Label>
                      <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="h-11" />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                      className="h-4 w-4"
                    />
                    Actief in agenda
                  </label>
                </TabsContent>

                {/* Werkdagen */}
                <TabsContent value="werkdagen" className="pt-4">
                  <Label className="text-xs">Werkdagen</Label>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {DAY_LABELS.map((lbl, i) => {
                      const day = i + 1;
                      const active = form.working_days.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleDay(day)}
                          className={cn(
                            "flex-1 min-w-[40px] h-11 rounded-lg text-xs font-medium border transition",
                            active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-foreground/30"
                          )}
                        >
                          {lbl}
                        </button>
                      );
                    })}
                  </div>
                </TabsContent>

                {/* Pauzes */}
                <TabsContent value="pauzes" className="space-y-3 pt-4">
                  {form.breaks.length === 0 && (
                    <p className="text-xs text-muted-foreground">Nog geen pauzes ingepland.</p>
                  )}
                  {form.breaks.map((b, i) => (
                    <div key={i} className="rounded-xl border p-3 space-y-2 bg-card">
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="Label (bv. Lunch)"
                          value={b.label || ""}
                          onChange={(e) => updateBreak(i, { label: e.target.value })}
                          className="h-9 flex-1 min-w-0"
                        />
                        <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-destructive shrink-0" onClick={() => removeBreak(i)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[11px]">Start</Label>
                          <Input type="time" value={b.start} onChange={(e) => updateBreak(i, { start: e.target.value })} className="h-10" />
                        </div>
                        <div>
                          <Label className="text-[11px]">Eind</Label>
                          <Input type="time" value={b.end} onChange={(e) => updateBreak(i, { end: e.target.value })} className="h-10" />
                        </div>
                      </div>
                      <div>
                        <Label className="text-[11px]">Dagen (leeg = alle werkdagen)</Label>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {DAY_LABELS.map((lbl, di) => {
                            const day = di + 1;
                            const active = (b.days || []).includes(day);
                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() => toggleBreakDay(i, day)}
                                className={cn(
                                  "min-w-[34px] h-8 px-2 rounded-md text-[11px] font-medium border",
                                  active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                                )}
                              >
                                {lbl}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="gap-2" onClick={addBreak}>
                    <Plus className="h-4 w-4" /> Pauze toevoegen
                  </Button>
                </TabsContent>

                {/* Afwezigheid */}
                <TabsContent value="afwezigheid" className="space-y-3 pt-4">
                  <div>
                    <Label className="text-xs">Status</Label>
                    <div className="flex gap-2 flex-wrap mt-2">
                      {STATUS_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setForm({ ...form, status: opt.value })}
                          className={cn(
                            "px-3 h-9 rounded-lg text-xs font-medium border transition",
                            form.status === opt.value ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {form.status !== "werkzaam" && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[11px]">Vanaf</Label>
                          <Input type="date" value={form.status_from} onChange={(e) => setForm({ ...form, status_from: e.target.value })} className="h-10" />
                        </div>
                        <div>
                          <Label className="text-[11px]">Tot en met</Label>
                          <Input type="date" value={form.status_until} onChange={(e) => setForm({ ...form, status_until: e.target.value })} className="h-10" />
                        </div>
                      </div>
                      <div>
                        <Label className="text-[11px]">Notitie (optioneel)</Label>
                        <Input value={form.status_note} onChange={(e) => setForm({ ...form, status_note: e.target.value })} className="h-10" placeholder="bv. griep" />
                      </div>
                    </>
                  )}
                </TabsContent>

                {/* Uitzonderingen */}
                <TabsContent value="uitzonderingen" className="space-y-3 pt-4">
                  {!form.id ? (
                    <p className="text-xs text-muted-foreground">Sla eerst de medewerker op.</p>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {employeeExceptions.length === 0 && (
                          <p className="text-xs text-muted-foreground">Nog geen uitzonderingen.</p>
                        )}
                        {employeeExceptions.map((ex: any) => (
                          <div key={ex.id} className="flex items-start gap-2 p-3 rounded-xl border bg-card">
                            <div className="flex-1 min-w-0 text-xs">
                              <div className="font-medium truncate">
                                {EXCEPTION_TYPES.find((t) => t.value === ex.type)?.label || ex.type}
                                {ex.label ? ` · ${ex.label}` : ""}
                              </div>
                              <div className="text-muted-foreground truncate">
                                {ex.start_date}{ex.end_date && ex.end_date !== ex.start_date ? ` t/m ${ex.end_date}` : ""}
                                {ex.start_time && ex.end_time ? ` · ${String(ex.start_time).slice(0,5)}–${String(ex.end_time).slice(0,5)}` : ""}
                              </div>
                              {ex.note && <div className="text-muted-foreground truncate">{ex.note}</div>}
                            </div>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => handleDeleteException(ex.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>

                      <div className="rounded-xl border p-3 space-y-2 bg-muted/30">
                        <div className="text-xs font-medium">Uitzondering toevoegen</div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="col-span-2">
                            <Label className="text-[11px]">Type</Label>
                            <select
                              value={newEx.type}
                              onChange={(e) => setNewEx({ ...newEx, type: e.target.value })}
                              className="w-full h-10 rounded-md border bg-background px-2 text-sm"
                            >
                              {EXCEPTION_TYPES.map((t) => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label className="text-[11px]">Vanaf</Label>
                            <Input type="date" value={newEx.start_date} onChange={(e) => setNewEx({ ...newEx, start_date: e.target.value })} className="h-10" />
                          </div>
                          <div>
                            <Label className="text-[11px]">Tot en met</Label>
                            <Input type="date" value={newEx.end_date} onChange={(e) => setNewEx({ ...newEx, end_date: e.target.value })} className="h-10" />
                          </div>
                          <div>
                            <Label className="text-[11px]">Start tijd</Label>
                            <Input type="time" value={newEx.start_time} onChange={(e) => setNewEx({ ...newEx, start_time: e.target.value })} className="h-10" />
                          </div>
                          <div>
                            <Label className="text-[11px]">Eind tijd</Label>
                            <Input type="time" value={newEx.end_time} onChange={(e) => setNewEx({ ...newEx, end_time: e.target.value })} className="h-10" />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-[11px]">Notitie</Label>
                            <Input value={newEx.note} onChange={(e) => setNewEx({ ...newEx, note: e.target.value })} className="h-10" placeholder="optioneel" />
                          </div>
                        </div>
                        <Button size="sm" className="w-full sm:w-auto gap-2" onClick={handleAddException}>
                          <Plus className="h-4 w-4" /> Toevoegen
                        </Button>
                      </div>
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </div>

            <div className="sticky bottom-0 bg-background border-t px-4 sm:px-5 py-3 flex gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1 h-11 min-w-[120px]">Annuleren</Button>
              <Button onClick={handleSave} className="flex-1 h-11 min-w-[120px]" disabled={uploading}>Opslaan</Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
