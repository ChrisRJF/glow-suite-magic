import { DOSSIER_STATUS_LABEL, type DossierStatusValue } from "@/hooks/useDossierStatus";

const STYLES: Record<DossierStatusValue, string> = {
  compleet: "border-emerald-600/30 bg-emerald-600/10 text-emerald-700",
  actie_nodig: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  af_te_ronden: "border-border bg-muted text-muted-foreground",
};

export function DossierStatusBadge({ status, title }: { status: DossierStatusValue; title?: string }) {
  return (
    <span title={title} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STYLES[status]}`}>
      {DOSSIER_STATUS_LABEL[status]}
    </span>
  );
}
