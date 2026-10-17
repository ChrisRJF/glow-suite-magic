// Server-only Vault read of the WhatsApp scheduler secret 'wa_scheduler_cron'
// (same pattern as viva-payment-reconcile/schedulerAuth.ts). Only attempted for
// a well-formed opaque bearer (user JWTs contain dots and never match), so user
// calls never open a DB connection. Any error returns undefined (fail-closed).
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

import { OPAQUE_BEARER } from "./whatsappSchedulerMode.ts";
export { OPAQUE_BEARER, SCHEDULED_DISPATCH_ENABLED } from "./whatsappSchedulerMode.ts";

export async function readSchedulerVaultSecret(req: Request, dbUrl: string | undefined): Promise<string | undefined> {
  if (!dbUrl || !OPAQUE_BEARER.test(req.headers.get("authorization") ?? "")) return undefined;
  const sql = postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 5 });
  try {
    const rows = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'wa_scheduler_cron' limit 1`;
    const v = rows[0]?.decrypted_secret as string | undefined;
    return v && v.length >= 32 ? v : undefined;
  } catch {
    return undefined;
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}
