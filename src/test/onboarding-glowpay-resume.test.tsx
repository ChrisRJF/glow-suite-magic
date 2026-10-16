import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
describe("GlowPay resume entry", () => {
  it("wizard supports starting at GlowPay step index 2 without finishing", () => {
    const src = readFileSync("src/components/OnboardingWizard.tsx", "utf8");
    expect(src).toMatch(/startAtGlowPay \? \{ \.\.\.base, step: 2, postWelcome: false \}/);
  });
});
