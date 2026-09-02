import { defineConfig } from "@playwright/test";

// テスト本体は T-026 で追加する。ここでは実行の土台だけを用意する
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4317",
  },
});
