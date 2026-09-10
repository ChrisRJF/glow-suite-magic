// Klantdossier P0b — treatment records.
//
// Actions (staff JWT required): save (draft), complete, viewed (audit only).
// Tenant, permissions and relations are always resolved server-side.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitize(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/[<>]/g, "").slice(0, 2000);
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitize);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return null;
}

interface Ctx {
  tenantId: string;
  actorId: string;
  isDemo: boolean;
  mayContent: boolean;
}

async function resolveContext(req: Request): Promise<Ctx | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return null;
  const [{ data: tenantId }, { data: mayContent }, { data: isDemo }] = await Promise.all([
    userClient.rpc("current_tenant_id"),
    userClient.rpc("can_view_dossier_content"),
    userClient.rpc("current_tenant_is_demo"),
  ]);
  if (!tenantId) return null;
  return { tenantId: String(tenantId), actorId: userData.user.id, isDemo: isDemo === true, mayContent: mayContent === true };
}

async function audit(ctx: Ctx, action: string, targetId: string, details: Record<string, unknown> = {}) {
  await admin.from("audit_logs").insert({
    user_id: ctx.tenantId,
    actor_user_id: ctx.actorId,
    action,
    target_type: "treatment_record",
    target_id: targetId,
    is_demo: ctx.isDemo,
    details, // never the answers themselves
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const ctx = await resolveContext(req);
    if (!ctx) return json({ error: "unauthorized" }, 401);
    if (!ctx.mayContent) return json({ error: "forbidden" }, 403);

    if (action === "viewed") {
      const id = String(body.record_id ?? "");
      if (id) await audit(ctx, "treatment_record_viewed", id);
      return json({ ok: true });
    }

    if (action !== "save" && action !== "complete") return json({ error: "unknown_action" }, 400);

    const recordId = body.record_id ? String(body.record_id) : null;
    const customerId = String(body.customer_id ?? "");
    const appointmentId = body.appointment_id ? String(body.appointment_id) : null;
    const templateId = body.template_id ? String(body.template_id) : null;
    const rawValues = (body.values ?? {}) as Record<string, unknown>;
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawValues).slice(0, 100)) values[String(k).slice(0, 64)] = sanitize(v);

    let existing: { id: string; locked_at: string | null; customer_id: string } | null = null;
    if (recordId) {
      const { data } = await admin
        .from("treatment_records")
        .select("id, locked_at, customer_id")
        .eq("id", recordId)
        .eq("user_id", ctx.tenantId)
        .maybeSingle();
      if (!data) return json({ error: "not_found" }, 404);
      existing = data;
      if (data.locked_at) return json({ error: "record_locked" }, 409);
    }

    if (!existing) {
      if (!customerId || !templateId) return json({ error: "customer_and_template_required" }, 400);
      const [{ data: customer }, { data: template }] = await Promise.all([
        admin.from("customers").select("id").eq("id", customerId).eq("user_id", ctx.tenantId).maybeSingle(),
        admin
          .from("treatment_record_templates")
          .select("id, version, schema, service_id")
          .eq("id", templateId)
          .eq("user_id", ctx.tenantId)
          .maybeSingle(),
      ]);
      if (!customer) return json({ error: "customer_not_found" }, 404);
      if (!template) return json({ error: "template_not_found" }, 404);

      let serviceId: string | null = template.service_id;
      let employeeId: string | null = null;
      if (appointmentId) {
        const { data: appt } = await admin
          .from("appointments")
          .select("id, customer_id, service_id, employee_id")
          .eq("id", appointmentId)
          .eq("user_id", ctx.tenantId)
          .maybeSingle();
        if (!appt || appt.customer_id !== customerId) return json({ error: "appointment_mismatch" }, 400);
        serviceId = appt.service_id ?? serviceId;
        employeeId = (appt as { employee_id?: string | null }).employee_id ?? null;
      }

      const completing = action === "complete";
      const { data: created, error } = await admin
        .from("treatment_records")
        .insert({
          user_id: ctx.tenantId,
          is_demo: ctx.isDemo,
          customer_id: customerId,
          appointment_id: appointmentId,
          employee_id: employeeId,
          service_id: serviceId,
          template_id: template.id,
          template_version: template.version,
          template_snapshot: template.schema,
          values,
          status: completing ? "completed" : "draft",
          completed_at: completing ? new Date().toISOString() : null,
          locked_at: completing ? new Date().toISOString() : null,
        })
        .select("id, status, completed_at, locked_at")
        .single();
      if (error) {
        console.error("treatment_record_insert_failed", error.message);
        return json({ error: "save_failed" }, 500);
      }
      await audit(ctx, "treatment_record_created", created.id, { template_version: template.version });
      if (completing) await audit(ctx, "treatment_record_completed", created.id, {});
      return json({ ok: true, record: created });
    }

    const completing = action === "complete";
    const { data: updated, error } = await admin
      .from("treatment_records")
      .update({
        values,
        status: completing ? "completed" : "draft",
        completed_at: completing ? new Date().toISOString() : null,
        locked_at: completing ? new Date().toISOString() : null,
      })
      .eq("id", existing.id)
      .eq("user_id", ctx.tenantId)
      .select("id, status, completed_at, locked_at")
      .single();
    if (error) {
      console.error("treatment_record_update_failed", error.message);
      return json({ error: "save_failed" }, 500);
    }
    if (completing) await audit(ctx, "treatment_record_completed", updated.id, {});
    return json({ ok: true, record: updated });
  } catch (e) {
    console.error("treatment_records_error", (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
});
