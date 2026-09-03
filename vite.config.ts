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
      // root が src/client のため、src/client/api/client.ts は Vite 上では /api/client.ts になる。
      // 前方一致の "/api" だとそのモジュール要求までサーバへ転送して 404 になるので、
      // ARCHITECTURE.md §5 の API パスだけを正規表現で転送する（T-026 で発覚）
      "^/api/(sessions|accounts|health|events|refresh)(?![A-Za-z0-9_.-])": {
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
