import { createHash, timingSafeEqual } from "node:crypto";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const BEARER = /^Bearer ([A-Za-z0-9]{32,512})$/;

// Compare fixed-sized digests, never log credentials or accept user/anon tokens.
export function schedulerAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret || secret.length < 32) return false;
  const match = BEARER.exec(req.headers.get("authorization") ?? "");
  if (!match) return false;
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(match[1]), digest(secret));
}

/** Reads the private Vault secret 'viva_reconcile_cron' via the server-only DB URL.
 *  Malformed/missing headers are refused before any DB connection; any error fails closed. */
export async function schedulerAuthorizedVault(req: Request, dbUrl: string | undefined): Promise<boolean> {
  if (!dbUrl || !BEARER.test(req.headers.get("authorization") ?? "")) return false;
  const sql = postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 5 });
  try {
    const rows = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'viva_reconcile_cron' limit 1`;
    return schedulerAuthorized(req, (rows[0]?.decrypted_secret as string | undefined) ?? undefined);
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}
