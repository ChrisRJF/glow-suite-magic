import { createHash, timingSafeEqual } from "node:crypto";

// Compare fixed-sized digests, never log credentials or accept user/anon tokens.
export function schedulerAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret || secret.length < 32) return false;
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9]{32,512})$/.exec(header);
  if (!match) return false;
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(match[1]), digest(secret));
}