import { defineConfig } from "vitest/config";

// Separate config: inactive prepared appointment-checkout core only (not part of src/).
export default defineConfig({
  test: { environment: "node", include: ["tests/appointment-checkout/**/*.test.ts"] },
});
