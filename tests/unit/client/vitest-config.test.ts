import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// T-017 受け入れ条件:
// 「vitest.config.ts: client プロジェクトに jest-dom の setupFiles、
//   include が src/client/**/*.test.{ts,tsx} と tests/**/*.test.tsx、
//   node プロジェクトが src/client/** を除外」
// node 環境・テキスト読み取りベース（vitest.config.ts 自体を import すると projects の
// 二重評価が発生しうるため、既存の design-tokens.test.ts と同様にテキストとして検証する）。

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, "vitest.config.ts");
const configText = readFileSync(CONFIG_PATH, "utf-8");

/** name: "..." で始まる project 定義ブロックを、次の同階層 `},` までのテキストとして雑に切り出す。 */
function extractProjectBlock(text: string, projectName: string): string {
  const nameIndex = text.indexOf(`name: "${projectName}"`);
  if (nameIndex === -1) {
    throw new Error(`vitest.config.ts に name: "${projectName}" が見つからない`);
  }
  // name 宣言の直前にある最も近い `{` から、対応する `}` までを雑に取り出す。
  const blockStart = text.lastIndexOf("{", nameIndex);
  // 単純化のため、次に現れる `{ extends: true` または文字列終端までを block とみなす。
  const nextBlockStart = text.indexOf("{\n        extends: true", blockStart + 1);
  const blockEnd = nextBlockStart === -1 ? text.length : nextBlockStart;
  return text.slice(blockStart, blockEnd);
}

describe("vitest.config.ts: client プロジェクト設定", () => {
  const clientBlock = extractProjectBlock(configText, "client");

  it('client プロジェクトの environment が "jsdom" である', () => {
    expect(clientBlock).toMatch(/environment:\s*["']jsdom["']/);
  });

  it("client プロジェクトの setupFiles に tests/setup/jest-dom.ts が含まれる", () => {
    expect(clientBlock).toMatch(/setupFiles:\s*\[[^\]]*tests\/setup\/jest-dom\.ts[^\]]*\]/);
  });

  it("client プロジェクトの include に src/client/**/*.test.{ts,tsx} が含まれる", () => {
    expect(clientBlock).toContain('"src/client/**/*.test.{ts,tsx}"');
  });

  it("client プロジェクトの include に tests/**/*.test.tsx が含まれる", () => {
    expect(clientBlock).toContain('"tests/**/*.test.tsx"');
  });
});

describe("vitest.config.ts: node プロジェクト設定", () => {
  const nodeBlock = extractProjectBlock(configText, "node");

  it('node プロジェクトの environment が "node" である', () => {
    expect(nodeBlock).toMatch(/environment:\s*["']node["']/);
  });

  it("node プロジェクトの exclude が src/client/** を除外している", () => {
    expect(nodeBlock).toMatch(/exclude:\s*\[[^\]]*src\/client\/\*\*[^\]]*\]/);
  });

  it("node プロジェクトの exclude が configDefaults.exclude を展開している（既定除外を維持）", () => {
    expect(nodeBlock).toContain("...configDefaults.exclude");
  });
});

describe("vitest.config.ts: 全体構造", () => {
  it("configDefaults を vitest/config から import している", () => {
    expect(configText).toMatch(
      /import\s*\{[^}]*configDefaults[^}]*\}\s*from\s*["']vitest\/config["']/,
    );
  });

  it("client / node の 2 つのプロジェクト名がそれぞれ 1 回だけ現れる", () => {
    const clientMatches = configText.match(/name:\s*["']client["']/g) ?? [];
    const nodeMatches = configText.match(/name:\s*["']node["']/g) ?? [];
    expect(clientMatches.length).toBe(1);
    expect(nodeMatches.length).toBe(1);
  });
});
