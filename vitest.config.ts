import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// Vitest 4 では environmentMatchGlobs が廃止されたため、projects で環境を分ける。
// src/client/** と tests/**/*.tsx は jsdom、それ以外は node。
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "src/client/**"],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: "client",
          environment: "jsdom",
          setupFiles: ["tests/setup/jest-dom.ts"],
          include: ["src/client/**/*.test.{ts,tsx}", "tests/**/*.test.tsx"],
        },
      },
    ],
  },
});
