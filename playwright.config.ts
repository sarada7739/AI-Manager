import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// ESM では __dirname が使えないため import.meta.url から組み立てる（vite.config.ts と同じ方法）。
const rootDir = path.dirname(fileURLToPath(import.meta.url));

// E2E 用の合成フィクスチャが読む config.json の絶対パス（build-fixtures.mjs が生成する）。
const E2E_CONFIG_PATH = path.resolve(rootDir, "local-data", "e2e", "config.json");

// T-026: 主要導線（ボード表示 → リスト切替 → 絞り込み → 詳細パネル）の E2E。
// サーバはフィクスチャ生成 → dev:server の順で起動し、クライアントは別プロセスの dev:client を使う。
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "list",
  workers: 1,
  use: {
    // クライアント（Vite dev server）はホスト未指定の既定設定で起動しており、この実行環境では
    // "localhost" が IPv6（::1）にしか bind されない（127.0.0.1 では ECONNREFUSED になることを
    // 実機で確認済み）。サーバ本体（webServer[0]）は明示的に 127.0.0.1 に bind するため、
    // そちらは 127.0.0.1 のままにする。
    baseURL: "http://localhost:5173",
  },
  webServer: [
    {
      command: "node e2e/setup/build-fixtures.mjs && pnpm dev:server",
      url: "http://127.0.0.1:4317/api/health",
      env: { AI_MANAGER_CONFIG_PATH: E2E_CONFIG_PATH },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm dev:client",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
