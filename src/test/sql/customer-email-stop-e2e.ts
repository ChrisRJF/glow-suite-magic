// Isolated e2e: real handler + real local PostgreSQL stop switch (run via run-local-pg-email-stop.sh).
// Fictitious data, fake provider, no network.
import { spawnSync } from "node:child_process";
import { createCustomerEmailHandler } from "../../../supabase/functions/_shared/inactive/customerEmailHandler.ts";

const PSQL = (process.env.PSQLX ?? "").split(" ");
const sql = (q: string, role = "service_role") => {
  const r = spawnSync(PSQL[0], [...PSQL.slice(1), "-d", "gs_email_stop", "-At", "-c", `set role ${role}; ${q}`], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return r.stdout.trim();
};
let role = "service_role";
const sent: unknown[] = [];
const A = "11111111-1111-4111-8111-111111111111";
const h = createCustomerEmailHandler({
  serviceRoleKey: "svc-fictief",
  // Same query the deployed wrapper runs, every call.
  readStopSwitch: async () => { const v = sql("select sending_enabled from public.customer_email_controls where id = true", role); return v === "" ? null : { sending_enabled: v === "t" }; },
  verifyUser: async () => null, tenantForUser: async () => null, rolesForUser: async () => null,
  loadSettings: async () => ({ salon_name: "Studio Fictief", public_slug: "studio-fictief" }),
  reviewUrl: async () => null,
  ownerEmail: async () => null, customerLanguage: async () => null,
  tokenForAppointment: async () => null, tokenBelongsToTenant: async () => false,
  log: async () => {}, sendEmail: async () => { sent.push(1); return { ok: true, id: "fake" }; },
});
const call = async () => (await h(new Request("http://x/", { method: "POST", headers: { Authorization: "Bearer svc-fictief" }, body: JSON.stringify({ user_id: A, recipient_email: "klant@fictief.test", template_key: "booking_confirmation", idempotency_key: "idem-12345678" }) }))).status;
let fail = 0;
const check = (name: string, got: unknown, want: unknown) => { const ok = got === want; if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${got}`); };

check("seeded row after migration = enabled -> 200", await call(), 200);
sql("update public.customer_email_controls set sending_enabled = false");
check("set false -> 503 (same handler, no redeploy)", await call(), 503);
sql("update public.customer_email_controls set sending_enabled = true");
check("set true again -> 200", await call(), 200);
sql("delete from public.customer_email_controls");
check("row missing -> 503", await call(), 503);
sql("insert into public.customer_email_controls (id, sending_enabled) values (true, true)");
role = "authenticated";
check("DB permission error -> 503", await call(), 503);
role = "service_role";
let denied = 0;
for (const r of ["anon", "authenticated"]) { try { sql("select 1 from public.customer_email_controls", r); } catch { denied++; } try { sql("update public.customer_email_controls set sending_enabled=false", r); } catch { denied++; } }
check("anon/authenticated cannot read or change switch", denied, 4);
let second = "ok"; try { sql("insert into public.customer_email_controls (id, sending_enabled) values (false, true)"); second = "inserted"; } catch { second = "rejected"; }
check("only one control row possible", second, "rejected");
check("fake provider calls", sent.length, 2);
process.exit(fail ? 1 : 0);
