import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { routePayment } from "../../supabase/functions/_shared/paymentProviderRoute";

describe("routePayment (fictitious settings)", () => {
  it("denies when the settings query fails", () => {
    expect(routePayment({ settingsError: true, settings: { payment_provider: "mollie" } }))
      .toEqual({ kind: "deny", reason: "provider_unresolved" });
  });

  it("denies when no settings row exists", () => {
    expect(routePayment({ settingsError: false, settings: null }))
      .toEqual({ kind: "deny", reason: "provider_unresolved" });
  });

  it("denies an unknown or missing provider (never defaults to Mollie)", () => {
    expect(routePayment({ settingsError: false, settings: {} }).kind).toBe("deny");
    expect(routePayment({ settingsError: false, settings: { payment_provider: "stripe" } }).kind).toBe("deny");
    expect(routePayment({ settingsError: false, settings: { payment_provider: null } }).kind).toBe("deny");
  });

  it("routes explicit viva to Viva", () => {
    expect(routePayment({ settingsError: false, settings: { payment_provider: "viva" } }))
      .toEqual({ kind: "viva" });
  });

  it("keeps the explicit legacy Mollie route", () => {
    expect(routePayment({ settingsError: false, settings: { payment_provider: "mollie" } }))
      .toEqual({ kind: "mollie" });
  });

  it("denies test_button for a Viva account and allows it for Mollie", () => {
    expect(routePayment({ settingsError: false, settings: { payment_provider: "viva" }, source: "test_button" }))
      .toEqual({ kind: "deny", reason: "test_button_not_available" });
    expect(routePayment({ settingsError: false, settings: { payment_provider: "mollie" }, source: "test_button" }))
      .toEqual({ kind: "mollie" });
  });
});

describe("create-payment source", () => {
  const src = readFileSync("supabase/functions/create-payment/index.ts", "utf8");

  it("never falls back to Mollie on a Viva failure", () => {
    expect(src).not.toContain("payment_provider_fallback_enabled)");
    expect(src).not.toContain("falling back to Mollie");
    expect(src).toContain('fallbackAvailable: false');
  });

  it("uses the fail-closed router", () => {
    expect(src).toContain("routePayment(");
    expect(src).not.toContain('payment_provider as string) || "mollie"');
  });
});

describe("InstellingenPage payment UI", () => {
  const src = readFileSync("src/pages/InstellingenPage.tsx", "utf8");

  it("has no salon-visible Mollie provider choice, status tag, or Connect card", () => {
    expect(src).not.toContain("Mollie Connect");
    expect(src).not.toContain("Fallback actief");
    expect(src).not.toContain("Koppel Mollie");
    expect(src).not.toContain("Automatisch terugvallen op Mollie");
  });

  it("defaults only brand-new settings rows to viva and never touches existing rows", () => {
    expect(src).toContain("GlowPay gebruikt Viva voor betalingen. Activatie volgt na verificatie bij Viva.");
    // provider fields appear only inside the insert() branch for new rows
    expect(src).toContain("await insert({ ...data, payment_provider: 'viva', payment_provider_fallback_enabled: false })");
    // the shared payload used by update() must not carry provider fields
    const payload = src.slice(src.indexOf("const data: Record<string, any> = {"), src.indexOf("if (settings.length > 0)"));
    expect(payload).not.toContain("payment_provider");
    expect(src).toContain("await update(settings[0].id, data)");
  });
});
