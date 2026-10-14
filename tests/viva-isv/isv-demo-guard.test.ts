import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { authorizeDemoActor, orderSwitchOn, idempotencyDecision, aalFromJwt, activeAttempt, ISV_DEMO_COMMISSION_SOURCE } from "../../supabase/functions/_shared/isvDemoGuard";
import { marginDecisionWithIsv } from "../../supabase/functions/_shared/platformMargin";

const jwt = (p: object) => `x.${btoa(JSON.stringify(p)).replace(/=+$/, "")}.y`;

describe("ISV demo route guard", () => {
  it("only platform owner with aal2", () => {
    expect(authorizeDemoActor({ userId: null, isPlatformOwner: false, aal: null })).toBe("unauthenticated");
    expect(authorizeDemoActor({ userId: "salon-owner", isPlatformOwner: false, aal: "aal2" })).toBe("forbidden");
    expect(authorizeDemoActor({ userId: "o", isPlatformOwner: true, aal: "aal1" })).toBe("mfa_required");
    expect(authorizeDemoActor({ userId: "o", isPlatformOwner: true, aal: null })).toBe("mfa_required");
    expect(authorizeDemoActor({ userId: "o", isPlatformOwner: true, aal: "aal2" })).toBe("ok");
  });
  it("switch is off unless exactly 'true'", () => {
    expect(orderSwitchOn({})).toBe(false);
    expect(orderSwitchOn({ VIVA_ISV_DEMO_ENABLED: "1" })).toBe(false);
    expect(orderSwitchOn({ VIVA_ISV_DEMO_ENABLED: "TRUE" })).toBe(false);
    expect(orderSwitchOn({ VIVA_ISV_DEMO_ENABLED: "true" })).toBe(true);
  });
  it("repeat request never creates a second order", () => {
    expect(idempotencyDecision(null)).toBe("create");
    expect(idempotencyDecision({ id: "p", status: "pending", orderCode: "123" })).toBe("return_existing");
    expect(idempotencyDecision({ id: "p", status: "pending", orderCode: null })).toBe("stuck_needs_review");
    expect(idempotencyDecision({ id: "p", status: "failed", orderCode: null })).toBe("stuck_needs_review");
  });
  it("commission source is allowed by the database check and used by the route", () => {
    expect(["route", "viva_webhook", "viva_report", "legacy_backfill"]).toContain(ISV_DEMO_COMMISSION_SOURCE);
    const src = readFileSync("supabase/functions/viva-isv-demo-order/index.ts", "utf8");
    expect(src).not.toContain("isv_demo_route");
    expect(src).toContain("_source: ISV_DEMO_COMMISSION_SOURCE");
    expect(src.indexOf("record_platform_commission")).toBeLessThan(src.indexOf("demo-accounts.vivapayments.com"));
  });
  it("failed-before-Viva record is history only; other failures still block", () => {
    const pre = { id: "old", status: "failed", orderCode: null, failureReason: "expected_fee_not_recorded" };
    expect(idempotencyDecision(activeAttempt([pre]))).toBe("create");
    const net = { id: "n", status: "failed", orderCode: null, failureReason: "isv_order_failed_network" };
    expect(idempotencyDecision(activeAttempt([pre, net]))).toBe("stuck_needs_review");
    expect(idempotencyDecision(activeAttempt([{ id: "x", status: "pending", orderCode: null, failureReason: null }]))).toBe("stuck_needs_review");
  });
  it("reads aal claim", () => {
    expect(aalFromJwt(jwt({ aal: "aal2" }))).toBe("aal2");
    expect(aalFromJwt("garbage")).toBe(null);
  });
  it("normal payment keeps €0,30 margin, trusted ISV payment gets none", () => {
    const i = { isDemo: false, isPaid: true, txVerified: true, meta: {} };
    expect(marginDecisionWithIsv(i, false)).toBe("record");
    expect(marginDecisionWithIsv(i, true)).toBe("not_applicable");
  });
  it("route checks auth and switch before any write or Viva call", () => {
    const src = readFileSync("supabase/functions/viva-isv-demo-order/index.ts", "utf8");
    const sw = src.indexOf("orderSwitchOn(env)");
    expect(sw).toBeGreaterThan(src.indexOf("authorizeDemoActor("));
    expect(sw).toBeLessThan(src.indexOf('.insert('));
    expect(sw).toBeLessThan(src.indexOf("fetch("));
    expect(src).not.toMatch(/await req\.json\(\)/); // browser input ignored
  });
  it("webhook 1799 still returns before any payment change", () => {
    const src = readFileSync("supabase/functions/viva-webhook/index.ts", "utf8");
    const i1799 = src.indexOf("if (eventTypeId === 1799)");
    expect(i1799).toBeGreaterThan(0);
    expect(i1799).toBeLessThan(src.indexOf("recordMargin("));
    expect(i1799).toBeLessThan(src.indexOf('.from("payments")'));
  });
});
