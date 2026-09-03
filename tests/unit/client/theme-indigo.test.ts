import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// T-029: 配色をインディゴ基調に変更（光彩・グラデーション・見出し書体）の受け入れ条件を検証する。
// ファイル読み取りベース（jsdom 不要）。design-tokens.test.ts と同じ手法で CSS / Markdown をテキストとして解析する。
// design-tokens.test.ts からユーティリティが export されていないため、簡易 CSS パーサをここで再実装する。

const ROOT = process.cwd();
const DESIGN_MD_PATH = path.join(ROOT, "DESIGN.md");
const TOKENS_CSS_PATH = path.join(ROOT, "src", "client", "styles", "tokens.css");
const GLOBAL_CSS_PATH = path.join(ROOT, "src", "client", "styles", "global.css");
const HEADER_CSS_PATH = path.join(ROOT, "src", "client", "app", "Header.module.css");
const SESSION_CARD_CSS_PATH = path.join(
  ROOT,
  "src",
  "client",
  "features",
  "board",
  "SessionCard.module.css",
);
const COLUMN_HEADER_CSS_PATH = path.join(
  ROOT,
  "src",
  "client",
  "features",
  "board",
  "ColumnHeader.module.css",
);
const DOT_CSS_PATH = path.join(ROOT, "src", "client", "components", "Dot.module.css");
const ACCOUNT_CHIP_CSS_PATH = path.join(
  ROOT,
  "src",
  "client",
  "features",
  "accounts",
  "AccountChip.module.css",
);
const BUTTON_CSS_PATH = path.join(ROOT, "src", "client", "components", "Button.module.css");
const CLIENT_ROOT = path.join(ROOT, "src", "client");

