import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function cleanupRequest(requestId: string) {
  const now = new Date().toISOString();
  const { data: rows } = await admin.from("privacy_storage_cleanup").select("id,bucket_id,object_path,attempts,next_retry_at")
    .eq("privacy_request_id", requestId).in("status", ["pending", "retry"]).limit(100);
  for (const row of (rows || []).filter((item) => !item.next_retry_at || item.next_retry_at <= now)) {
    await admin.from("privacy_storage_cleanup").update({ status: "processing", attempts: row.attempts + 1 }).eq("id", row.id);
    const { error } = await admin.storage.from(row.bucket_id).remove([row.object_path]);
    await admin.from("privacy_storage_cleanup").update(error ? {
      status: row.attempts + 1 >= 5 ? "failed" : "retry",
      last_error: "storage_delete_failed",
      next_retry_at: new Date(Date.now() + Math.min(60, 2 ** row.attempts) * 60_000).toISOString(),
    } : { status: "completed", completed_at: new Date().toISOString(), last_error: null, next_retry_at: null }).eq("id", row.id);
  }
  const { count } = await admin.from("privacy_storage_cleanup").select("id", { count: "exact", head: true }).eq("privacy_request_id", requestId).neq("status", "completed");
  if ((count || 0) === 0) await admin.from("privacy_requests").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", requestId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!req.headers.get("authorization")?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const { data: control } = await admin.from("privacy_runtime_controls").select("enabled").eq("control_key", "retention_processing").maybeSingle();
  if (control?.enabled !== true) return json({ ok: true, skipped: "kill_switch_off" });

  const holder = crypto.randomUUID();
  const { data: locked } = await admin.rpc("try_acquire_scheduler_lock", { _name: "privacy-retention", _ttl_seconds: 900, _holder: holder });
  if (locked !== true) return json({ ok: true, skipped: "lock_busy" });
  try {
    const { data: policies } = await admin.from("retention_policies").select("*").eq("enabled", true).eq("review_status", "active").neq("action", "none").limit(100);
    let processed = 0;
    let blocked = 0;
    for (const policy of policies || []) {
      if (policy.category !== "customer_profile" || !policy.activated_by) continue;
      const cutoff = new Date();
      cutoff.setUTCHours(0, 0, 0, 0);
      cutoff.setUTCMonth(cutoff.getUTCMonth() - Number(policy.retention_months));
      const { data: candidates } = await admin.from("customers").select("id")
        .eq("user_id", policy.user_id).eq("is_demo", policy.is_demo)
        .lt("updated_at", cutoff.toISOString()).is("archived_at", null).limit(25);
      for (const candidate of candidates || []) {
        const key = `retention:${policy.id}:v${policy.policy_version}:${candidate.id}`;
        const { data: privacyRequest } = await admin.from("privacy_requests").upsert({
          user_id: policy.user_id,
          is_demo: policy.is_demo,
          customer_id: candidate.id,
          customer_ref: candidate.id,
          request_type: "retention_action",
          requested_by: policy.activated_by,
          idempotency_key: key,
          result_summary: { policy_category: policy.category, policy_version: policy.policy_version },
        }, { onConflict: "user_id,idempotency_key" }).select("id,status").single();
        if (!privacyRequest || privacyRequest.status === "completed") continue;
        const { data: result } = await admin.rpc("execute_customer_privacy_action", {
          _request_id: privacyRequest.id,
          _tenant_id: policy.user_id,
          _customer_id: candidate.id,
          _actor_id: policy.activated_by,
          _action: policy.action,
        });
        if ((result as Record<string, unknown>)?.ok === true) processed += 1;
        else blocked += 1;
      }
    }
    const { data: pending } = await admin.from("privacy_requests").select("id").eq("status", "storage_cleanup_pending").limit(25);
    for (const privacyRequest of pending || []) await cleanupRequest(privacyRequest.id);
    return json({ ok: true, processed, blocked });
  } catch (error) {
    console.error("privacy_retention_failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "server_error" }, 500);
  } finally {
    await admin.rpc("release_scheduler_lock", { _name: "privacy-retention" });
  }
});