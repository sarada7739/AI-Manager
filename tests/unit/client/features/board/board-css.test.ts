// T-023 受け入れ条件（ボード CSS）:
// 「BoardColumn.module.css に var(--column-width)」
// 「ColumnHeader.module.css に position: sticky と var(--color-signal)」
// 「SessionCard.module.css に var(--card-accent-width)」
// トークン外の値が無いことの検査は tests/unit/client/app-css-tokens.test.ts が
// src/client/features/**/*.module.css を再帰的に走査しており board/ も対象に含むため、ここでは重複させない。
// node 環境・ファイル読み取りベース（jsdom 不要）。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const BOARD_COLUMN_CSS_PATH = path.join(
  ROOT,
  "src",
  "client",
  "features",
  "board",
  "BoardColumn.module.css",
);
const COLUMN_HEADER_CSS_PATH = path.join(
  ROOT,
  "src",
  "client",
  "features",
  "board",
  "ColumnHeader.module.css",
);
const SESSION_CARD_CSS_PATH = path.join(
  ROOT,
  "src",
  "client",
  "features",
  "board",
  "SessionCard.module.css",
);

function readText(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

describe("BoardColumn.module.css が DESIGN.md §5.1 の列幅ルールを守っている", () => {
  it("var(--column-width) を含む", () => {
    const css = readText(BOARD_COLUMN_CSS_PATH);
    expect(css).toMatch(/var\(--column-width\)/);
  });

  it(".column の width に var(--column-width) が指定されている", () => {
    const css = readText(BOARD_COLUMN_CSS_PATH);
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const columnRuleMatch = withoutComments.match(/\.column\s*\{[^}]*\}/);
    expect(columnRuleMatch).not.toBeNull();
    expect(columnRuleMatch?.[0]).toMatch(/width:\s*var\(--column-width\)/);
  });
});

describe("ColumnHeader.module.css が DESIGN.md §6.2 の固定・稼働列ルールを守っている", () => {
  it("position: sticky を含む", () => {
    const css = readText(COLUMN_HEADER_CSS_PATH);
    expect(css).toMatch(/position:\s*sticky/);
  });

  it(".header に position: sticky と top: 0 が指定されている", () => {
    const css = readText(COLUMN_HEADER_CSS_PATH);
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const headerRuleMatch = withoutComments.match(/\.header\s*\{[^}]*\}/);
    expect(headerRuleMatch).not.toBeNull();
    const rule = headerRuleMatch?.[0] ?? "";
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/top:\s*0/);
  });

  it("var(--color-signal) を含む（稼働セッションを含む列の下線色）", () => {
    const css = readText(COLUMN_HEADER_CSS_PATH);
    expect(css).toMatch(/var\(--color-signal\)/);
  });

  it('data-has-running="true" のルールで border-bottom に var(--color-signal) が指定されている', () => {
    const css = readText(COLUMN_HEADER_CSS_PATH);
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const runningRuleMatch = withoutComments.match(
      /\.header\[data-has-running=["']true["']\]\s*\{[^}]*\}/,
    );
    expect(runningRuleMatch).not.toBeNull();
    expect(runningRuleMatch?.[0]).toMatch(/border-bottom:[^;]*var\(--color-signal\)/);
  });
});

describe("SessionCard.module.css が DESIGN.md §6.1 のアクセントバーの幅ルールを守っている", () => {
  it("var(--card-accent-width) を含む", () => {
    const css = readText(SESSION_CARD_CSS_PATH);
    expect(css).toMatch(/var\(--card-accent-width\)/);
  });

  it(".card の border-left に var(--card-accent-width) が指定されている", () => {
    const css = readText(SESSION_CARD_CSS_PATH);
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const cardRuleMatch = withoutComments.match(/\.card\s*\{[^}]*\}/);
    expect(cardRuleMatch).not.toBeNull();
    expect(cardRuleMatch?.[0]).toMatch(/border-left:[^;]*var\(--card-accent-width\)/);
  });

  // レビュー指摘（REQUEST_CHANGES）: 選択中カードは左辺（稼働中/作業中のアクセントバー色）も
  // --color-border-strong で上書きする。
  it('data-selected="true" のルールで border-left-color にも var(--color-border-strong) が指定されている（選択時は左辺のアクセント色も上書きする）', () => {
    const css = readText(SESSION_CARD_CSS_PATH);
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectedRuleMatch = withoutComments.match(
      /\.card\[data-selected=["']true["']\]\s*\{[^}]*\}/,
    );
    expect(selectedRuleMatch).not.toBeNull();
    expect(selectedRuleMatch?.[0]).toMatch(/border-left-color:\s*var\(--color-border-strong\)/);
  });
});
