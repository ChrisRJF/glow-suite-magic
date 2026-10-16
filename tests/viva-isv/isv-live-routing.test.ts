import { describe, it, expect } from "vitest";
import { resolvePrivateIsvRoute, liveEventProcessed } from "../../supabase/functions/_shared/inactive/isvLiveRouting.ts";
import { fetchLiveIsvTransaction, parseLiveTransaction } from "../../supabase/functions/_shared/inactive/isvLiveConfirm.ts";
import { handleLivePaymentEvent, makeWebhookDeps } from "../../supabase/functions/_shared/inactive/isvLivePayments.ts";

const order = { payment_id: "p1", tenant_id: "t1", order_code: "1234567890", transaction_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", state: "ready" };
function storage(rows: Record<string, typeof order | null>, error = false) {
  return { from: () => ({ select: () => ({ eq: (col: string, value: string) => ({ maybeSingle: async () => ({ data: rows[`${col}:${value}`] ?? null, error }) }) }) }) };
}
describe("private order routing and safe holds", () => {
  it("private payment ID routes LIVE even if public route was deleted", async () => {
    expect(await resolvePrivateIsvRoute(storage({ "payment_id:p1": order }), { paymentId: "p1" })).toEqual({ kind: "live", order });
  });
  it("injecting public metadata cannot turn a non-private payment into LIVE", async () => {
    expect(await resolvePrivateIsvRoute(storage({}), { paymentId: "ordinary" })).toEqual({ kind: "legacy" });
  });
  it("private parent routes reversal without public metadata", async () => {
    expect(await resolvePrivateIsvRoute(storage({ [`transaction_id:${order.transaction_id}`]: order }), { parentId: order.transaction_id })).toEqual({ kind: "live", order });
  });
  it("conflicting references hold rather than pick a salon", async () => {
    expect(await resolvePrivateIsvRoute(storage({ "payment_id:p1": order, "order_code:999": { ...order, payment_id: "p2" } }), { paymentId: "p1", orderCode: "999" })).toEqual({ kind: "hold" });
  });
  it("private storage failure never falls back to legacy", async () => {
    expect(await resolvePrivateIsvRoute(storage({}, true), { paymentId: "p1" })).toEqual({ kind: "hold" });
  });
  it.each(["merchant_hold", "failed_mismatch_hold", "refund_on_unpaid_hold", "refund_mismatch_hold", "snapshot_missing_hold", "hold_amount_mismatch", "contract_unverified_hold", "live_disabled", "unknown", "not_live_isv_order"])("keeps %s retryable", (note) => {
    expect(liveEventProcessed({ status: 200, note })).toBe(false);
  });
  it.each(["paid", "already_processed", "refund_recorded", "refund_duplicate", "failed_recorded"])("closes proven %s", (note) => {
    expect(liveEventProcessed({ status: 200, note })).toBe(true);
    expect(liveEventProcessed({ status: 503, note })).toBe(false);
  });
});
describe("unverified contract is a production stop, not an amount guess", () => {
  it("no contract means no transaction request or conversion", async () => {
    const f = async () => { throw new Error("network must not run"); };
    expect(await fetchLiveIsvTransaction(() => "true", order.transaction_id, order.transaction_id, f)).toBeNull();
    expect(parseLiveTransaction({ amount: 25 }, order.transaction_id, null)).toBeNull();
  });
  it("production adapter cannot mark paid even if checkout is injected on", async () => {
    const admin = { from: () => { throw new Error("no database allowed"); }, rpc: () => { throw new Error("no write allowed"); } };
    const d = makeWebhookDeps(admin, () => "true", async () => { throw new Error("no provider request"); });
    d.enabled = true;
    expect(await handleLivePaymentEvent(1796, { OrderCode: order.order_code, TransactionId: order.transaction_id, Amount: 2500, StatusId: "F" }, d, "now")).toEqual({ status: 503, note: "contract_unverified_hold" });
  });
  it("requires returned transaction ID, never accepts missing ID", () => {
    expect(parseLiveTransaction({ amount: 25, merchantId: "m", statusId: "F", currencyCode: 978, orderCode: 123 }, order.transaction_id, { amountUnit: "major" })).toBeNull();
  });
  it("explicit synthetic minor contract never multiplies amount", () => {
    expect(parseLiveTransaction({ amount: 2500, transactionId: order.transaction_id, merchantId: "m", statusId: "F", currencyCode: 978, orderCode: 123 }, order.transaction_id, { amountUnit: "minor" })?.amountCents).toBe(2500);
  });
});