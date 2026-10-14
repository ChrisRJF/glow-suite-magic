// Synthetic tests for the step 2 margin switch (webhook + auto revenue). No network, no DB.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { marginDecision, recordMargin, dedupeDecision, type RpcFn } from "../../supabase/functions/_shared/platformMargin.ts";

const webhook = readFileSync("supabase/functions/viva-webhook/index.ts", "utf8");
const autoRev = readFileSync("supabase/functions/create-auto-revenue-payment/index.ts", "utf8");

// Fake RPC with the same idempotency as record_platform_commission (unique payment+kind+ref).
function fakeRpc(fail = false) {
  const rows = new Map<string, number>();
  const rpc: RpcFn = async (_fn, a) => {
    if (fail) return { data: null, error: { message: "boom" } };
    const k = `${a._payment_id}|${a._kind}|${a._provider_reference}`;
    if (rows.has(k)) return { data: rows.get(k) === a._amount_cents ? "duplicate" : null, error: rows.get(k) === a._amount_cents ? null : { message: "commission_conflict" } };
    rows.set(k, a._amount_cents as number);
    return { data: "inserted", error: null };
  };
  return { rpc, rows };
}

describe("margin decision", () => {
  it("verified paid payment records the margin", () =>
    expect(marginDecision({ isDemo: false, isPaid: true, txVerified: true, meta: {} })).toBe("record"));
  it("no commission for failed or unconfirmed payments", () => {
    expect(marginDecision({ isDemo: false, isPaid: false, txVerified: true, meta: {} })).toBe("not_applicable");
    expect(marginDecision({ isDemo: false, isPaid: true, txVerified: false, meta: {} })).toBe("skip_unverified");
  });
  it("demo payments never get a margin", () =>
    expect(marginDecision({ isDemo: true, isPaid: true, txVerified: true, meta: {} })).toBe("not_applicable"));
  it("payment already counted by the old webhook is not counted again", () =>
    expect(marginDecision({ isDemo: false, isPaid: true, txVerified: true, meta: { glowpay_margin_cents: 30, platform_fee_cents: 30 } })).toBe("legacy_already_stored"));
  it("pre-switch auto revenue link (platform_fee_cents only) gets exactly one new margin, not taken from metadata", () =>
    expect(marginDecision({ isDemo: false, isPaid: true, txVerified: true, meta: { platform_fee_cents: 999 } })).toBe("record"));
});

describe("margin registration", () => {
  it("successful payment: one commission of 30 cents", async () => {
    const f = fakeRpc();
    expect(await recordMargin(f.rpc, "p1")).toEqual({ ok: true, result: "inserted" });
    expect([...f.rows.values()]).toEqual([30]);
  });
  it("duplicate webhook: still one commission", async () => {
    const f = fakeRpc();
    await recordMargin(f.rpc, "p1");
    expect(await recordMargin(f.rpc, "p1")).toEqual({ ok: true, result: "duplicate" });
    expect(f.rows.size).toBe(1);
  });
  it("storage failure is reported, never silently ok", async () => {
    expect((await recordMargin(fakeRpc(true).rpc, "p1")).ok).toBe(false);
    expect((await recordMargin(async () => { throw new Error("x"); }, "p1")).ok).toBe(false);
    expect((await recordMargin(async () => ({ data: "weird", error: null }), "p1")).ok).toBe(false);
  });
  it("failed then retried: exactly one commission", async () => {
    const f = fakeRpc();
    let first = true;
    const flaky: RpcFn = (fn, a) => { if (first) { first = false; return Promise.resolve({ data: null, error: { message: "t" } }); } return f.rpc(fn, a); };
    expect((await recordMargin(flaky, "p1")).ok).toBe(false);
    expect((await recordMargin(flaky, "p1")).ok).toBe(true);
    expect(await recordMargin(flaky, "p1")).toEqual({ ok: true, result: "duplicate" });
    expect(f.rows.size).toBe(1);
  });
});

describe("redelivery", () => {
  it("fully processed event is skipped, unfinished event is reprocessed", () => {
    expect(dedupeDecision({ processed: true })).toBe("skip");
    expect(dedupeDecision({ processed: false })).toBe("reprocess");
    expect(dedupeDecision(null)).toBe("skip");
  });
});

describe("active webhook wiring", () => {
  const idx = (s: string) => webhook.indexOf(s);
  it("no new margin written into payments.metadata", () => {
    expect(webhook).not.toMatch(/metaUpdates\.(platform_fee_cents|glowpay_margin_cents)\s*=/);
    expect(webhook).not.toContain("GLOWPAY_MARGIN_CENTS");
  });
  it("margin recorded before the payment status update; failure returns retry before any change", () => {
    const rec = webhook.indexOf("const mr = await recordMargin", idx("const metaUpdates"));
    expect(rec).toBeGreaterThan(0);
    expect(rec).toBeLessThan(idx('.from("payments")\n      .update({\n        status: targetStatus'));
    expect(webhook.slice(rec, rec + 500)).toContain('error: "commission_failed"');
    expect(webhook.slice(rec, rec + 500)).toContain("return retryResponse()");
  });
  it("unverified paid keeps the event open (retry) only after all existing effects ran", () => {
    expect(idx("if (marginPending)")).toBeGreaterThan(idx("WhatsApp dispatch (viva webhook) error"));
  });
  it("1799 guard still runs before any margin or payment logic", () => {
    const g = idx("if (eventTypeId === 1799)");
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(idx("recordMargin(rpcOf"));
    expect(g).toBeLessThan(idx("canTransition(currentStatus"));
  });
  it("paid->paid redelivery only catches up the margin, no status change", () => {
    const noop = webhook.slice(idx("if (!canTransition(currentStatus, targetStatus))"), idx("const isPaid = targetStatus"));
    expect(noop).toContain("recordMargin");
    expect(noop).not.toMatch(/from\("payments"\)\s*\.update|from\("appointments"\)|payment_ledger|applyEvidence/);
  });
  it("1796/1797/1798 mapping unchanged", () => {
    expect(webhook).toMatch(/eventTypeId === 1799\) return "pending"/);
    expect(webhook).toMatch(/1798/);
  });
});

describe("auto revenue route", () => {
  it("no platform margin in metadata or browser responses", () => {
    expect(autoRev).not.toContain("platform_fee_cents");
  });
  it("amounts and payment links unchanged (total still deposit + fee)", () => {
    expect(autoRev).toContain("const totalCents = depositCents + PLATFORM_FEE_CENTS;");
    expect(autoRev).toContain("total_amount_cents: totalCents");
  });
  it("does not register a commission itself (webhook is the only source)", () => {
    expect(autoRev).not.toContain("record_platform_commission");
  });
});
