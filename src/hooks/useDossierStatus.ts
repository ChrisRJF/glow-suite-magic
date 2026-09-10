import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type DossierStatusValue = "compleet" | "actie_nodig" | "af_te_ronden";

export type FormState = "valid" | "missing" | "expired" | "version_outdated" | "reissue_required";

export const FORM_STATE_LABEL: Record<FormState, string> = {
  valid: "in orde",
  missing: "ontbreekt",
  expired: "verlopen",
  version_outdated: "nieuwe versie nodig",
  reissue_required: "opnieuw invullen",
};

export interface DossierReasons {
  forms: { title: string; ok: boolean; state?: FormState; valid_until?: string | null }[];
  treatment_record_required: boolean;
  treatment_record_status: "missing" | "draft" | "completed";
  before_photos: number;
  after_photos: number;
  open_alerts?: number;
}

export interface DossierStatusRow {
  status: DossierStatusValue;
  reasons: DossierReasons;
}

export const DOSSIER_STATUS_LABEL: Record<DossierStatusValue, string> = {
  compleet: "Dossier compleet",
  actie_nodig: "Actie nodig",
  af_te_ronden: "Nog af te ronden",
};

/**
 * One batched call for a whole agenda day/week. Never one request per appointment.
 */
export function useDossierStatus(appointmentIds: string[]) {
  const [map, setMap] = useState<Record<string, DossierStatusRow>>({});
  const key = appointmentIds.slice().sort().join(",");

  const refresh = useCallback(async () => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) return setMap({});
    const { data } = await supabase.rpc("appointment_dossier_status", { _appointment_ids: ids });
    const next: Record<string, DossierStatusRow> = {};
    for (const row of (data as unknown as { appointment_id: string; status: DossierStatusValue; reasons: DossierReasons }[]) || []) {
      next[row.appointment_id] = { status: row.status, reasons: row.reasons };
    }
    setMap(next);
  }, [key]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { statuses: map, refresh };
}
