import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/viva-isv/**/*.test.ts"] },
});
