// Agenda 3.0: short-lived, tab-scoped store for ONE open create request whose outcome is unknown.
// Key = user + salon, so another login or salon never sees it. sessionStorage only (gone when the tab closes),
// plus a TTL. Saved BEFORE the first server call, cleared only when the outcome is definitive.
import type { CreateBody } from "./agendaCreateClient";

const PREFIX = "glowsuite.agendaPending.v1:";
export const PENDING_TTL_MS = 2 * 60 * 60 * 1000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
const defaultStore = (): Store | null => { try { return typeof window !== "undefined" ? window.sessionStorage : null; } catch { return null; } };

export const pendingKey = (userId: string, tenantId: string) => `${PREFIX}${userId}:${tenantId}`;

export function savePending(userId: string, tenantId: string, body: CreateBody, store = defaultStore(), now = Date.now()): boolean {
  if (!store || !userId || !tenantId) return false;
  try { store.setItem(pendingKey(userId, tenantId), JSON.stringify({ v: 1, savedAt: now, userId, tenantId, body })); return true; } catch { return false; }
}

export function loadPending(userId: string, tenantId: string, store = defaultStore(), now = Date.now()): CreateBody | null {
  if (!store || !userId || !tenantId) return null;
  const key = pendingKey(userId, tenantId);
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw);
    const ok = p?.v === 1 && p.userId === userId && p.tenantId === tenantId && typeof p.savedAt === "number"
      && now - p.savedAt < PENDING_TTL_MS && typeof p.body?.request_id === "string" && p.body.send_confirmation === false;
    if (!ok) { store.removeItem(key); return null; }
    return p.body as CreateBody;
  } catch { try { store.removeItem(key); } catch { /* ignore */ } return null; }
}

export function clearPending(userId: string, tenantId: string, store = defaultStore()) {
  try { store?.removeItem(pendingKey(userId, tenantId)); } catch { /* ignore */ }
}

/** Removes entries of other users/salons in this tab (e.g. after switching login). */
export function purgeOtherPending(userId: string, tenantId: string, store = defaultStore()) {
  if (!store) return;
  const keep = pendingKey(userId, tenantId);
  const drop: string[] = [];
  for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && k.startsWith(PREFIX) && k !== keep) drop.push(k); }
  drop.forEach((k) => store.removeItem(k));
}
