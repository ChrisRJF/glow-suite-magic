// PREPARED PATCH, NOT DEPLOYED. Future replacement of supabase/functions/whatsapp-send/index.ts.
// Copying this file onto the active path deploys it. Requires separate explicit approval and the
// prerequisites in docs/prepared-patches/whatsapp-send/README.md (SQL + secrets) first.
// Without those every request answers 503 (fail closed), never the old vulnerable behaviour.

import { createClient } from "npm:@supabase/supabase-js@2";
import { handleWhatsAppSendHttp } from "../_shared/inactive/whatsappSendHttp.ts";
import { buildDeps, type Db } from "../_shared/inactive/whatsappSendAdapters.ts";

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
    LOVABLE_API_KEY: Deno.env.get("LOVABLE_API_KEY"),
    TWILIO_API_KEY: Deno.env.get("TWILIO_API_KEY"),
    WA_FROM_NUMBER: Deno.env.get("WA_FROM_NUMBER"),
  }, { fetch, now: Date.now, log: (e) => console.log(e) }),
  log: (e) => console.log(e),
  async verifyJwt(token) {
    const { data, error } = await admin.auth.getUser(token);
    return error || !data?.user?.id ? null : { sub: data.user.id };
  },
}));
