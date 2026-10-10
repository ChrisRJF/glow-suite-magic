import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";
export default defineConfig({
  root: "/tmp/browser/dnd",
  plugins: [react()],
  css: { postcss: { plugins: [tailwind({ config: "/dev-server/tailwind.config.ts", content: ["/dev-server/src/**/*.{ts,tsx}", "/tmp/browser/dnd/main.tsx"] }), autoprefixer()] } },
  resolve: { alias: { "@": "/dev-server/src" }, dedupe: ["react", "react-dom"] },
  server: { port: 5199, fs: { allow: ["/"] } },
});
