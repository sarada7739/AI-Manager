import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// ESM では __dirname が使えないため import.meta.url から組み立てる
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(rootDir, "src/client"),
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4317",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.join(rootDir, "dist/client"),
    emptyOutDir: true,
  },
});