function readText(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

// ---------------------------------------------------------------------------
// 簡易 CSS パーサ（design-tokens.test.ts と同じ方針。ネストは扱わない）
// ---------------------------------------------------------------------------

interface CssRule {
  selectors: string[];
  body: string;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseCssRules(css: string): CssRule[] {
  const withoutComments = stripComments(css);
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

/** セレクタが完全一致するルールを検索する（単一セレクタ想定）。 */
function findRuleBySelector(rules: CssRule[], selector: string): CssRule | undefined {
  return rules.find((r) => r.selectors.length === 1 && r.selectors[0] === selector);
}

/** セレクタに指定文字列を含む（部分一致）ルールをすべて検索する。属性セレクタの表記ゆれを吸収するため。 */
function findRulesBySelectorIncluding(rules: CssRule[], needle: string): CssRule[] {
  return rules.filter((r) => r.selectors.some((s) => s.includes(needle)));
}

function getDeclarationValue(body: string, property: string): string | undefined {
  const re = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);?`);
  const m = re.exec(body);
  return m?.[1]?.trim();
}

function hasDeclaration(body: string, property: string): boolean {
  return getDeclarationValue(body, property) !== undefined;
}

/** src 配下の CSS ファイルを再帰的に列挙する。 */
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

const allClientCssFiles = listCssFilesRecursive(CLIENT_ROOT);
const allClientModuleCssFiles = allClientCssFiles.filter((f) => f.endsWith(".module.css"));

// ---------------------------------------------------------------------------
// 1. global.css: body に --gradient-page が追加され、background は --color-bg のまま
// ---------------------------------------------------------------------------

describe("global.css: ページ背景に --gradient-page が適用される（受け入れ条件2）", () => {
  const rules = parseCssRules(readText(GLOBAL_CSS_PATH));
  const bodyRule = findRuleBySelector(rules, "body");

  it("body ルールが存在する", () => {
    expect(bodyRule, "body 単独のルールが見つからない").toBeDefined();
  });

  it("body に background-image: var(--gradient-page) がある", () => {
    expect(getDeclarationValue(bodyRule?.body ?? "", "background-image")).toBe(
      "var(--gradient-page)",
    );
  });

  it("body の background は var(--color-bg) のまま変更されていない", () => {
    expect(getDeclarationValue(bodyRule?.body ?? "", "background")).toBe("var(--color-bg)");
  });
});

// ---------------------------------------------------------------------------
// 2. Header.module.css: ページタイトルの書体・サイズ・光彩（受け入れ条件4）
// ---------------------------------------------------------------------------

describe("Header.module.css: ページタイトルが --font-display / --text-2xl / --glow-title で描画される（受け入れ条件4）", () => {
  const headerCssText = readText(HEADER_CSS_PATH);
  const rules = parseCssRules(headerCssText);
  const titleRule = findRuleBySelector(rules, ".title");

  it(".title ルールが存在する", () => {
    expect(titleRule, ".title 単独のルールが見つからない").toBeDefined();
  });

  it(".title に font-family: var(--font-display) がある", () => {
    expect(getDeclarationValue(titleRule?.body ?? "", "font-family")).toBe("var(--font-display)");
  });

  it(".title に font-size: var(--text-2xl) がある", () => {
    expect(getDeclarationValue(titleRule?.body ?? "", "font-size")).toBe("var(--text-2xl)");
  });

  it(".title に text-shadow: var(--glow-title) がある", () => {
    expect(getDeclarationValue(titleRule?.body ?? "", "text-shadow")).toBe("var(--glow-title)");
  });

  it("src/client 配下で --font-display を使っているのは Header.module.css の .title だけである（DESIGN.md §3: ページタイトル専用）", () => {
    const usages: string[] = [];
    for (const file of allClientCssFiles) {
      // tokens.css の変数定義自体は除外する（`--font-display: ...` という宣言は使用箇所ではない）
      if (path.resolve(file) === path.resolve(TOKENS_CSS_PATH)) {
        continue;
      }
      const content = stripComments(readText(file));
      if (content.includes("var(--font-display)")) {
        usages.push(path.relative(ROOT, file));
      }
    }
    expect(usages, `--font-display を使っているファイル: ${usages.join(", ")}`).toEqual([
      path.relative(ROOT, HEADER_CSS_PATH),
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. SessionCard.module.css: 稼働中カードの光彩とグラデーション背景（受け入れ条件3）
// ---------------------------------------------------------------------------

describe("SessionCard.module.css: 稼働中カードに --glow-signal が付き、他の状態には付かない（受け入れ条件3）", () => {
  const rules = parseCssRules(readText(SESSION_CARD_CSS_PATH));
  const cardRule = findRuleBySelector(rules, ".card");
  const runningRule = findRuleBySelector(rules, '.card[data-state="running"]');
  const activeRule = findRuleBySelector(rules, '.card[data-state="active"]');

  it(".card に background-image: var(--gradient-surface) がある", () => {
    expect(cardRule, ".card 単独のルールが見つからない").toBeDefined();
    expect(getDeclarationValue(cardRule?.body ?? "", "background-image")).toBe(
      "var(--gradient-surface)",
    );
  });

  it('.card[data-state="running"] ルールが存在する', () => {
    expect(runningRule, '.card[data-state="running"] ルールが見つからない').toBeDefined();
  });

  it('.card[data-state="running"] に box-shadow: var(--glow-signal) がある', () => {
    expect(getDeclarationValue(runningRule?.body ?? "", "box-shadow")).toBe("var(--glow-signal)");
  });

  it('.card[data-state="active"] ルールが存在する（作業中には box-shadow を付けない対象として）', () => {
    expect(activeRule, '.card[data-state="active"] ルールが見つからない').toBeDefined();
  });

  it('.card[data-state="active"]（作業中）には box-shadow が無い', () => {
    expect(hasDeclaration(activeRule?.body ?? "", "box-shadow")).toBe(false);
  });

  it(".card 素のルール（状態を問わない共通部分）には box-shadow が無い（稼働中にのみ限定するため）", () => {
    expect(hasDeclaration(cardRule?.body ?? "", "box-shadow")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. ColumnHeader.module.css: 稼働ありの列ヘッダの光彩（受け入れ条件3）
// ---------------------------------------------------------------------------

describe("ColumnHeader.module.css: 稼働ありの列ヘッダに --glow-signal が付き、素のヘッダには付かない（受け入れ条件3）", () => {
  const rules = parseCssRules(readText(COLUMN_HEADER_CSS_PATH));
  const headerRule = findRuleBySelector(rules, ".header");
  const hasRunningRule = findRuleBySelector(rules, '.header[data-has-running="true"]');

  it('.header[data-has-running="true"] ルールが存在する', () => {
    expect(hasRunningRule, '.header[data-has-running="true"] ルールが見つからない').toBeDefined();
  });

  it('.header[data-has-running="true"] に box-shadow: var(--glow-signal) がある', () => {
    expect(getDeclarationValue(hasRunningRule?.body ?? "", "box-shadow")).toBe(
      "var(--glow-signal)",
    );
  });

  it(".header 素のルール（稼働なし相当）には box-shadow が無い", () => {
    expect(headerRule, ".header 単独のルールが見つからない").toBeDefined();
    expect(hasDeclaration(headerRule?.body ?? "", "box-shadow")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Dot.module.css: running のみ光彩、他の状態には無し（受け入れ条件3）
// ---------------------------------------------------------------------------

describe("Dot.module.css: running のみ --glow-signal-dot が付き、active/idle/error には付かない（受け入れ条件3）", () => {
  const rules = parseCssRules(readText(DOT_CSS_PATH));
  const runningRule = findRuleBySelector(rules, ".running");
  const activeRule = findRuleBySelector(rules, ".active");
  const idleRule = findRuleBySelector(rules, ".idle");
  const errorRule = findRuleBySelector(rules, ".error");

  it(".running ルールが存在する", () => {
    expect(runningRule, ".running 単独のルールが見つからない").toBeDefined();
  });

  it(".running に box-shadow: var(--glow-signal-dot) がある", () => {
    expect(getDeclarationValue(runningRule?.body ?? "", "box-shadow")).toBe(
      "var(--glow-signal-dot)",
    );
  });

  it(".active（作業中）ルールが存在し、box-shadow が無い", () => {
    expect(activeRule, ".active 単独のルールが見つからない").toBeDefined();
    expect(hasDeclaration(activeRule?.body ?? "", "box-shadow")).toBe(false);
  });

  it(".idle（停止）ルールが存在し、box-shadow が無い", () => {
    expect(idleRule, ".idle 単独のルールが見つからない").toBeDefined();
    expect(hasDeclaration(idleRule?.body ?? "", "box-shadow")).toBe(false);
  });

  it(".error（エラー）ルールが存在し、box-shadow が無い", () => {
    expect(errorRule, ".error 単独のルールが見つからない").toBeDefined();
    expect(hasDeclaration(errorRule?.body ?? "", "box-shadow")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. AccountChip.module.css: :has([data-state="running"]) に光彩（受け入れ条件3）
// ---------------------------------------------------------------------------

describe('AccountChip.module.css: :has([data-state="running"]) を含むセレクタに --glow-signal が付く（受け入れ条件3）', () => {
  const rules = parseCssRules(readText(ACCOUNT_CHIP_CSS_PATH));
  const runningChipRules = findRulesBySelectorIncluding(rules, ':has([data-state="running"])');
  const chipRule = findRuleBySelector(rules, ".chip");

  it(':has([data-state="running"]) を含むセレクタのルールが少なくとも 1 つ存在する', () => {
    expect(
      runningChipRules.length,
      ':has([data-state="running"]) を含むルールが見つからない',
    ).toBeGreaterThan(0);
  });

  it(':has([data-state="running"]) を含むルールに box-shadow: var(--glow-signal) がある', () => {
    const hasGlow = runningChipRules.some(
      (r) => getDeclarationValue(r.body, "box-shadow") === "var(--glow-signal)",
    );
    expect(hasGlow).toBe(true);
  });

  it(".chip 素のルール（未稼働相当）には box-shadow が無い", () => {
    expect(chipRule, ".chip 単独のルールが見つからない").toBeDefined();
    expect(hasDeclaration(chipRule?.body ?? "", "box-shadow")).toBe(false);
  });

  it(".chip に background-image: var(--gradient-surface) がある", () => {
    expect(getDeclarationValue(chipRule?.body ?? "", "background-image")).toBe(
      "var(--gradient-surface)",
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Button.module.css: primary ボタンのグラデーション背景と文字色（受け入れ条件5）
// ---------------------------------------------------------------------------

describe("Button.module.css: .primary の背景が --gradient-primary、文字が --color-on-signal（受け入れ条件5）", () => {
  const rules = parseCssRules(readText(BUTTON_CSS_PATH));
  const primaryRule = findRuleBySelector(rules, ".primary");
  const disabledRule = findRuleBySelector(rules, ".disabled");

  it(".primary ルールが存在する", () => {
    expect(primaryRule, ".primary 単独のルールが見つからない").toBeDefined();
  });

  it(".primary に background: var(--gradient-primary) がある", () => {
    expect(getDeclarationValue(primaryRule?.body ?? "", "background")).toBe(
      "var(--gradient-primary)",
    );
  });

  it(".primary に color: var(--color-on-signal) がある", () => {
    expect(getDeclarationValue(primaryRule?.body ?? "", "color")).toBe("var(--color-on-signal)");
  });

  it(".disabled は従来どおり var(--color-surface-3) の地のままで、グラデーションを使わない（無効表示との混同を防ぐ）", () => {
    expect(disabledRule, ".disabled 単独のルールが見つからない").toBeDefined();
    expect(getDeclarationValue(disabledRule?.body ?? "", "background")).toBe(
      "var(--color-surface-3)",
    );
  });
});

// ---------------------------------------------------------------------------
// 8. box-shadow / text-shadow の値はトークン経由のみ（受け入れ条件: CSS Modules に生の値を書かない）
// ---------------------------------------------------------------------------

describe("src/client/**/*.module.css: box-shadow / text-shadow はトークン（--glow-* / --shadow-overlay）経由のみ", () => {
  const ALLOWED_VALUES = new Set([
    "var(--glow-signal)",
    "var(--glow-signal-dot)",
    "var(--glow-title)",
    "var(--shadow-overlay)",
  ]);

  interface ShadowDeclaration {
    file: string;
    selector: string;
    property: string;
    value: string;
  }

  function collectShadowDeclarations(files: string[]): ShadowDeclaration[] {
    const result: ShadowDeclaration[] = [];
    for (const file of files) {
      const rules = parseCssRules(readText(file));
      for (const rule of rules) {
        for (const property of ["box-shadow", "text-shadow"]) {
          const value = getDeclarationValue(rule.body, property);
          if (value !== undefined) {
            result.push({
              file: path.relative(ROOT, file),
              selector: rule.selectors.join(", "),
              property,
              value,
            });
          }
        }
      }
    }
    return result;
  }

  it("box-shadow / text-shadow を宣言している箇所が少なくとも 1 つある（光彩実装済みの前提確認）", () => {
    const declarations = collectShadowDeclarations(allClientModuleCssFiles);
    expect(declarations.length).toBeGreaterThan(0);
  });

  it("すべての box-shadow / text-shadow の値が --glow-* または --shadow-overlay のトークン単独である", () => {
    const declarations = collectShadowDeclarations(allClientModuleCssFiles);
    const violations = declarations.filter((d) => !ALLOWED_VALUES.has(d.value));
    const detail = violations
      .map((v) => `${v.file} [${v.selector}] ${v.property}: ${v.value}`)
      .join(" / ");
    expect(violations, `許可されていない shadow の値: ${detail || "(なし)"}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. animation / @keyframes が増えていない（光彩を点滅させない）
// ---------------------------------------------------------------------------

describe("src/client/**/*.css: animation / @keyframes を使わない（光彩は静的。DESIGN.md §4.4 / §4.3）", () => {
  // 実装前の時点でリポジトリに animation / @keyframes が存在しないことを事前に grep で確認済み（上限 = 0）。
  const BASELINE_ANIMATION_COUNT = 0;

  function countAnimationUsages(files: string[]): { file: string; match: string }[] {
    const hits: { file: string; match: string }[] = [];
    const re = /@keyframes\b|\banimation\s*:|\banimation-name\s*:/g;
    for (const file of files) {
      const content = stripComments(readText(file));
      for (const m of content.matchAll(re)) {
        hits.push({ file: path.relative(ROOT, file), match: m[0] });
      }
    }
    return hits;
  }

  it("走査対象の CSS ファイルが少なくとも 1 つある（前提確認）", () => {
    expect(allClientCssFiles.length).toBeGreaterThan(0);
  });

  it(`animation / @keyframes の使用件数がベースライン（${BASELINE_ANIMATION_COUNT} 件）を超えていない`, () => {
    const hits = countAnimationUsages(allClientCssFiles);
    const detail = hits.map((h) => `${h.file}: ${h.match}`).join(" / ");
    expect(hits.length, `検出された animation / @keyframes: ${detail || "(なし)"}`).toBe(
      BASELINE_ANIMATION_COUNT,
    );
  });
});

// ---------------------------------------------------------------------------
// 10. DESIGN.md §2.5 の表と tokens.css :root に新規 6 トークンが揃っている
// ---------------------------------------------------------------------------

describe("DESIGN.md §2.5 と tokens.css: グラデーション/光彩トークンが 6 つとも揃っている（受け入れ条件1・実装の前提）", () => {
  const NEW_THEME_TOKENS = [
    "--gradient-page",
    "--gradient-surface",
    "--gradient-primary",
    "--glow-signal",
    "--glow-signal-dot",
    "--glow-title",
  ];

  function extractSection(markdown: string, headingPrefix: string): string {
    const headingIndex = markdown.indexOf(headingPrefix);
    if (headingIndex === -1) {
      throw new Error(`DESIGN.md に '${headingPrefix}' 見出しが見つからない`);
    }
    const fromHeading = markdown.slice(headingIndex);
    // 同じレベル（###）または上位レベル（##）の次の見出しまでを範囲とする。
    const nextHeadingOffset = fromHeading.slice(1).search(/\n#{2,3} /);
    return nextHeadingOffset === -1 ? fromHeading : fromHeading.slice(0, nextHeadingOffset + 1);
  }

  const designMd = readText(DESIGN_MD_PATH);
  const section25 = extractSection(designMd, "### 2.5");

  it.each(NEW_THEME_TOKENS)("DESIGN.md §2.5 の表に %s の行がある", (tokenName) => {
    const rowPattern = new RegExp(`\\|\\s*\`${tokenName.replace(/[-]/g, "\\-")}\`\\s*\\|`);
    expect(section25, `§2.5 に ${tokenName} の行が見つからない`).toMatch(rowPattern);
  });

  it("DESIGN.md §2.5 の表の行数（新規トークン分）がちょうど 6 件である", () => {
    let count = 0;
    for (const line of section25.split(/\r?\n/)) {
      if (NEW_THEME_TOKENS.some((t) => line.includes(`\`${t}\``))) {
        count += 1;
      }
    }
    expect(count).toBe(NEW_THEME_TOKENS.length);
  });

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

  const tokensCssBody = readText(TOKENS_CSS_PATH).replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "");
  const mediaIndex = tokensCssBody.indexOf("@media");
  const tokensRoot = mediaIndex === -1 ? tokensCssBody : tokensCssBody.slice(0, mediaIndex);
  const tokensRootProps = extractCustomProperties(tokensRoot);

  it.each(NEW_THEME_TOKENS)("tokens.css の :root に %s が定義されている", (tokenName) => {
    expect(tokensRootProps.has(tokenName), `tokens.css に ${tokenName} が無い`).toBe(true);
  });
});
