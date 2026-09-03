// T-021 受け入れ条件（FilterBar CSS）: 「position: sticky」。
// トークン外の値が無いことの検査は tests/unit/client/app-css-tokens.test.ts が
// src/client/features/**/*.module.css を再帰的に走査しており filters/ も対象に含むため、ここでは重複させない。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const FILTER_BAR_CSS_PATH = path.join(
  ROOT,
  "src",
  "client",
  "features",
  "filters",
  "FilterBar.module.css",
);

function readText(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

describe("FilterBar.module.css が DESIGN.md §5.1 の sticky ルールを守っている", () => {
  it("position: sticky を含む", () => {
    const css = readText(FILTER_BAR_CSS_PATH);
    expect(css).toMatch(/position:\s*sticky/);
  });

  it("sticky なセレクタに top: 0 が指定されている", () => {
    const css = readText(FILTER_BAR_CSS_PATH);
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const stickyRuleMatch = withoutComments.match(/\.filterBar\s*\{[^}]*\}/);
    expect(stickyRuleMatch).not.toBeNull();
    const stickyRule = stickyRuleMatch?.[0] ?? "";
    expect(stickyRule).toMatch(/position:\s*sticky/);
    expect(stickyRule).toMatch(/top:\s*0/);
  });

  // レビュー指摘（BLOCKING）の回帰テスト。実装反映前に走らせると失敗しうる。
  it("outline: none が含まれない（:focus-visible は border-color のみで示す。BLOCKING 回帰）", () => {
    const css = readText(FILTER_BAR_CSS_PATH);
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/outline\s*:\s*none/);
  });

  it("::placeholder に --color-text-muted が使われている（BLOCKING 回帰）", () => {
    const css = readText(FILTER_BAR_CSS_PATH);
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const placeholderRuleMatch = withoutComments.match(/::placeholder\s*\{[^}]*\}/);
    expect(placeholderRuleMatch).not.toBeNull();
    const placeholderRule = placeholderRuleMatch?.[0] ?? "";
    expect(placeholderRule).toMatch(/var\(--color-text-muted\)/);
  });
});
