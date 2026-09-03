// T-024 受け入れ条件（リスト表示 CSS）:
// 「行高 --row-height」「ヘッダ帯は position: sticky で列内スクロール時も固定」
// 「選択行は背景 --color-surface-3」＋ REQUEST_CHANGES 対応: 選択行の左端バー
// （--card-accent-width）、tokens.css の --row-height と JS 定数 ROW_HEIGHT_PX の整合。
// トークン外の値が無いことの検査は tests/unit/client/app-css-tokens.test.ts が
// src/client/features/**/*.module.css を再帰的に走査しており list/ も対象に含むため、ここでは重複させない。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const LIST_ROW_CSS_PATH = path.join(
  ROOT,
  "src",
  "client",
  "features",
  "list",
  "ListRow.module.css",
);
const LIST_VIEW_CSS_PATH = path.join(
  ROOT,
  "src",
  "client",
  "features",
  "list",
  "ListView.module.css",
);
const LIST_VIEW_TSX_PATH = path.join(ROOT, "src", "client", "features", "list", "ListView.tsx");
const TOKENS_CSS_PATH = path.join(ROOT, "src", "client", "styles", "tokens.css");

function readText(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

describe("ListRow.module.css が DESIGN.md §5.2 の行高ルールを守っている", () => {
  it("var(--row-height) を含む", () => {
    const css = readText(LIST_ROW_CSS_PATH);
    expect(css).toMatch(/var\(--row-height\)/);
  });

  it(".row の height に var(--row-height) が指定されている", () => {
    const css = readText(LIST_ROW_CSS_PATH);
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const rowRuleMatch = withoutComments.match(/\.row\s*\{[^}]*\}/);
    expect(rowRuleMatch).not.toBeNull();
    expect(rowRuleMatch?.[0]).toMatch(/height:\s*var\(--row-height\)/);
  });

  it("選択行に左端バーがある: ベースルールが var(--card-accent-width) 幅の border-left を確保し、.selected がその色を透明以外に上書きする（REQUEST_CHANGES 対応）", () => {
    const css = readText(LIST_ROW_CSS_PATH);
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

    // 幅は選択・非選択で行の横幅が変わらないよう、ベースの `.row` ルール側で
    // `border-left: var(--card-accent-width) ...` として常時確保しておく実装を許容する
    // （`.selected` 側は色だけを上書きする形も許容する）。
    const hasAccentWidthSomewhere = /border-left(?:-width)?\s*:\s*var\(--card-accent-width\)/.test(
      withoutComments,
    );
    expect(
      hasAccentWidthSomewhere,
      "var(--card-accent-width) を使った border-left(-width) 宣言が見つからない",
    ).toBe(true);

    // クラス名は実装依存の可能性があるため、`.selected` を含むセレクタのルールを広く拾う。
    const selectedRuleMatches = [
      ...withoutComments.matchAll(/[^{}]*\.selected[^{}]*\{[^}]*\}/g),
    ].map((m) => m[0]);
    expect(selectedRuleMatches.length, "『.selected』を含むルールが見つからない").toBeGreaterThan(
      0,
    );
    // 選択時に見える左端バーになっていること（border-left / border-left-color が
    // transparent 以外の値に上書きされている）を確認する。
    const overridesToVisibleColor = selectedRuleMatches.some((rule) => {
      const borderLeftMatch = rule.match(/border-left(?:-color)?\s*:\s*([^;]+);/);
      if (!borderLeftMatch) {
        return false;
      }
      return !/transparent/.test(borderLeftMatch[1] ?? "");
    });
    expect(overridesToVisibleColor, `検出したルール: ${selectedRuleMatches.join(" / ")}`).toBe(
      true,
    );
  });
});

describe("ListView.module.css がヘッダ帯の sticky ルールを守っている（DESIGN.md §5.2 列ヘッダ固定）", () => {
  it("position: sticky を含む", () => {
    const css = readText(LIST_VIEW_CSS_PATH);
    expect(css).toMatch(/position:\s*sticky/);
  });

  it(".headerGroup に position: sticky と top: 0 が指定されている", () => {
    const css = readText(LIST_VIEW_CSS_PATH);
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const headerGroupMatch = withoutComments.match(/\.headerGroup\s*\{[^}]*\}/);
    expect(headerGroupMatch).not.toBeNull();
    const rule = headerGroupMatch?.[0] ?? "";
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/top:\s*0/);
  });

  it(".headerRow にも border-left と var(--card-accent-width) がある（ヘッダと本文の列起点の整合。REQUEST_CHANGES 対応）", () => {
    const css = readText(LIST_VIEW_CSS_PATH);
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const headerRowMatch = withoutComments.match(/\.headerRow\s*\{[^}]*\}/);
    expect(headerRowMatch, ".headerRow ルールが見つからない").not.toBeNull();
    const rule = headerRowMatch?.[0] ?? "";
    expect(rule).toMatch(/border-left\s*:/);
    expect(rule).toMatch(/var\(--card-accent-width\)/);
  });
});

describe("tokens.css の --row-height と ListView.tsx の ROW_HEIGHT_PX が一致している（REQUEST_CHANGES 対応: 機械的な整合検出）", () => {
  it("tokens.css の --row-height が 36px である", () => {
    const css = readText(TOKENS_CSS_PATH);
    const match = css.match(/--row-height\s*:\s*(\d+(?:\.\d+)?)px/);
    expect(match, "tokens.css に --row-height の宣言が見つからない").not.toBeNull();
    expect(Number(match?.[1])).toBe(36);
  });

  it("ListView.tsx の ROW_HEIGHT_PX 定数が tokens.css の --row-height の値と一致する", () => {
    const tokensCss = readText(TOKENS_CSS_PATH);
    const tokenMatch = tokensCss.match(/--row-height\s*:\s*(\d+(?:\.\d+)?)px/);
    expect(tokenMatch, "tokens.css に --row-height の宣言が見つからない").not.toBeNull();
    const tokenValue = Number(tokenMatch?.[1]);

    const listViewTsx = readText(LIST_VIEW_TSX_PATH);
    const constMatch = listViewTsx.match(/ROW_HEIGHT_PX\s*=\s*(\d+(?:\.\d+)?)\s*;/);
    expect(constMatch, "ListView.tsx に ROW_HEIGHT_PX の宣言が見つからない").not.toBeNull();
    const constValue = Number(constMatch?.[1]);

    expect(constValue).toBe(tokenValue);
  });
});
