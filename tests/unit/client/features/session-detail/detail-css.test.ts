// T-025 受け入れ条件（DetailPanel の CSS）:
// 「DetailPanel が右側 --panel-width に開く」
// 「prefers-reduced-motion でパネル開閉のアニメーションが 0ms（tokens.css の --duration-* が
//   0 になることで担保。CSS がその変数を使っていることをテキストで検査）」
//
// トークン外の値が無いことの一般的な検査は tests/unit/client/app-css-tokens.test.ts が
// src/client/features/**/*.module.css を再帰的に走査しており session-detail/ も対象に含むため、
// ここでは var(--panel-width) / var(--duration-normal) の使用有無だけを固有条件として検査する。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DETAIL_PANEL_CSS_PATH = path.join(
  ROOT,
  "src",
  "client",
  "features",
  "session-detail",
  "DetailPanel.module.css",
);

function readText(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

describe("DetailPanel.module.css が DESIGN.md §5.3 / §4.4 のレイアウト・モーション規約を守っている", () => {
  it("var(--panel-width) を使っている（右側パネルの幅）", () => {
    const css = readText(DETAIL_PANEL_CSS_PATH);
    expect(css).toMatch(/var\(--panel-width\)/);
  });

  it("var(--duration-normal) を使っている（開閉アニメーションの時間。prefers-reduced-motion では tokens.css 側でこの変数自体が 0ms になる）", () => {
    const css = readText(DETAIL_PANEL_CSS_PATH);
    expect(css).toMatch(/var\(--duration-normal\)/);
  });
});
