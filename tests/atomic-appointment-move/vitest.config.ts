import { defineConfig } from "vitest/config";

// Separate config: these tests cover the inactive prepared adapter only (not part of src/).
export default defineConfig({
  test: { environment: "node", include: ["tests/atomic-appointment-move/**/*.test.ts"] },
});
