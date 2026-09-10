import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Camera, Images, X } from "lucide-react";
import { toast } from "sonner";
import { useDossierAccess } from "@/hooks/useDossierAccess";

type Category = "before" | "after" | "control";

interface MediaRow {
  id: string;
  category: string;
  caption: string | null;
  created_at: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  before: "Voor",
  after: "Na",
  control: "Controle",
  other: "Overig",
};

interface Props {
  customerId: string;
  appointmentId?: string | null;
  treatmentRecordId?: string | null;
  onChanged?: () => void;
}

export function ClinicalMediaPanel({ customerId, appointmentId = null, treatmentRecordId = null, onChanged }: Props) {
  const { canViewContent, canManageTemplates, loading } = useDossierAccess();
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ before: string; after: string } | null>(null);
  const pending = useRef<Category>("before");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    let q = supabase.from("clinical_media").select("id, category, caption, created_at").eq("customer_id", customerId);
    if (appointmentId) q = q.eq("appointment_id", appointmentId);
    const { data } = await q.order("created_at", { ascending: false });
    setMedia((data as MediaRow[]) || []);
  };

  useEffect(() => {
    if (!loading && canViewContent) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, canViewContent, customerId, appointmentId]);

  if (loading || !canViewContent) return null;

  const pick = (category: Category) => {
    pending.current = category;
    inputRef.current?.click();
  };

  const signedUrl = async (id: string): Promise<string | null> => {
    const { data, error } = await supabase.functions.invoke("clinical-media", { body: { action: "sign", media_id: id } });
    if (error) return null;
    return (data as { url?: string })?.url ?? null;
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return toast.error("Deze foto is te groot (max 8 MB)");
    setBusy(true);
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const { data, error } = await supabase.functions.invoke("clinical-media", {
      body: {
        action: "upload",
        customer_id: customerId,
        appointment_id: appointmentId,
        treatment_record_id: treatmentRecordId,
        category: pending.current,
        data_base64: base64,
      },
    });
    setBusy(false);
    if (error || (data as { error?: string })?.error) return toast.error("Foto toevoegen mislukt");
    toast.success("Foto toegevoegd");
    load();
    onChanged?.();
  };

  const openPreview = async (id: string) => {
    const url = await signedUrl(id);
    if (!url) return toast.error("Foto openen mislukt");
    setPreview(url);
  };

  const openCompare = async () => {
    const before = media.find((m) => m.category === "before");
    const after = media.find((m) => m.category === "after");
    if (!before || !after) return;
    const [b, a] = await Promise.all([signedUrl(before.id), signedUrl(after.id)]);
    if (!b || !a) return toast.error("Vergelijken mislukt");
    setCompare({ before: b, after: a });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.functions.invoke("clinical-media", { body: { action: "remove", media_id: id } });
    if (error) return toast.error("Verwijderen mislukt");
    load();
    onChanged?.();
  };

  const hasBoth = media.some((m) => m.category === "before") && media.some((m) => m.category === "after");

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Images className="h-4 w-4 text-primary" /> Foto's
      </h4>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => pick("before")}>
          <Camera className="h-3.5 w-3.5 mr-1" /> Voorfoto
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => pick("after")}>
          <Camera className="h-3.5 w-3.5 mr-1" /> Nafoto
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => pick("control")}>
          <Camera className="h-3.5 w-3.5 mr-1" /> Controlefoto
        </Button>
        {hasBoth && (
          <Button variant="ghost" size="sm" onClick={openCompare}>
            Vergelijk voor en na
          </Button>
        )}
      </div>

      {media.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nog geen foto's.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {media.map((m) => (
            <div key={m.id} className="rounded-lg border border-border p-2 text-xs">
              <button className="text-left" onClick={() => openPreview(m.id)}>
                <p className="font-medium text-foreground">{CATEGORY_LABEL[m.category] || m.category}</p>
                <p className="text-muted-foreground">
                  {new Date(m.created_at).toLocaleDateString("nl-NL", { dateStyle: "medium" })}
                </p>
                {m.caption && <p className="text-muted-foreground">{m.caption}</p>}
              </button>
              {canManageTemplates && (
                <button className="mt-1 text-muted-foreground hover:text-foreground" onClick={() => remove(m.id)}>
                  Verwijderen
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4" onClick={() => setPreview(null)}>
          <img src={preview} alt="Foto uit het dossier" className="max-h-[80vh] max-w-full rounded-xl" />
          <button className="absolute right-4 top-4 text-muted-foreground" aria-label="Sluiten">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {compare && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4" onClick={() => setCompare(null)}>
          <div className="grid w-full max-w-3xl grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Voor</p>
              <img src={compare.before} alt="Voorfoto" className="w-full rounded-xl" />
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Na</p>
              <img src={compare.after} alt="Nafoto" className="w-full rounded-xl" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
