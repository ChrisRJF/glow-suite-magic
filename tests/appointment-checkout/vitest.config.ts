import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "../../src") } },
  test: { environment: "node", include: ["tests/appointment-checkout/**/*.test.ts"], env: { VITE_SUPABASE_URL: "http://localhost", VITE_SUPABASE_PUBLISHABLE_KEY: "x" } },
});
