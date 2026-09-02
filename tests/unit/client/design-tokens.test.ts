import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// T-016: デザイントークンとグローバルスタイルの受け入れ条件を検証する。
// ファイル読み取りベース（jsdom 不要）。DOM を組み立てず、CSS / HTML / TSX をテキストとして解析する。

const ROOT = process.cwd();
const DESIGN_MD_PATH = path.join(ROOT, "DESIGN.md");
const TOKENS_CSS_PATH = path.join(ROOT, "src", "client", "styles", "tokens.css");
const GLOBAL_CSS_PATH = path.join(ROOT, "src", "client", "styles", "global.css");
const MAIN_TSX_PATH = path.join(ROOT, "src", "client", "main.tsx");
const INDEX_HTML_PATH = path.join(ROOT, "src", "client", "index.html");
const CLIENT_STYLES_ROOT = path.join(ROOT, "src", "client");

function readText(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

// ---------------------------------------------------------------------------
// DESIGN.md §9 / tokens.css の比較ユーティリティ
// ---------------------------------------------------------------------------

/** DESIGN.md から「## 9.」見出し以下、次の「## 」見出しまでの範囲にある最初の ```css ブロックを抽出する。 */
function extractDesignSection9Css(designMd: string): string {
  const headingIndex = designMd.indexOf("## 9.");
  if (headingIndex === -1) {
    throw new Error("DESIGN.md に '## 9.' 見出しが見つからない");
  }
  const fromHeading = designMd.slice(headingIndex);
  const nextHeadingOffset = fromHeading.slice(1).search(/\n## /);
  const scoped =
    nextHeadingOffset === -1 ? fromHeading : fromHeading.slice(0, nextHeadingOffset + 1);
  const codeBlockMatch = scoped.match(/```css\r?\n([\s\S]*?)```/);
  if (!codeBlockMatch || typeof codeBlockMatch[1] !== "string") {
    throw new Error("DESIGN.md §9 に ```css コードブロックが見つからない");
  }
  return codeBlockMatch[1];
}

/** tokens.css 先頭の `/* ... *\/` ブロックコメントを除去する。 */
function stripLeadingBlockComment(css: string): string {
  return css.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "");
}

/** `@media` 以降とそれより前（:root 部分）を分離する。 */
function splitRootAndMedia(css: string): { root: string; media: string } {
  const mediaIndex = css.indexOf("@media");
  if (mediaIndex === -1) {
    return { root: css, media: "" };
  }
  return { root: css.slice(0, mediaIndex), media: css.slice(mediaIndex) };
}

/** `--名前: 値;` の宣言をすべて抽出し、名前 → 値（空白正規化済み）の Map にする。 */
function extractCustomProperties(css: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  for (const m of css.matchAll(re)) {
    const name = m[1];
    const rawValue = m[2];
    if (typeof name !== "string" || typeof rawValue !== "string") {
      continue;
    }
    map.set(name, rawValue.trim().replace(/\s+/g, " "));
  }
  return map;
}

const designSection9Css = extractDesignSection9Css(readText(DESIGN_MD_PATH));
const tokensCssRaw = readText(TOKENS_CSS_PATH);
const tokensCssBody = stripLeadingBlockComment(tokensCssRaw);

const designSplit = splitRootAndMedia(designSection9Css);
const tokensSplit = splitRootAndMedia(tokensCssBody);

const designRootProps = extractCustomProperties(designSplit.root);
const tokensRootProps = extractCustomProperties(tokensSplit.root);

describe("tokens.css は DESIGN.md §9 のコードブロックと完全一致する", () => {
  it("DESIGN.md 側の :root カスタムプロパティが 1 件以上抽出できる（抽出ロジックの前提確認）", () => {
    expect(designRootProps.size).toBeGreaterThan(0);
  });

  it("tokens.css のカスタムプロパティの名前 → 値の集合が DESIGN.md §9 と完全一致する", () => {
    const missingInTokens: string[] = [];
    const missingInDesign: string[] = [];
    const valueMismatches: string[] = [];

    for (const [name, designValue] of designRootProps) {
      if (!tokensRootProps.has(name)) {
        missingInTokens.push(name);
        continue;
      }
      const tokensValue = tokensRootProps.get(name);
      if (tokensValue !== designValue) {
        valueMismatches.push(`${name}: DESIGN.md="${designValue}" tokens.css="${tokensValue}"`);
      }
    }
    for (const name of tokensRootProps.keys()) {
      if (!designRootProps.has(name)) {
        missingInDesign.push(name);
      }
    }

    expect(
      missingInTokens,
      `DESIGN.md にあるが tokens.css に無い名前: ${missingInTokens.join(", ") || "(なし)"}`,
    ).toEqual([]);
    expect(
      missingInDesign,
      `tokens.css にあるが DESIGN.md に無い名前: ${missingInDesign.join(", ") || "(なし)"}`,
    ).toEqual([]);
    expect(valueMismatches, `値が食い違う宣言: ${valueMismatches.join(" | ") || "(なし)"}`).toEqual(
      [],
    );
  });

  it("color-scheme: dark が DESIGN.md §9 と tokens.css の両方の :root にある", () => {
    expect(designSplit.root).toMatch(/color-scheme:\s*dark;/);
    expect(tokensSplit.root).toMatch(/color-scheme:\s*dark;/);
  });

  it("@media (prefers-reduced-motion: reduce) 内で --duration-fast と --duration-normal が両方 0ms になる（DESIGN.md / tokens.css 両方）", () => {
    const cases: Array<[string, string]> = [
      ["DESIGN.md", designSplit.media],
      ["tokens.css", tokensSplit.media],
    ];
    for (const [label, mediaText] of cases) {
      expect(
        mediaText,
        `${label} に @media (prefers-reduced-motion: reduce) ブロックが見つからない`,
      ).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
      const mediaProps = extractCustomProperties(mediaText);
      expect(mediaProps.get("--duration-fast"), `${label} の --duration-fast`).toBe("0ms");
      expect(mediaProps.get("--duration-normal"), `${label} の --duration-normal`).toBe("0ms");
    }
  });
});

// ---------------------------------------------------------------------------
// global.css の規則
// ---------------------------------------------------------------------------

interface CssRule {
  selectors: string[];
  body: string;
}

/** 簡易 CSS パーサ: コメントを除去し、セレクタ集合と宣言ブロックのペアの配列を返す。ネストは扱わない。 */
function parseCssRules(css: string): CssRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of withoutComments.matchAll(re)) {
    const selectorText = m[1];
    const body = m[2];
    if (typeof selectorText !== "string" || typeof body !== "string") {
      continue;
    }
    const selectors = selectorText
      .split(",")
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter((s) => s.length > 0);
    if (selectors.length === 0) {
      continue;
    }
    rules.push({ selectors, body });
  }
  return rules;
}

