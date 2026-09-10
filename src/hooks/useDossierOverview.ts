import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDossierAccess } from "./useDossierAccess";

export interface OverviewAppointment {
  id: string;
  appointment_date: string;
  status: string;
  service_id: string | null;
  journey_id: string | null;
  journey_session_number: number | null;
}

export interface OverviewForm {
  id: string;
  title: string;
  status: string;
  completed_at: string | null;
  created_at: string;
}

export interface OverviewRecord {
  id: string;
  appointment_id: string | null;
  status: string;
  completed_at: string | null;
  created_at: string;
  service_id: string | null;
}

export interface OverviewJourney {
  id: string;
  name: string;
  status: string;
  planned_sessions: number | null;
  service_id: string | null;
}

export interface OverviewDocument {
  id: string;
  scope: string;
  format: string;
  created_at: string;
  status: string;
}

export interface DossierOverview {
  loading: boolean;
  appointments: OverviewAppointment[];
  forms: OverviewForm[];
  records: OverviewRecord[];
  journeys: OverviewJourney[];
  documents: OverviewDocument[];
  services: { id: string; name: string; aftercare_text: string | null }[];
  /** Labels only when the role may see dossier content. */
  alerts: { id: string; label: string | null; review_status: string }[];
  openAlerts: number;
  consents: { scope: string; consent_type: string; event: string; occurred_at: string }[];
  refresh: () => Promise<void>;
}

/**
 * One batched read per customer for the P4 smart clinic layer.
 * Rule-based only: no AI call, no dossier content leaves the client.
 */
export function useDossierOverview(customerId: string): DossierOverview {
  const { canViewStatus, canViewContent, loading: accessLoading } = useDossierAccess();
  const [state, setState] = useState<Omit<DossierOverview, "refresh" | "loading">>({
    appointments: [],
    forms: [],
    records: [],
    journeys: [],
    documents: [],
    services: [],
    alerts: [],
    openAlerts: 0,
    consents: [],
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!customerId || !canViewStatus) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [appts, reqs, templates, records, journeys, docs, services, alerts, consents] = await Promise.all([
      supabase
        .from("appointments")
        .select("id, appointment_date, status, service_id, journey_id, journey_session_number")
        .eq("customer_id", customerId)
        .order("appointment_date", { ascending: false })
        .limit(50),
      supabase
        .from("form_requests")
        .select("id, status, completed_at, created_at, template_id")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("form_templates").select("id, title"),
      canViewContent
        ? supabase
            .from("treatment_records")
            .select("id, appointment_id, status, completed_at, created_at, service_id")
            .eq("customer_id", customerId)
            .order("created_at", { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] as unknown[] }),
      canViewContent
        ? supabase
            .from("treatment_journeys")
            .select("id, name, status, planned_sessions, service_id")
            .eq("customer_id", customerId)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as unknown[] }),
      canViewContent
        ? supabase
            .from("document_exports")
            .select("id, scope, format, created_at, status")
            .eq("customer_id", customerId)
            .order("created_at", { ascending: false })
            .limit(25)
        : Promise.resolve({ data: [] as unknown[] }),
      supabase.from("services").select("id, name, aftercare_text"),
      supabase
        .from("customer_alerts")
        .select("id, label, review_status")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(50),
      canViewContent
        ? supabase
            .from("customer_consents")
            .select("scope, consent_type, event, occurred_at")
            .eq("customer_id", customerId)
            .order("seq", { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

    const titleById = new Map(
      ((templates.data as { id: string; title: string }[]) || []).map((t) => [t.id, t.title]),
    );
    const alertRows = (alerts.data as { id: string; label: string; review_status: string }[]) || [];

    setState({
      appointments: (appts.data as OverviewAppointment[]) || [],
      forms: (((reqs.data as { id: string; status: string; completed_at: string | null; created_at: string; template_id: string }[]) || []).map((r) => ({
        id: r.id,
        title: titleById.get(r.template_id) || "Formulier",
        status: r.status,
        completed_at: r.completed_at,
        created_at: r.created_at,
      }))),
      records: (records.data as OverviewRecord[]) || [],
      journeys: (journeys.data as OverviewJourney[]) || [],
      documents: (docs.data as OverviewDocument[]) || [],
      services: (services.data as { id: string; name: string; aftercare_text: string | null }[]) || [],
      alerts: canViewContent ? alertRows : alertRows.map((a) => ({ id: a.id, label: null, review_status: a.review_status })),
      openAlerts: alertRows.filter((a) => a.review_status !== "reviewed").length,
      consents: (consents.data as { scope: string; consent_type: string; event: string; occurred_at: string }[]) || [],
    });
    setLoading(false);
  }, [customerId, canViewStatus, canViewContent]);

  useEffect(() => {
    if (!accessLoading) refresh();
  }, [accessLoading, refresh]);

  return { ...state, loading: loading || accessLoading, refresh };
}
