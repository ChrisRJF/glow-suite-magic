import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Download, Link2, Loader2, ShieldOff, FileDown } from "lucide-react";
import { toast } from "sonner";

type Scope = "form" | "treatment_record" | "appointment_bundle" | "full_dossier";

interface Props {
  customerId: string;
  customerName?: string;
  appointmentId?: string | null;
  scope: Scope;
  sourceId?: string | null;
  triggerLabel?: string;
  triggerVariant?: "ghost" | "outline";
}

interface ExportRow {
  id: string; scope: string; format: string; document_ref: string;
  photo_count: number; file_bytes: number | null; created_at: string; expires_at: string;
}
interface ShareRow {
  id: string; export_id: string; status: string; expires_at: string;
  download_count: number; max_downloads: number; first_viewed_at: string | null;
}
interface MediaRow { id: string; category: string; created_at: string; caption: string | null }

const SCOPE_TITLE: Record<Scope, string> = {
  form: "Formulier exporteren",
  treatment_record: "Behandelverslag exporteren",
  appointment_bundle: "Dossierbundel exporteren",
  full_dossier: "Volledig dossier exporteren",
};

const ERROR_TEXT: Record<string, string> = {
  forbidden: "Je hebt geen rechten om dossierdocumenten te exporteren.",
  hash_mismatch: "Dit document kon niet worden gecontroleerd en is daarom niet geexporteerd.",
  record_not_completed: "Dit behandelverslag is nog niet afgerond.",
  already_running: "Er wordt al een document gemaakt. Even geduld.",
};

