// Private server-only order records decide routing, never payments.metadata.
export type PrivateIsvOrder = { payment_id: string; tenant_id: string; order_code: string | null; transaction_id: string | null; state: string };
export type IsvRoute = { kind: "live"; order: PrivateIsvOrder } | { kind: "legacy" } | { kind: "hold" };
export async function resolvePrivateIsvRoute(admin: any, refs: { paymentId?: string | null; orderCode?: string | null; transactionId?: string | null; parentId?: string | null }): Promise<IsvRoute> {
  let found: PrivateIsvOrder | null = null;
  try {
    for (const [column, value] of [["payment_id", refs.paymentId], ["order_code", refs.orderCode], ["transaction_id", refs.transactionId], ["transaction_id", refs.parentId]]) {
      if (!value) continue;
      const r = await admin.from("isv_payment_orders").select("payment_id,tenant_id,order_code,transaction_id,state").eq(column, value).maybeSingle();
      if (r.error) return { kind: "hold" };
      if (!r.data) continue;
      if (found && found.payment_id !== r.data.payment_id) return { kind: "hold" };
      found = r.data;
    }
    return found ? { kind: "live", order: found } : { kind: "legacy" };
  } catch { return { kind: "hold" }; }
}

// An explicit success allowlist keeps every unknown/mismatch/hold retryable.
export function liveEventProcessed(result: { status: number; note: string }): boolean {
  return result.status === 200 && ["paid", "already_processed", "failed_recorded", "refund_recorded", "refund_duplicate", "ignored_event"].includes(result.note);
}