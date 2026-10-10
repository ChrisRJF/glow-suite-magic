// PREPARED PATCH, NOT DEPLOYED. Future replacement of supabase/functions/whatsapp-send/index.ts.
// Copying this file onto the active path deploys it. Requires separate explicit approval and the
// prerequisites in docs/prepared-patches/whatsapp-send/README.md (SQL + secrets) first.
// Without those every request answers 503 (fail closed), never the old vulnerable behaviour.

import { createClient } from "npm:@supabase/supabase-js@2";
import { handleWhatsAppSendHttp } from "../_shared/inactive/whatsappSendHttp.ts";
import { buildDeps, type Db, type MetaConnection } from "../_shared/inactive/whatsappSendAdapters.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const db: Db = {
  async select(table, cols, eq, opts) {
    // deno-lint-ignore no-explicit-any
    let q: any = admin.from(table).select(cols);
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
    if (opts?.orderDesc) q = q.order(opts.orderDesc, { ascending: false });
    const { data, error } = await q.limit(opts?.limit ?? 2);
    return { data, error };
  },
  async rpc(fn, args) {
    const { data, error } = await admin.rpc(fn, args);
    return { data, error };
  },
};

Deno.serve((req) => handleWhatsAppSendHttp(req, {
  build: () => buildDeps(db, {
    WA_CLAIM_HMAC_KEY: Deno.env.get("WA_CLAIM_HMAC_KEY"),
    WA_CONTACT_REF_KEYS: Deno.env.get("WA_CONTACT_REF_KEYS"),
    WA_SEND_SERVICE_KEYS: Deno.env.get("WA_SEND_SERVICE_KEYS"),
    WA_META_APP_ID: Deno.env.get("WA_META_APP_ID"),
    WA_META_TEMPLATES: Deno.env.get("WA_META_TEMPLATES"),
  }, { fetch, now: Date.now, log: (e) => console.log(e), meta: {
    // Per-salon connection, keyed ONLY by the verified tenant. Table is a proposal; until it
    // exists the lookup errors and every send fails closed (503 connection_lookup_failed).
    async connectionForTenant(tenantId) {
      const { data, error } = await admin.from("whatsapp_meta_connections")
        .select("tenant_id,waba_id,phone_number_id,status,app_id,credential_ref,capabilities,expires_at")
        .eq("tenant_id", tenantId).limit(2);
      if (error || !Array.isArray(data) || data.length > 1) throw new Error("connection_lookup_failed");
      const r = data[0]; if (!r) return null;
      return { ...r, expires_at_ms: r.expires_at ? Date.parse(r.expires_at) : null } as MetaConnection;
    },
    // Interim injected credential store: {"<credential_ref>":"<token>"} in a server secret.
    // Later replaced by an encrypted vault lookup; tokens never live in salon tables.
    async credential(ref) {
      try { const m = JSON.parse(Deno.env.get("WA_META_CREDENTIALS") ?? ""); return typeof m?.[ref] === "string" ? m[ref] : null; }
      catch { return null; }
    },
  } }),
  log: (e) => console.log(e),
  async verifyJwt(token) {
    const { data, error } = await admin.auth.getUser(token);
    return error || !data?.user?.id ? null : { sub: data.user.id };
  },
}));
