import { describe, it, expect } from "vitest";
import {
  expectedIsvFeeCents, buildIsvPaymentRow, applyOrderResult, findReusable, decideIsvWebhook,
  toSalonPaymentView, canReadPlatformFinance, aggregate, type PaymentState, type WebhookInput,
} from "../../supabase/functions/_shared/inactive/isvFinance";

const A = "tenant-a", B = "tenant-b";
const merchantA = { user_id: A, viva_merchant_id: "m-a", viva_source_code: "src-a", onboarding_status: "active", is_demo: true };
const pay = (o: Partial<PaymentState> = {}): PaymentState => ({ id: "p1", user_id: A, viva_merchant_id: "m-a", status: "pending", amountCents: 100, refundedCents: 0, metadata: { payment_kind: "isv", isv_fee_expected_cents: 35 }, ...o });
const ev = (o: Partial<WebhookInput> = {}): WebhookInput => ({ eventTypeId: 1796, statusId: "F", orderCode: "1", merchantId: "m-a", verifiedByVivaApi: true, verifiedAmountCents: 100, alreadyProcessedEventId: false, ...o });

describe("commission", () => {
  it("1 online 35 cent", () => expect(expectedIsvFeeCents("online", 100)).toBe(35));
  it("2 terminal 1.5%", () => expect(expectedIsvFeeCents("terminal", 10000)).toBe(150));
  it("3 rounding half-up", () => { expect(expectedIsvFeeCents("terminal", 1033)).toBe(15); expect(expectedIsvFeeCents("terminal", 1034)).toBe(16); expect(expectedIsvFeeCents("terminal", 1)).toBe(0); });
  it("4 no extra 0.30 margin on paid", () => {
    const d = decideIsvWebhook(ev(), pay());
    expect(d.action === "update" && d.patch.metadata.platform_fee_cents).toBe(35);
    expect(d.action === "update" && d.patch.metadata.legacy_margin_applied).toBe(false);
  });
});

describe("registration", () => {
  it("5 tenant from session, merchant must belong to it", () => {
    expect(buildIsvPaymentRow({ sessionTenantId: B, merchant: merchantA, channel: "online", amountCents: 100, idempotencyKey: "key-12345" })).toEqual({ ok: false, error: "merchant_tenant_mismatch" });
    const r = buildIsvPaymentRow({ sessionTenantId: A, merchant: merchantA, channel: "online", amountCents: 100, idempotencyKey: "key-12345" });
    expect(r.ok && r.row.user_id).toBe(A);
    expect(r.ok && (r.row.metadata as any).isv_fee_expected_cents).toBe(35);
    expect(r.ok && r.row.checkout_reference).toBeNull();
  });
  it("6 idempotent reuse, failed order never paid", () => {
    const rows = [{ id: "x", status: "pending", metadata: { idempotency_key: "k1" } }];
    expect(findReusable(rows, "k1")?.id).toBe("x");
    expect(findReusable([{ ...rows[0], status: "failed" }], "k1")).toBeNull();
    expect(applyOrderResult({ status: "pending", metadata: {} }, { ok: false, httpStatus: 403 }).status).toBe("failed");
  });
  it("6b duplicate webhook does not double book", () => {
    expect(decideIsvWebhook(ev({ alreadyProcessedEventId: true }), pay()).action).toBe("ignore");
    expect(decideIsvWebhook(ev(), pay({ status: "paid" })).action).toBe("ignore");
  });
});

