import { describe, expect, it } from "vitest";
import { isPreviewHost } from "@/components/IsvDemoOrderButton";

const projectId = "2c24cef4-6f68-433a-8f47-8a26e80779d7";

describe("temporary ISV button preview boundary", () => {
  it.each([
    "localhost",
    `id-preview--${projectId}.lovable.app`,
    `id-preview-dev--${projectId}.lovable.app`,
    `project--${projectId}.lovableproject.com`,
    `${projectId}.lovableproject-dev.com`,
    `${projectId}-dev.gpt-eng.com`,
  ])("recognises the project preview %s", (hostname) => {
    expect(isPreviewHost(hostname)).toBe(true);
  });

  it.each([
    "glow-suite-magic.lovable.app",
    "glowsuite.nl",
    "www.glowsuite.nl",
    `id-preview--${projectId}.lovable.app.example.com`,
    "project--00000000-0000-4000-8000-000000000000.lovable.app",
  ])("keeps the button off non-project-preview hosts %s", (hostname) => {
    expect(isPreviewHost(hostname)).toBe(false);
  });
});