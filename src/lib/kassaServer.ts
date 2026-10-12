// Kassa via server orders (only when tenant_feature_flags.kassa_orders_enabled is on).
// Browser sends only item ids, quantities, customer id and demo choice; prices, total, salon and status come from the server.
import type { StorageLike } from "@/lib/kassaPending";

export type KassaLine = { type: "service" | "product"; item_id: string; qty: number };
export type KassaPhase = "idle" | "creating" | "starting" | "open" | "paid" | "failed" | "error";
export type KassaState = { phase: KassaPhase; orderId?: string; paymentId?: string; totalCents?: number; message?: string };

export type OrderResult = { ok: true; order_id: string; total_cents: number } | { ok: false; reason: string };
export type StartResult = { status: number; body: { payment_id?: string; error?: string; message?: string } };

export interface KassaServerDeps {
  createOrder(requestId: string, customerId: string | null, lines: KassaLine[], demo: boolean): Promise<OrderResult>;
  startPayment(orderId: string, terminalId: string): Promise<StartResult>;
  pollStatus(paymentId: string): Promise<string | null>;
}

export const ORDER_REASONS: Record<string, string> = {
  no_access: "Je hebt geen kassarechten in deze salon.",
  disabled: "De Kassa is voor deze salon nog niet geactiveerd.",
  live_not_allowed: "Live betalen is voor deze salon nog niet geactiveerd. Gebruik demo afrekenen.",
  customer_not_found: "Deze klant hoort niet bij deze salon.",
  item_not_found: "Een product of behandeling is niet (meer) beschikbaar.",
  invalid_total: "Het totaalbedrag is ongeldig.",
  conflict: "Deze bestelling is gewijzigd. Begin een nieuwe bestelling.",
  invalid: "Ongeldige bestelling.",
};

const storeKey = (userId: string) => `glowsuite.kassa.server.${userId}`;
type Saved = { requestId: string; fingerprint: string; orderId?: string; paymentId?: string };

export function fingerprint(customerId: string | null, lines: KassaLine[], demo: boolean): string {
  const l = [...lines].sort((a, b) => a.item_id.localeCompare(b.item_id)).map((x) => `${x.type}:${x.item_id}:${x.qty}`).join(",");
  return `${customerId ?? ""}|${demo}|${l}`;
}

export function loadSaved(s: StorageLike | null, userId: string): Saved | null {
  try { const v = s?.getItem(storeKey(userId)); return v ? (JSON.parse(v) as Saved) : null; } catch { return null; }
}
function save(s: StorageLike | null, userId: string, v: Saved | null): boolean {
  if (!s) return false;
  try { if (v) s.setItem(storeKey(userId), JSON.stringify(v)); else s.removeItem(storeKey(userId)); return true; } catch { return false; }
}
export const clearSaved = (s: StorageLike | null, userId: string) => save(s, userId, null);

const FINAL = new Set(["paid", "failed", "cancelled", "expired"]);

/** Starts (or resumes) one payment. Same cart = same request id = same server order = never a second payment. */
export async function payWithKassa(
  args: { storage: StorageLike | null; userId: string; customerId: string | null; lines: KassaLine[]; demo: boolean; terminalId: string },
  deps: KassaServerDeps, onState: (s: KassaState) => void, newId: () => string = () => crypto.randomUUID(),
): Promise<KassaState> {
  const fp = fingerprint(args.customerId, args.lines, args.demo);
  let saved = loadSaved(args.storage, args.userId);
  // An open payment is always resumed first (also after reload), whatever is in the cart now.
  if (!saved?.paymentId && (!saved || saved.fingerprint !== fp)) {
    saved = { requestId: newId(), fingerprint: fp };
    if (!save(args.storage, args.userId, saved)) { const s = { phase: "error" as const, message: "Betaling kan niet veilig worden voorbereid in deze browser." }; onState(s); return s; }
  }
  let paymentId = saved.paymentId;
  let st: KassaState = { phase: "creating" };
  if (!paymentId) {
    onState(st);
    const o = await deps.createOrder(saved.requestId, args.customerId, args.lines, args.demo).catch(() => null);
    if (!o || o.ok === false) { st = { phase: "error", message: o ? (ORDER_REASONS[o.reason] ?? "Bestelling kon niet worden gemaakt.") : "Geen verbinding. Probeer opnieuw; er wordt geen tweede bestelling gemaakt." }; onState(st); return st; }
    saved = { ...saved, orderId: o.order_id }; save(args.storage, args.userId, saved);
    st = { phase: "starting", orderId: o.order_id, totalCents: o.total_cents }; onState(st);
    const r = await deps.startPayment(o.order_id, args.terminalId).catch(() => null);
    if (!r || !r.body.payment_id) {
      st = { ...st, phase: "error", message: r?.body.message ?? "Onbekende uitkomst. Probeer opnieuw; er wordt geen tweede betaling gestart." }; onState(st); return st;
    }
    paymentId = r.body.payment_id;
    saved = { ...saved, paymentId }; save(args.storage, args.userId, saved);
  }
  st = { ...st, phase: "open", orderId: saved.orderId, paymentId }; onState(st);
  const status = await deps.pollStatus(paymentId).catch(() => null);
  if (status && FINAL.has(status)) {
    // A failed attempt may be retried: the server opens a new attempt for the same order.
    if (status === "paid") clearSaved(args.storage, args.userId); else save(args.storage, args.userId, { ...saved, paymentId: undefined });
    st = { ...st, phase: status === "paid" ? "paid" : "failed", message: status === "paid" ? undefined : "Betaling niet gelukt. Je kunt het opnieuw proberen." };
    onState(st);
  }
  return st;
}