describe("webhook", () => {
  it("7 no mutation without Viva verification", () => expect(decideIsvWebhook(ev({ verifiedByVivaApi: false }), pay())).toEqual({ action: "log_only", reason: "unverified" }));
  it("7b amount or merchant mismatch logs only", () => {
    expect(decideIsvWebhook(ev({ verifiedAmountCents: 99 }), pay()).action).toBe("log_only");
    expect(decideIsvWebhook(ev({ merchantId: "m-b" }), pay()).action).toBe("log_only");
  });
  it("8 event 1799 never changes status, even with F", () => expect(decideIsvWebhook(ev({ eventTypeId: 1799 }), pay()).action).toBe("log_only"));
  it("9 refund: partial, full, capped, reversal unconfirmed", () => {
    const p = pay({ status: "paid", amountCents: 1000 });
    const d1 = decideIsvWebhook(ev({ eventTypeId: 1798, verifiedAmountCents: 400 }), p);
    expect(d1.action === "update" && d1.patch.status).toBe("partially_refunded");
    expect(d1.action === "update" && d1.patch.metadata.isv_fee_reversal_status).toBe("unconfirmed");
    const d2 = decideIsvWebhook(ev({ eventTypeId: 1798, verifiedAmountCents: 5000 }), { ...p, refundedCents: 400, status: "partially_refunded" });
    expect(d2.action === "update" && d2.patch.refundedCents).toBe(1000);
    expect(decideIsvWebhook(ev({ eventTypeId: 1798 }), pay()).action).toBe("log_only");
  });
  it("unknown transaction is never assigned to a tenant", () => expect(decideIsvWebhook(ev(), null)).toEqual({ action: "log_only", reason: "payment_not_found" }));
});

describe("separation and reporting", () => {
  const ledger = [
    { payment_id: "p1", tenant_id: A, kind: "payment" as const, amount_cents: 100, method: "online", day: "2026-10-14" },
    { payment_id: "p1", tenant_id: A, kind: "payment" as const, amount_cents: 100, method: "online", day: "2026-10-14" },
    { payment_id: "p2", tenant_id: B, kind: "payment" as const, amount_cents: 1000, method: "terminal", day: "2026-10-15" },
    { payment_id: "p2", tenant_id: B, kind: "refund" as const, amount_cents: 200, method: "terminal", day: "2026-10-15" },
  ];
  const payments = [pay({ status: "paid" }), pay({ id: "p2", user_id: B, status: "partially_refunded", metadata: { payment_kind: "isv", isv_fee_expected_cents: 15, isv_fee_confirmed_cents: 15 } })];
  it("10 no double counting", () => {
    const t = aggregate(ledger, payments);
    expect([t.grossCents, t.refundCents, t.netCents, t.successCount]).toEqual([1100, 200, 900, 2]);
    expect(aggregate(ledger, payments, { tenantId: A }).grossCents).toBe(100);
  });
  it("11 salon A cannot read salon B", () => expect(toSalonPaymentView(payments[1], A)).toBeNull());
  it("12 salon view has no platform commission", () => {
    const v = toSalonPaymentView({ ...payments[0], metadata: { payment_kind: "isv", platform_fee_cents: 35, isv_fee_expected_cents: 35, glowpay_margin_cents: 30 } }, A)!;
    expect(Object.keys(v.metadata)).toEqual(["payment_kind"]);
  });
  it("13 only MFA platform owner; salon owner never", () => {
    expect(canReadPlatformFinance({ userId: "u", isPlatformOwner: false, aal: "aal2", salonRoles: ["eigenaar", "admin"] })).toBe(false);
    expect(canReadPlatformFinance({ userId: "u", isPlatformOwner: true, aal: "aal1", salonRoles: [] })).toBe(false);
    expect(canReadPlatformFinance({ userId: "u", isPlatformOwner: true, aal: "aal2", salonRoles: [] })).toBe(true);
  });
  it("14 missing confirmation stays unconfirmed, not 0", () => {
    const t = aggregate(ledger, payments);
    expect(t.isvExpectedCents).toBe(50); expect(t.isvConfirmedCents).toBe(15);
    expect(t.isvUnconfirmedCount).toBe(1); expect(t.earnedStatus).toBe("partially_unconfirmed");
    const d = decideIsvWebhook(ev(), pay());
    expect(d.action === "update" && d.patch.metadata.isv_fee_status).toBe("unconfirmed");
    expect(d.action === "update" && "isv_fee_confirmed_cents" in d.patch.metadata).toBe(false);
  });
});
