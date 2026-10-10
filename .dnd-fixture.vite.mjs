import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
export default defineConfig({ root: "/tmp/browser/dnd", plugins: [react()], resolve: { alias: { "@": "/dev-server/src" } }, server: { port: 5199, fs: { allow: ["/"] } } });
