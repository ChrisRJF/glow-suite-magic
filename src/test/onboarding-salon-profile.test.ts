import { describe, expect, it } from "vitest";
import { buildSettingsPayload, isOwnSalonLogoUrl, SETTINGS_SALON_PROFILE_COLUMNS_ENABLED } from "@/lib/onboardingSalonProfile";
import { OnboardingSaveError, describeOnboardingSaveError } from "@/lib/onboardingSaveError";

const base = "https://fictief.example.invalid";
const own = `${base}/storage/v1/object/public/salon-logos/user-a/logo-123.png`;
const input = { name: "Fictief", salonType: "kapper", logoUrl: own, userId: "user-a", supabaseUrl: base };

describe("onboarding salontype/logo opslag", () => {
  it("gate staat aan na activatie: type en eigen logo worden meegestuurd", () => {
    expect(SETTINGS_SALON_PROFILE_COLUMNS_ENABLED).toBe(true);
    expect(buildSettingsPayload(input)).toEqual({
      payload: { salon_name: "Fictief", salon_type: "kapper", salon_logo_url: own }, persistedExtras: true,
    });
  });
  it("met gate aan worden type en eigen logo opgeslagen", () => {
    expect(buildSettingsPayload(input, true)).toEqual({
      payload: { salon_name: "Fictief", salon_type: "kapper", salon_logo_url: own }, persistedExtras: true,
    });
  });
  it("logo van een ander account wordt nooit geschreven", () => {
    const other = own.replace("user-a", "user-b");
    expect(isOwnSalonLogoUrl(other, "user-a", base)).toBe(false);
    expect(buildSettingsPayload({ ...input, logoUrl: other }, true).payload).not.toHaveProperty("salon_logo_url");
  });
  it("weigert externe, blob- en padtraversal-URL's en onbekend type", () => {
    for (const u of ["https://evil.invalid/x.png", "blob:abc", `${base}/storage/v1/object/public/salon-logos/user-a/../user-b/logo-1.png`])
      expect(isOwnSalonLogoUrl(u, "user-a", base)).toBe(false);
    expect(buildSettingsPayload({ ...input, salonType: "hack" }, true).payload).not.toHaveProperty("salon_type");
  });
  it("ontbrekende kolom (PGRST204) geeft heldere melding", () => {
    expect(describeOnboardingSaveError(new OnboardingSaveError("settings_update", { code: "PGRST204" })))
      .toContain("bestaat nog niet in de database");
  });
});
