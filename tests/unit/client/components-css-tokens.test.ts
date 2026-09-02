import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// T-017: 汎用 UI コンポーネント（src/client/components/*.module.css）が
// DESIGN.md §5 のルール（トークン以外の値を使わない）を守っていることを検証する。
// node 環境・ファイル読み取りベース（jsdom 不要）。既存の tests/unit/client/design-tokens.test.ts に倣う。

const ROOT = process.cwd();
const COMPONENTS_DIR = path.join(ROOT, "src", "client", "components");
const TOKENS_CSS_PATH = path.join(ROOT, "src", "client", "styles", "tokens.css");

function readText(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

function listModuleCssFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".module.css"))
    .map((entry) => path.join(dir, entry));
}

/** `--名前: 値;` の宣言をすべて抽出し、名前の集合にする（tokens.css の :root 部分想定）。 */
function extractCustomPropertyNames(css: string): Set<string> {
  const names = new Set<string>();
  const re = /(--[\w-]+)\s*:/g;
  for (const m of css.matchAll(re)) {
    const name = m[1];
    if (typeof name === "string") {
      names.add(name);
    }
  }
  return names;
}

/** var(--name...) と calc(...) の呼び出し全体を空白に置き換える（中身は許容対象のため走査から除外）。 */
function stripVarAndCalc(css: string): string {
  // ネストは想定しない（このプロジェクトの CSS Modules は 1 階層の var()/calc() のみ使用）。
  return css.replace(/calc\([^)]*\)/g, "").replace(/var\([^)]*\)/g, "");
}

const tokensCssText = readText(TOKENS_CSS_PATH);
const tokenNames = extractCustomPropertyNames(tokensCssText);

const moduleCssFiles = listModuleCssFiles(COMPONENTS_DIR);

describe("src/client/components/*.module.css がトークン以外の値を含まない（DESIGN.md §5）", () => {
  it("走査対象の .module.css ファイルが 7 コンポーネント分（Dot/Pill/Button/Toggle/EmptyState/Loading/ErrorBanner）ある", () => {
    expect(moduleCssFiles.length).toBeGreaterThanOrEqual(7);
  });

  it("tokens.css から 1 件以上のカスタムプロパティ名が抽出できる（前提確認）", () => {
    expect(tokenNames.size).toBeGreaterThan(0);
  });

  it.each(moduleCssFiles)("%s に生の hex カラーが無い", (file) => {
    const content = readText(file);
    const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
    const matches = withoutComments.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(matches, `検出: ${matches.join(", ")}`).toEqual([]);
  });

  it.each(moduleCssFiles)(
    "%s に生の px / rem / em / ms 数値が無い（許容: 0, 1px, 2px, var()/calc() 内）",
    (file) => {
      const content = readText(file);
      const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
      const scanned = stripVarAndCalc(withoutComments);
      const unitRe = /\b(?!0(?:px|rem|em|ms)\b)(?!1px\b)(?!2px\b)\d+(?:\.\d+)?(?:px|rem|em|ms)\b/g;
      const matches = [...scanned.matchAll(unitRe)].map((m) => m[0]);
      expect(matches, `検出: ${matches.join(", ")}`).toEqual([]);
    },
  );

  it.each(moduleCssFiles)("%s に !important が無い", (file) => {
    const content = readText(file);
    expect(content).not.toMatch(/!important/);
  });

  it.each(moduleCssFiles)("%s に @keyframes が無い", (file) => {
    const content = readText(file);
    expect(content).not.toMatch(/@keyframes/);
  });

  it.each(moduleCssFiles)("%s に animation プロパティが無い", (file) => {
    const content = readText(file);
    const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/\banimation\s*:/);
    expect(withoutComments).not.toMatch(/\banimation-name\s*:/);
  });

  it.each(moduleCssFiles)("%s の var(...) が参照する名前はすべて tokens.css に定義済み", (file) => {
    const content = readText(file);
    const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
    const varNames = [...withoutComments.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
    const undefinedNames = varNames.filter(
      (name) => typeof name === "string" && !tokenNames.has(name),
    );
    expect(undefinedNames, `未定義の var 参照: ${undefinedNames.join(", ")}`).toEqual([]);
  });

  it("走査対象の .module.css ファイルのうち少なくとも 1 つは var(...) を実際に使っている（前提確認）", () => {
    const anyUsesVar = moduleCssFiles.some((file) => /var\(--[\w-]+/.test(readText(file)));
    expect(anyUsesVar).toBe(true);
  });
});
