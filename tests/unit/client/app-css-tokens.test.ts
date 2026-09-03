import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// T-020 受け入れ条件:
// 「src/client/app/*.module.css と src/client/features/**/*.module.css にトークン外の値が無いこと」
// 「Header.module.css か Layout.module.css に position: sticky があること」
// node 環境・ファイル読み取りベース（jsdom 不要）。
// tests/unit/client/components-css-tokens.test.ts の検査ロジックを複製したもの。

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "src", "client", "app");
const FEATURES_DIR = path.join(ROOT, "src", "client", "features");
const TOKENS_CSS_PATH = path.join(ROOT, "src", "client", "styles", "tokens.css");

function readText(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

/** dir を再帰的に走査して *.module.css を集める。dir が無ければ空配列。 */
function listModuleCssFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listModuleCssFilesRecursive(fullPath));
    } else if (entry.endsWith(".module.css")) {
      files.push(fullPath);
    }
  }
  return files;
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
  return css.replace(/calc\([^)]*\)/g, "").replace(/var\([^)]*\)/g, "");
}

const tokensCssText = readText(TOKENS_CSS_PATH);
const tokenNames = extractCustomPropertyNames(tokensCssText);

/**
 * 仮想スクロールなどの動的な位置・高さを、インラインの style からではなく CSS 変数経由で渡すための名前
 * （CLAUDE.md §5「動的な幅・高さを CSS 変数で渡す場合のみ可」）。値は JS が実測値から与えるため
 * tokens.css には無い。ここに列挙した名前だけを未定義扱いから除外する。
 */
const DYNAMIC_LAYOUT_VARS: ReadonlySet<string> = new Set([
  "--virtual-offset",
  "--virtual-total-size",
  "--list-body-height",
]);

const moduleCssFiles = [
  ...listModuleCssFilesRecursive(APP_DIR),
  ...listModuleCssFilesRecursive(FEATURES_DIR),
];

/** 走査対象の CSS Modules 内で宣言されているカスタムプロパティ名（feature ローカルの変数）。 */
const moduleCssDeclaredNames = new Set<string>();
for (const file of moduleCssFiles) {
  const withoutComments = readText(file).replace(/\/\*[\s\S]*?\*\//g, "");
  for (const name of extractCustomPropertyNames(withoutComments)) {
    moduleCssDeclaredNames.add(name);
  }
}

describe("src/client/app/*.module.css と src/client/features/**/*.module.css がトークン以外の値を含まない（DESIGN.md §5）", () => {
  it("走査対象の .module.css ファイルが 1 件以上ある（前提確認）", () => {
    expect(moduleCssFiles.length).toBeGreaterThan(0);
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
    // 走査対象の CSS Modules 内で宣言したカスタムプロパティ（値はトークンで組み立てる。feature 内で
    // 親要素に宣言して子要素から参照する形を含む）と、動的レイアウト用の変数は許容する
    const localNames = moduleCssDeclaredNames;
    const undefinedNames = varNames.filter(
      (name) =>
        typeof name === "string" &&
        !tokenNames.has(name) &&
        !localNames.has(name) &&
        !DYNAMIC_LAYOUT_VARS.has(name),
    );
    expect(undefinedNames, `未定義の var 参照: ${undefinedNames.join(", ")}`).toEqual([]);
  });

  it("走査対象の .module.css ファイルのうち少なくとも 1 つは var(...) を実際に使っている（前提確認）", () => {
    const anyUsesVar = moduleCssFiles.some((file) => /var\(--[\w-]+/.test(readText(file)));
    expect(anyUsesVar).toBe(true);
  });

  it("Header.module.css か Layout.module.css のいずれかに position: sticky がある", () => {
    const headerCssPath = path.join(APP_DIR, "Header.module.css");
    const layoutCssPath = path.join(APP_DIR, "Layout.module.css");
    const headerHasSticky =
      existsSync(headerCssPath) && /position\s*:\s*sticky/.test(readText(headerCssPath));
    const layoutHasSticky =
      existsSync(layoutCssPath) && /position\s*:\s*sticky/.test(readText(layoutCssPath));
    expect(headerHasSticky || layoutHasSticky).toBe(true);
  });
});
