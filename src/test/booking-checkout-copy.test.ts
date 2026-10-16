import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import nl from "@/i18n/locales/nl.json";
import en from "@/i18n/locales/en.json";
import de from "@/i18n/locales/de.json";
import fr from "@/i18n/locales/fr.json";
import es from "@/i18n/locales/es.json";

const locales = { nl, en, de, fr, es } as Record<string, any>;

describe("public checkout copy", () => {
  for (const [lang, l] of Object.entries(locales)) {
    it(`${lang}: payment copy never names Mollie or claims 100% safety`, () => {
      const pay = JSON.stringify(l.booking.payment);
      expect(pay).not.toMatch(/mollie/i);
      expect(pay).not.toMatch(/100\s?%/);
      expect(pay).toMatch(/GlowPay/);
      expect(l.booking.payment.demoNoCharge).toBeTruthy();
    });
  }
  it("booking page shows no hardcoded Mollie badge or method selectors", () => {
    const src = readFileSync("src/pages/BookingPage.tsx", "utf8");
    expect(src).not.toMatch(/Mollie/);
    expect(src).not.toMatch(/PaymentMethodLogo/);
    expect(src).not.toMatch(/booking\.payment\.instantConfirm/);
  });
});
