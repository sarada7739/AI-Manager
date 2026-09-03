// src/server/index.ts はサーバの起動エントリ（サーバを実際に起動するため単体テスト対象外）。
// ここではテキストとして読み、起動順序・バインド先・console 不使用・createApp の import を
// 静的に検証するにとどめる（tester.md 「実際のサーバ・PowerShell を起動しない」）。

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_PATH = path.join(process.cwd(), "src", "server", "index.ts");
const source = fs.readFileSync(SOURCE_PATH, "utf-8");

describe("src/server/index.ts", () => {
  it("createApp を import している", () => {
    expect(source).toMatch(/import\s*\{[^}]*\bcreateApp\b[^}]*\}\s*from\s*["']\.\/app\.js["']/);
  });

  it("loadConfig → rebuild → serve の順で呼ばれている", () => {
    const loadConfigIndex = source.indexOf("loadConfig(");
    const rebuildIndex = source.indexOf(".rebuild(");
    const serveIndex = source.indexOf("serve(");

    expect(loadConfigIndex).toBeGreaterThan(-1);
    expect(rebuildIndex).toBeGreaterThan(-1);
    expect(serveIndex).toBeGreaterThan(-1);
    expect(loadConfigIndex).toBeLessThan(rebuildIndex);
    expect(rebuildIndex).toBeLessThan(serveIndex);
  });

  it('hostname: "127.0.0.1" でバインドしている', () => {
    expect(source).toMatch(/hostname:\s*HOSTNAME/);
    expect(source).toMatch(/HOSTNAME\s*=\s*"127\.0\.0\.1"/);
  });

  it("console. を含まない（CLAUDE.md §4: サーバは console を直接呼ばず log.ts を使う）", () => {
    expect(source).not.toMatch(/console\./);
  });

  it("createApp の呼び出し引数に hub / refresh / readClaudeDetail / readCodexDetail が渡されている（Round 2 レビュー対応）", () => {
    const callText = extractCallBlock(source, "createApp(");
    expect(callText.length).toBeGreaterThan(0);
    expect(callText).toMatch(/\bhub\b/);
    expect(callText).toMatch(/\brefresh\b/);
    expect(callText).toMatch(/\breadClaudeDetail\b/);
    expect(callText).toMatch(/\breadCodexDetail\b/);
  });

  it("closeAllConnections と SIGINT によるシャットダウン処理を含む（Round 2 レビュー対応: SSE 接続中のシャットダウン）", () => {
    expect(source).toMatch(/closeAllConnections/);
    expect(source).toMatch(/SIGINT/);
  });
});

/**
 * `marker`（例: "createApp("）の位置から、対応する閉じ括弧までを括弧の深さで数えて切り出す。
 * 文字列・コメント中の括弧は考慮しない簡易実装だが、このファイル（起動エントリ）のような
 * 制御された自前のソースをテキストとして検証する用途には十分。
 */
function extractCallBlock(text: string, marker: string): string {
  const start = text.indexOf(marker);
  if (start === -1) {
    return "";
  }
  let depth = 0;
  let i = start + marker.length - 1; // marker の末尾は "(" を含む
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  return text.slice(start, i);
}
