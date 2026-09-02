import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// T-001: プロジェクト初期化の受け入れ条件が壊れたら落ちるテスト。
// CLAUDE.md §2（品質ゲートの唯一の参照先）と DoD の契約を検証する。

const ROOT = process.cwd();

function readJson(relativePath: string): unknown {
  const raw = readFileSync(path.join(ROOT, relativePath), "utf-8");
  return JSON.parse(raw);
}

function readText(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf-8");
}

describe("package.json の scripts 契約", () => {
  const pkg = readJson("package.json") as {
    scripts?: Record<string, string>;
  };

  const requiredScripts = [
    "dev",
    "dev:server",
    "dev:client",
    "typecheck",
    "lint",
    "lint:fix",
    "test",
    "test:watch",
    "e2e",
    "build",
    "gate",
  ];

  it.each(requiredScripts)('scripts に "%s" が定義されている', (key) => {
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts?.[key]).toEqual(expect.any(String));
    expect(pkg.scripts?.[key]?.length).toBeGreaterThan(0);
  });

  it("gate は typecheck → lint → test → build の順で並ぶ", () => {
    const gate = pkg.scripts?.gate ?? "";
    const order = ["typecheck", "lint", "test", "build"];
    const indices = order.map((step) => {
      const idx = gate.indexOf(step);
      expect(idx, `gate スクリプトに "${step}" が含まれていない: ${gate}`).toBeGreaterThanOrEqual(
        0,
      );
      return idx;
    });
    const sorted = [...indices].sort((a, b) => a - b);
    expect(
      indices,
      `gate の実行順が typecheck → lint → test → build になっていない: ${gate}`,
    ).toEqual(sorted);
  });
});

describe("tsconfig.json の strict 契約", () => {
  const tsconfig = readJson("tsconfig.json") as {
    compilerOptions?: Record<string, unknown>;
  };

  it("compilerOptions.strict が true", () => {
    expect(tsconfig.compilerOptions?.strict).toBe(true);
  });

  it("compilerOptions.noUncheckedIndexedAccess が true", () => {
    expect(tsconfig.compilerOptions?.noUncheckedIndexedAccess).toBe(true);
  });
});

describe("vite.config.ts の /api プロキシ契約", () => {
  const viteConfig = readText("vite.config.ts");

  it("/api のプロキシ設定を含む", () => {
    expect(viteConfig).toContain("/api");
  });

  it("プロキシ先が 127.0.0.1:4317 を含む", () => {
    expect(viteConfig).toContain("127.0.0.1:4317");
  });
});