export function DocumentExportDialog({
  customerId, customerName, appointmentId = null, scope, sourceId = null,
  triggerLabel = "Exporteren", triggerVariant = "ghost",
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exports, setExports] = useState<ExportRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [sections, setSections] = useState({ customer: true, forms: true, treatments: true, alerts: true, timeline: true });
  const [runKey] = useState(() => crypto.randomUUID());

  const load = async () => {
    const { data } = await supabase.functions.invoke("dossier-export", {
      body: { action: "list", customer_id: customerId },
    });
    const res = data as { exports?: ExportRow[]; shares?: ShareRow[] } | null;
    setExports(res?.exports || []);
    setShares(res?.shares || []);
  };

  useEffect(() => {
    if (!open) return;
    load();
    (async () => {
      let q = supabase.from("clinical_media").select("id, category, created_at, caption").eq("customer_id", customerId);
      if (scope === "appointment_bundle" && appointmentId) q = q.eq("appointment_id", appointmentId);
      const { data } = await q.order("created_at", { ascending: false }).limit(40);
      setMedia((data as MediaRow[]) || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerId]);

  const shareFor = (exportId: string) => shares.find((s) => s.export_id === exportId && s.status === "active") || null;
  const willBeZip = selectedPhotos.length > 0;

  const create = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("dossier-export", {
      body: {
        action: "create",
        scope, customer_id: customerId, appointment_id: appointmentId, source_id: sourceId,
        include_photos: selectedPhotos.length > 0,
        media_ids: selectedPhotos,
        sections,
        idempotency_key: `${runKey}:${selectedPhotos.slice().sort().join(",")}:${JSON.stringify(sections)}`,
      },
    });
    setBusy(false);
    const res = data as { ok?: boolean; error?: string } | null;
    if (error || !res?.ok) {
      toast.error(ERROR_TEXT[res?.error ?? ""] || "Het document kon niet worden gemaakt.");
      return;
    }
    toast.success("Document klaar");
    load();
  };

  const download = async (exportId: string) => {
    const { data } = await supabase.functions.invoke("dossier-export", { body: { action: "download", export_id: exportId } });
    const res = data as { url?: string; error?: string } | null;
    if (!res?.url) return toast.error(ERROR_TEXT[res?.error ?? ""] || "Downloaden lukt nu niet.");
    window.open(res.url, "_blank", "noopener");
  };

  const share = async (exportId: string) => {
    const { data } = await supabase.functions.invoke("dossier-export", { body: { action: "share", export_id: exportId } });
    const res = data as { share?: { link: string }; error?: string } | null;
    if (!res?.share?.link) return toast.error(ERROR_TEXT[res?.error ?? ""] || "Link maken lukt nu niet.");
    await navigator.clipboard.writeText(res.share.link).catch(() => {});
    toast.success("Link gekopieerd. Stuur hem zelf naar de klant.");
    load();
  };

  const revoke = async (shareId: string) => {
    await supabase.functions.invoke("dossier-export", { body: { action: "revoke", share_id: shareId } });
    toast.success("Link ingetrokken");
    load();
  };

  const relevantExports = useMemo(
    () => exports.filter((e) => (scope === "full_dossier" ? true : e.scope === scope)),
    [exports, scope],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          <FileDown className="h-3.5 w-3.5 mr-1" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{SCOPE_TITLE[scope]}</DialogTitle>
          <DialogDescription>
            {customerName ? `${customerName}. ` : ""}Foto's staan standaard uit. Documenten worden gemaakt vanuit de
            opgeslagen versie, zodat oude formulieren blijven zoals ze zijn ondertekend.
          </DialogDescription>
        </DialogHeader>

        {scope === "full_dossier" && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Wat neem je mee?</p>
            {([
              ["customer", "Klantgegevens"],
              ["forms", "Formulieren en toestemmingen"],
              ["treatments", "Behandelverslagen"],
              ["alerts", "Aandachtspunten"],
              ["timeline", "Tijdlijn"],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={sections[key]}
                  onCheckedChange={(v) => setSections((s) => ({ ...s, [key]: v === true }))}
                />
                {label}
              </label>
            ))}
          </div>
        )}

        {media.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-medium text-foreground">Foto's meesturen (standaard uit)</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {media.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={selectedPhotos.includes(m.id)}
                    onCheckedChange={(v) =>
                      setSelectedPhotos((p) => (v === true ? [...p, m.id] : p.filter((x) => x !== m.id)))
                    }
                  />
                  {m.category} · {new Date(m.created_at).toLocaleDateString("nl-NL", { dateStyle: "medium" })}
                </label>
              ))}
            </div>
            {willBeZip && (
              <p className="text-xs text-muted-foreground">
                Met foto's krijg je een zip met het document en de gekozen foto's.
              </p>
            )}
          </div>
        )}

        <Button onClick={create} disabled={busy} className="w-full">
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
          {busy ? "Bezig met maken..." : willBeZip ? "Maak zip" : "Maak PDF"}
        </Button>

        {relevantExports.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-medium text-foreground">Recente documenten</p>
            {relevantExports.map((e) => {
              const active = shareFor(e.id);
              return (
                <div key={e.id} className="rounded-xl border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm text-foreground">{e.document_ref}</p>
                      <p className="text-xs text-muted-foreground">
                        {e.format.toUpperCase()}
                        {e.photo_count > 0 ? ` · ${e.photo_count} foto's` : ""} ·{" "}
                        {new Date(e.created_at).toLocaleDateString("nl-NL", { dateStyle: "medium" })}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => download(e.id)}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      {active ? (
                        <Button variant="ghost" size="sm" onClick={() => revoke(active.id)}>
                          <ShieldOff className="h-3.5 w-3.5 mr-1" /> Intrekken
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => share(e.id)}>
                          <Link2 className="h-3.5 w-3.5 mr-1" /> Deellink
                        </Button>
                      )}
                    </div>
                  </div>
                  {active && (
                    <p className="text-xs text-muted-foreground">
                      Link geldig tot {new Date(active.expires_at).toLocaleDateString("nl-NL", { dateStyle: "medium" })} ·{" "}
                      {active.download_count}/{active.max_downloads} keer gebruikt
                      {active.first_viewed_at ? " · bekeken" : " · nog niet bekeken"}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
