import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

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
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: "client",
          environment: "jsdom",
          include: ["src/client/**/*.test.tsx", "tests/**/*.test.tsx"],
        },
      },
    ],
  },
});
