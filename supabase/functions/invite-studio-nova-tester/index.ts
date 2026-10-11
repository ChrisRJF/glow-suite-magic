// One-shot, hardcoded invite for the Studio Nova Amsterdam demo tester. Removed right after use.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const EMAIL = "ccfrancoisinc+studionova@gmail.com";
const TENANT = "cbd7d158-0133-4f2f-a504-4b82f73f2e20";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

  const s = await admin.from("settings").select("is_demo, demo_mode, salon_name").eq("user_id", TENANT).maybeSingle();
  if (s.error || !s.data || s.data.is_demo !== true || s.data.demo_mode !== true) return j({ error: "tenant_not_demo" }, 409);
  const existing = await admin.from("profiles").select("user_id").ilike("email", EMAIL);
  if (existing.error || (existing.data ?? []).length) return j({ error: "already_exists" }, 409);
  const acc = await admin.from("user_access").select("id").eq("owner_user_id", TENANT).ilike("email", EMAIL);
  if (acc.error || (acc.data ?? []).length) return j({ error: "access_exists" }, 409);

  const inv = await admin.auth.admin.inviteUserByEmail(EMAIL, {
    redirectTo: "https://glowsuite.nl/reset-password",
    data: { invited_by: TENANT, invited_role: "admin", name: "Studio Nova tester" },
  });
  if (inv.error || !inv.data.user) return j({ error: inv.error?.message ?? "invite_failed" }, 400);
  const uid = inv.data.user.id;

  const r = await admin.from("user_roles").insert({ user_id: uid, role: "admin" });
  const a = await admin.from("user_access").insert({
    owner_user_id: TENANT, member_user_id: uid, name: "Studio Nova tester", email: EMAIL,
    role: "admin", status: "active", is_demo: true,
  });
  return j({ user_id: uid, role_error: r.error?.message ?? null, access_error: a.error?.message ?? null });
});
