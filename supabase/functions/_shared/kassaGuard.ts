// Kassa-only helpers for the Viva status poll and webhook. Every non-Kassa payment skips these entirely.
import { applyEvidence } from "./providerLedger.ts";
import { makeLedgerDeps } from "./checkoutGuard.ts";
import { afterProviderEvent } from "./kassaRoute.ts";

export function isKassaPayment(meta: unknown): boolean {
  return !!meta && typeof meta === "object" && typeof (meta as Record<string, unknown>).kassa_order_id === "string";
}

type Final = "paid" | "failed" | "cancelled" | "expired" | null;

/** Records Viva-verified money in the ledger, then settles (exactly once) or closes the attempt. Never throws. */
export async function processKassaEvent(admin: any, p: { id: string; user_id: string }, final: Final,
  evidence: { transactionId: string | null; amountCents: number | null; source: "poll" | "webhook" } | null): Promise<string> {
  try {
    if (final === "paid") {
      if (evidence && evidence.transactionId && Number.isInteger(evidence.amountCents)) {
        await applyEvidence({ tenantId: p.user_id, paymentId: p.id, provider: "viva", transactionId: evidence.transactionId,
          kind: "payment", amountCents: evidence.amountCents as number, currency: "EUR", source: evidence.source }, null, makeLedgerDeps(admin));
      }
      // Settlement itself requires ledger evidence; without it this returns no_evidence and nothing changes.
    }
    return await afterProviderEvent(p.id, final, async (fn, args) => {
      const r = await admin.rpc(fn, args);
      return r.error ? null : (r.data as string);
    });
  } catch {
    return "error";
  }
}
