import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// T-026: README.md の存在と主要見出しを検査する契約テスト。
// README の内容そのもの（設定例のキー名・除外ファイル一覧など）はテキスト検査で汎用的に
// 保証できないため、ここでは「ファイルが存在し、必須見出しがある」ことだけを機械的に確認する
// （事実確認はタスク報告に別途まとめる）。

const ROOT = process.cwd();
const README_PATH = path.join(ROOT, "README.md");

describe("README.md の存在と主要見出し", () => {
  it("README.md が存在する", () => {
    expect(existsSync(README_PATH)).toBe(true);
  });

  const readme = existsSync(README_PATH) ? readFileSync(README_PATH, "utf-8") : "";

  const requiredHeadings = [
    "前提",
    "セットアップ",
    "起動",
    "設定",
    "読み取り専用",
    "トラブルシュート",
  ];

  it.each(requiredHeadings)('見出し "%s" を含む', (heading) => {
    // Markdown の見出し（# 〜 ######）として存在するかを確認する（本文中の言及だけでは不十分）。
    const headingPattern = new RegExp(`^#{1,6}\\s+.*${heading}`, "m");
    expect(readme, `README.md に見出し "${heading}" が見つからない`).toMatch(headingPattern);
  });

  it("この環境の実ユーザー名・ホームディレクトリを含まない（値は実行時に導出し、テストに埋め込まない）", () => {
    // 実パスの混入は正規表現だけでは網羅的に判定できないため、実行環境から導いた値で機械的に検出する。
    // 実ユーザー名をリテラルで書くと、このテスト自体が個人情報のコミットになるので書かない。
    const lower = readme.toLowerCase();
    const username = os.userInfo().username.toLowerCase();
    const homeBase = path.basename(os.homedir()).toLowerCase();
    for (const secret of new Set([username, homeBase])) {
      // 汎用的な名前（例: "user"）を偶然含む README を誤検出しないよう、3 文字以上のときだけ検査する
      if (secret.length >= 3) {
        expect(lower, "README.md に実ユーザー名が含まれている").not.toContain(secret);
      }
    }
    expect(readme, "README.md に実ホームディレクトリが含まれている").not.toContain(os.homedir());
  });
});

describe("README.md の JSON 例", () => {
  const readme = existsSync(README_PATH) ? readFileSync(README_PATH, "utf-8") : "";
  const fences = [...readme.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");

  it("```json フェンスが 1 件以上ある（設定例が載っている）", () => {
    expect(fences.length).toBeGreaterThan(0);
  });

  it.each(fences.map((body, index) => [index, body]))(
    "```json フェンス %i はそのまま JSON.parse できる（コピーして config.json に使える）",
    (_index, body) => {
      expect(() => JSON.parse(body)).not.toThrow();
    },
  );
});
