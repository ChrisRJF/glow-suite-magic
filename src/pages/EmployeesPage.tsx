import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEmployees } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { useState, useRef } from "react";
import { Plus, Trash2, Camera, X, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  break_start: string;
  break_end: string;
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
  break_start: "12:00",
  break_end: "12:30",
  is_active: true,
});

export default function EmployeesPage() {
  const { user } = useAuth();
  const { data: employees, refetch, loading } = useEmployees();
  const { insert, update, remove } = useCrud("employees");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EmployeeForm>(emptyForm());
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openNew = () => {
    setForm(emptyForm());
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
      break_start: e.break_start ? String(e.break_start).slice(0, 5) : "12:00",
      break_end: e.break_end ? String(e.break_end).slice(0, 5) : "12:30",
      is_active: e.is_active !== false,
    });
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
    const payload = {
      name: form.name.trim(),
      role: form.role.trim(),
      color: form.color,
      photo_url: form.photo_url,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      working_days: form.working_days.length ? form.working_days : [1, 2, 3, 4, 5],
      break_start: form.break_start || null,
      break_end: form.break_end || null,
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

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Medewerkers</h1>
            <p className="text-sm text-muted-foreground mt-1">Beheer je team, foto's en werkdagen.</p>
          </div>
          <Button onClick={openNew} className="h-11 gap-2">
            <Plus className="h-4 w-4" /> Nieuw
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground text-sm">Laden…</div>
        ) : !employees?.length ? (
          <div className="text-center py-12 border border-dashed rounded-2xl bg-card">
            <p className="text-muted-foreground mb-4">Nog geen medewerkers</p>
            <Button onClick={openNew} variant="outline">Eerste medewerker toevoegen</Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {employees.map((e: any) => (
              <div
                key={e.id}
                className="group flex items-center gap-3 p-3 sm:p-4 rounded-2xl border bg-card hover:shadow-sm transition-shadow"
              >
                <EmployeeAvatar employee={e} size="xl" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{e.name}</div>
                  {e.role && <div className="text-xs text-muted-foreground truncate">{e.role}</div>}
                  <div className="flex gap-1 mt-1.5">
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
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-background w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-background border-b px-5 py-4 flex items-center justify-between">
              <h2 className="font-semibold">{form.id ? "Medewerker bewerken" : "Nieuwe medewerker"}</h2>
              <button onClick={() => setShowForm(false)} className="h-9 w-9 rounded-full hover:bg-muted flex items-center justify-center">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Photo + color */}
              <div className="flex items-center gap-4">
                <div className="relative">
                  <EmployeeAvatar employee={form} size="xl" />
                  {uploading && (
                    <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center">
                      <Loader2 className="h-5 w-5 text-white animate-spin" />
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-2">
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
                  <div className="flex gap-2">
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

              {/* Color picker */}
              <div>
                <Label className="text-xs">Kleur (gebruikt als fallback en in agenda)</Label>
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

              <div>
                <Label className="text-xs">Werkdagen</Label>
                <div className="flex gap-1 mt-2">
                  {DAY_LABELS.map((lbl, i) => {
                    const day = i + 1;
                    const active = form.working_days.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(day)}
                        className={cn(
                          "flex-1 h-11 rounded-lg text-xs font-medium border transition",
                          active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-foreground/30"
                        )}
                      >
                        {lbl}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Pauze start</Label>
                  <Input type="time" value={form.break_start} onChange={(e) => setForm({ ...form, break_start: e.target.value })} className="h-11" />
                </div>
                <div>
                  <Label className="text-xs">Pauze eind</Label>
                  <Input type="time" value={form.break_end} onChange={(e) => setForm({ ...form, break_end: e.target.value })} className="h-11" />
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
            </div>

            <div className="sticky bottom-0 bg-background border-t px-5 py-3 flex gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1 h-11">Annuleren</Button>
              <Button onClick={handleSave} className="flex-1 h-11" disabled={uploading}>Opslaan</Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