/** セレクタ集合（順不同・完全一致）でルールを検索する。 */
function findRuleBySelectors(rules: CssRule[], expectedSelectors: string[]): CssRule | undefined {
  const expectedSet = new Set(expectedSelectors);
  return rules.find(
    (r) => r.selectors.length === expectedSet.size && r.selectors.every((s) => expectedSet.has(s)),
  );
}

function getDeclarationValue(body: string, property: string): string | undefined {
  const re = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);?`);
  const m = re.exec(body);
  return m?.[1]?.trim();
}

const globalCssText = readText(GLOBAL_CSS_PATH);
const globalCssRules = parseCssRules(globalCssText);

describe("global.css: 指定された規則の存在", () => {
  it("body に background: var(--color-bg) がある", () => {
    const body = findRuleBySelectors(globalCssRules, ["body"]);
    expect(body, "body 単独のルールが見つからない").toBeDefined();
    expect(getDeclarationValue(body?.body ?? "", "background")).toBe("var(--color-bg)");
  });

  it("body に color: var(--color-text) がある", () => {
    const body = findRuleBySelectors(globalCssRules, ["body"]);
    expect(getDeclarationValue(body?.body ?? "", "color")).toBe("var(--color-text)");
  });

  it("body に font-family: var(--font-ui) がある", () => {
    const body = findRuleBySelectors(globalCssRules, ["body"]);
    expect(getDeclarationValue(body?.body ?? "", "font-family")).toBe("var(--font-ui)");
  });

  it("body に font-size: var(--text-md) がある", () => {
    const body = findRuleBySelectors(globalCssRules, ["body"]);
    expect(getDeclarationValue(body?.body ?? "", "font-size")).toBe("var(--text-md)");
  });

  it("body に line-height: var(--leading-md) がある", () => {
    const body = findRuleBySelectors(globalCssRules, ["body"]);
    expect(getDeclarationValue(body?.body ?? "", "line-height")).toBe("var(--leading-md)");
  });

  it("*:focus-visible に var(--color-focus) を使った outline がある", () => {
    const rule = findRuleBySelectors(globalCssRules, ["*:focus-visible"]);
    expect(rule, "*:focus-visible ルールが見つからない").toBeDefined();
    const outline = getDeclarationValue(rule?.body ?? "", "outline");
    expect(outline).toContain("var(--color-focus)");
  });

  it("*, *::before, *::after に box-sizing: border-box がある", () => {
    const rule = findRuleBySelectors(globalCssRules, ["*", "*::before", "*::after"]);
    expect(rule, "*, *::before, *::after ルールが見つからない").toBeDefined();
    expect(getDeclarationValue(rule?.body ?? "", "box-sizing")).toBe("border-box");
  });

  it("#root ルールが存在する", () => {
    const rule = findRuleBySelectors(globalCssRules, ["#root"]);
    expect(rule).toBeDefined();
  });

  it("button, input, select, textarea に font: inherit がある", () => {
    const rule = findRuleBySelectors(globalCssRules, ["button", "input", "select", "textarea"]);
    expect(rule, "button, input, select, textarea ルールが見つからない").toBeDefined();
    expect(getDeclarationValue(rule?.body ?? "", "font")).toBe("inherit");
  });

  it("code, pre, .mono に font-family: var(--font-mono) がある", () => {
    const rule = findRuleBySelectors(globalCssRules, ["code", "pre", ".mono"]);
    expect(rule, "code, pre, .mono ルールが見つからない").toBeDefined();
    expect(getDeclarationValue(rule?.body ?? "", "font-family")).toBe("var(--font-mono)");
  });
});

// ---------------------------------------------------------------------------
// 生の hex / px / rgb(a) 検出（tokens.css 以外の CSS 全般）
// ---------------------------------------------------------------------------

interface RawValueViolation {
  line: number;
  match: string;
  text: string;
}

/**
 * CSS テキストから生の hex カラー・px 値（0px/1px/2px を除く）・rgb(a)( を検出する。
 * `var(...)` の中身は対象外。ブロックコメントは行数を保ったまま除去してから走査する。
 */
function findRawColorOrPxViolations(css: string): RawValueViolation[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
  const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
  const pxRe = /\b(?!0px\b)(?!1px\b)(?!2px\b)\d+(?:\.\d+)?px\b/g;
  const rgbRe = /\brgba?\(/g;

  const violations: RawValueViolation[] = [];
  const lines = withoutComments.split(/\r?\n/);

  lines.forEach((rawLine, idx) => {
    const withoutVar = rawLine.replace(/var\([^)]*\)/g, "");
    const lineNumber = idx + 1;
    for (const pattern of [hexRe, pxRe, rgbRe]) {
      pattern.lastIndex = 0;
      for (const m of withoutVar.matchAll(pattern)) {
        violations.push({ line: lineNumber, match: m[0], text: rawLine.trim() });
      }
    }
  });

  return violations;
}

describe("findRawColorOrPxViolations（検出ロジック自体の単体テスト）", () => {
  it("var(...) を使った境界線幅（1px）は違反ではない", () => {
    expect(findRawColorOrPxViolations("border: 1px solid var(--color-border);")).toHaveLength(0);
  });

  it("2px の境界線幅も違反ではない", () => {
    expect(findRawColorOrPxViolations("outline-offset: 2px;")).toHaveLength(0);
  });

  it("0px / 0 は違反ではない", () => {
    expect(findRawColorOrPxViolations("margin: 0;")).toHaveLength(0);
    expect(findRawColorOrPxViolations("border-width: 0px;")).toHaveLength(0);
  });

  it("100% のような比率は違反ではない", () => {
    expect(findRawColorOrPxViolations("height: 100%;")).toHaveLength(0);
  });

  it("生の hex カラー（例: color: #fff;）を検出する", () => {
    const violations = findRawColorOrPxViolations("color: #fff;");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.match).toBe("#fff");
  });

  it("生の px 値（例: padding: 12px;）を検出する", () => {
    const violations = findRawColorOrPxViolations("padding: 12px;");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.match).toBe("12px");
  });

  it("rgba(...) を検出する（例: background: rgba(0,0,0,.5);）", () => {
    const violations = findRawColorOrPxViolations("background: rgba(0,0,0,.5);");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.match).toBe("rgba(");
  });

  it("rgb(...) も検出する", () => {
    const violations = findRawColorOrPxViolations("color: rgb(255, 0, 0);");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.match).toBe("rgb(");
  });

  it("var(...) の中に px/hex らしき文字列があっても対象外", () => {
    // 実際にはこの形は起きないが、var( の中は対象外という規則自体を検証する
    expect(findRawColorOrPxViolations("width: var(--fake-12px-token);")).toHaveLength(0);
  });

  it("コメント内の hex / px は無視する", () => {
    const css = ["/* 例: color: #fff; padding: 12px; */", "color: var(--color-text);"].join("\n");
    expect(findRawColorOrPxViolations(css)).toHaveLength(0);
  });

  it("1 行に複数の違反があればすべて検出する", () => {
    const violations = findRawColorOrPxViolations("border: 3px solid #123456;");
    expect(violations).toHaveLength(2);
  });
});

/** src/client 配下の .css ファイルを再帰的に列挙する（将来追加されるファイルも自動的に対象になる）。 */
function listCssFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...listCssFilesRecursive(full));
    } else if (entry.endsWith(".css")) {
      files.push(full);
    }
  }
  return files;
}

describe("src/client/**/*.css（tokens.css 以外）に生の hex / px / rgb(a) が無い", () => {
  const allCssFiles = listCssFilesRecursive(CLIENT_STYLES_ROOT);
  const targetFiles = allCssFiles.filter((f) => path.resolve(f) !== path.resolve(TOKENS_CSS_PATH));

  it("走査対象の CSS ファイルが少なくとも 1 つある（global.css を含む想定）", () => {
    expect(targetFiles.length).toBeGreaterThan(0);
  });

  it.each(targetFiles.length > 0 ? targetFiles : ["(no-file)"])(
    "%s に生の hex / px（0px, 1px, 2px を除く）/ rgb(a)( が無い",
    (file) => {
      if (file === "(no-file)") {
        return;
      }
      const content = readText(file);
      const violations = findRawColorOrPxViolations(content);
      const detail = violations.map((v) => `L${v.line}: ${v.match} (${v.text})`).join(" / ");
      expect(violations, `違反: ${detail}`).toHaveLength(0);
    },
  );

  it("tokens.css 自体は走査対象から除外されている", () => {
    expect(targetFiles.some((f) => path.resolve(f) === path.resolve(TOKENS_CSS_PATH))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// main.tsx の import 順
// ---------------------------------------------------------------------------

describe("main.tsx: tokens.css → global.css の順で import する", () => {
  const mainTsxText = readText(MAIN_TSX_PATH);
  const tokensImportMatch = /import\s+["']\.\/styles\/tokens\.css["'];?/.exec(mainTsxText);
  const globalImportMatch = /import\s+["']\.\/styles\/global\.css["'];?/.exec(mainTsxText);

  it("./styles/tokens.css を import している", () => {
    expect(tokensImportMatch).not.toBeNull();
  });

  it("./styles/global.css を import している", () => {
    expect(globalImportMatch).not.toBeNull();
  });

  it("tokens.css の import 位置が global.css より前にある", () => {
    expect(tokensImportMatch).not.toBeNull();
    expect(globalImportMatch).not.toBeNull();
    expect(tokensImportMatch?.index ?? Number.POSITIVE_INFINITY).toBeLessThan(
      globalImportMatch?.index ?? Number.NEGATIVE_INFINITY,
    );
  });
});

// ---------------------------------------------------------------------------
// index.html
// ---------------------------------------------------------------------------

describe("index.html", () => {
  const indexHtmlText = readText(INDEX_HTML_PATH);

  it('<html lang="ja"> を持つ', () => {
    expect(indexHtmlText).toMatch(/<html[^>]*\slang=["']ja["']/);
  });

  it('<meta name="color-scheme" content="dark"> を持つ', () => {
    expect(indexHtmlText).toMatch(/<meta[^>]*name=["']color-scheme["'][^>]*content=["']dark["']/);
  });

  it("<title>AI-Manager</title> を持つ", () => {
    expect(indexHtmlText).toMatch(/<title>AI-Manager<\/title>/);
  });

  it("viewport の meta タグを持つ（width=device-width を含む）", () => {
    expect(indexHtmlText).toMatch(
      /<meta[^>]*name=["']viewport["'][^>]*content=["'][^"']*width=device-width/,
    );
  });
});
