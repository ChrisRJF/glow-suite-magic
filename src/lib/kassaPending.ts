// Kassa: one open terminal payment per cart. The idempotency key is saved BEFORE the
// payment is started, so closing the dialog or reloading reuses the same key and the
// server (create-viva-terminal-payment) returns the existing payment instead of a new one.

export type KassaCartItem = { name: string; price: number; qty: number; type: string; itemId: string };
export type KassaCart = Record<string, KassaCartItem>;

export type KassaPending = {
  key: string;
  fingerprint: string;
  amountCents: number;
  demo: boolean;
  customerId: string;
  cart: KassaCart;
  createdAt: number;
};

export const KASSA_PENDING_TTL_MS = 2 * 60 * 60 * 1000;
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const pendingStorageKey = (userId: string) => `glowsuite.kassa.pending.v1:${userId}`;

export function cartFingerprint(cart: KassaCart, customerId: string, demo: boolean): string {
  const lines = Object.values(cart)
    .map((i) => `${i.type}:${i.itemId}:${i.qty}:${Math.round(i.price * 100)}`)
    .sort();
  return JSON.stringify({ lines, customerId: customerId || "", demo });
}

export function cartAmountCents(cart: KassaCart): number {
  return Object.values(cart).reduce((s, i) => s + Math.round(i.price * 100) * i.qty, 0);
}

export function loadPending(storage: StorageLike | null, userId: string, now = Date.now()): KassaPending | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(pendingStorageKey(userId));
    if (!raw) return null;
    const p = JSON.parse(raw) as KassaPending;
    if (!p?.key || typeof p.amountCents !== "number") return null;
    return p;
  } catch {
    return null;
  }
}

export type BeginResult =
  | { ok: true; pending: KassaPending; resumed: boolean }
  | { ok: false; reason: "storage" | "other_pending" | "empty"; pending?: KassaPending };

/** Reuse the open payment for the same cart; refuse a different cart while one is open; fail closed without storage. */
export function beginOrResume(
  storage: StorageLike | null,
  userId: string,
  input: { cart: KassaCart; customerId: string; demo: boolean },
  newKey: () => string,
  now = Date.now(),
): BeginResult {
  const amountCents = cartAmountCents(input.cart);
  if (amountCents <= 0) return { ok: false, reason: "empty" };
  if (!storage || !userId) return { ok: false, reason: "storage" };
  const fingerprint = cartFingerprint(input.cart, input.customerId, input.demo);
  const existing = loadPending(storage, userId, now);
  if (existing) {
    if (existing.fingerprint === fingerprint) return { ok: true, pending: existing, resumed: true };
    return { ok: false, reason: "other_pending", pending: existing };
  }
  const pending: KassaPending = {
    key: newKey(), fingerprint, amountCents, demo: input.demo,
    customerId: input.customerId || "", cart: input.cart, createdAt: now,
  };
  try {
    storage.setItem(pendingStorageKey(userId), JSON.stringify(pending));
    const check = storage.getItem(pendingStorageKey(userId));
    if (!check || JSON.parse(check).key !== pending.key) return { ok: false, reason: "storage" };
  } catch {
    return { ok: false, reason: "storage" };
  }
  return { ok: true, pending, resumed: false };
}

/** Only a provider-final status (paid/failed/cancelled/expired) releases the open payment. */
export function settlePending(storage: StorageLike | null, userId: string, key: string, status: string): boolean {
  if (!["paid", "failed", "cancelled", "expired"].includes(status)) return false;
  const current = loadPending(storage, userId);
  if (!current || current.key !== key) return false;
  try { storage!.removeItem(pendingStorageKey(userId)); } catch { return false; }
  return true;
}
