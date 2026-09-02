import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXCLUDED_FILE_PATTERNS,
  isExcludedFile,
  isUnderRoot,
} from "../../../src/server/sources/fs/safe-path";

// T-006: isUnderRoot / isExcludedFile の受け入れ条件を検証する。
// 実パス・実ユーザー名は使わず、ダミーの "C:\Users\someone\..." を使う（実行環境に依存しない文字列比較のみ）。

const ROOT = path.join("C:\\Users", "someone", ".claude");

describe("isUnderRoot", () => {
  it("root 自身は true", () => {
    expect(isUnderRoot(ROOT, [ROOT])).toBe(true);
  });

  it("root 直下のファイルは true", () => {
    expect(isUnderRoot(path.join(ROOT, "projects", "a.jsonl"), [ROOT])).toBe(true);
  });

  it("深い階層のファイルも true", () => {
    expect(isUnderRoot(path.join(ROOT, "a", "b", "c", "d.jsonl"), [ROOT])).toBe(true);
  });

  it("root 側・candidate 側どちらが大文字小文字違いでも true", () => {
    const upperRoot = ROOT.toUpperCase();
    expect(isUnderRoot(path.join(upperRoot, "x.jsonl"), [ROOT])).toBe(true);
    expect(isUnderRoot(path.join(ROOT, "x.jsonl"), [upperRoot])).toBe(true);
  });

  it("`/` 区切りの candidate でも true", () => {
    const candidate = `${ROOT.replace(/\\/g, "/")}/projects/a.jsonl`;
    expect(isUnderRoot(candidate, [ROOT])).toBe(true);
  });

  it("複数 roots のうちいずれかに含まれれば true", () => {
    const otherRoot = path.join("C:\\Users", "someone", ".codex");
    expect(isUnderRoot(path.join(otherRoot, "sessions", "x.jsonl"), [ROOT, otherRoot])).toBe(true);
  });

  it("`..` で root の外に抜けるパスは false", () => {
    const candidate = path.join(ROOT, "..", "..", "outside", "x.jsonl");
    expect(isUnderRoot(candidate, [ROOT])).toBe(false);
  });

  it("別ドライブのパスは false", () => {
    const candidate = "D:\\Users\\someone\\.claude\\x.jsonl";
    expect(isUnderRoot(candidate, [ROOT])).toBe(false);
  });

  it("root 名に前方一致するだけの別ディレクトリは false（.claude vs .claude2）", () => {
    const base = path.join("C:\\Users", "someone");
    const root = path.join(base, ".claude");
    const candidate = path.join(base, ".claude2", "x.jsonl");
    expect(isUnderRoot(candidate, [root])).toBe(false);
  });

  it("空文字は false", () => {
    expect(isUnderRoot("", [ROOT])).toBe(false);
  });

  it("相対パスは cwd 基準で解決され、root 外なら false", () => {
    expect(isUnderRoot("some/relative/path.jsonl", [ROOT])).toBe(false);
  });

  it("roots が空配列なら常に false", () => {
    expect(isUnderRoot(ROOT, [])).toBe(false);
    expect(isUnderRoot(path.join(ROOT, "x.jsonl"), [])).toBe(false);
  });

  it("candidate が絶対パスでなければ false（root に process.cwd() を含めても解決して true にはしない）", () => {
    // 実装が「候補パスは絶対パスでなければ即 false」を先に判定することを検証する。
    // 仮に path.resolve で cwd 基準に解決してから比較する実装だと、
    // process.cwd() を root に含めた場合に誤って true になってしまう。
    expect(isUnderRoot("a/b.jsonl", [process.cwd()])).toBe(false);
  });
});

describe("EXCLUDED_FILE_PATTERNS", () => {
  it("export されており、少なくとも 1 件以上のパターンを含む", () => {
    expect(Array.isArray(EXCLUDED_FILE_PATTERNS)).toBe(true);
    expect(EXCLUDED_FILE_PATTERNS.length).toBeGreaterThan(0);
  });

  it("settings.json / settings.local.json の完全一致エントリは持たず、settings*.json に包含させる", () => {
    expect(EXCLUDED_FILE_PATTERNS).not.toContain("settings.json");
    expect(EXCLUDED_FILE_PATTERNS).not.toContain("settings.local.json");
    expect(EXCLUDED_FILE_PATTERNS).toContain("settings*.json");
  });
});

describe("isExcludedFile", () => {
  it.each([
    ".credentials.json",
    "auth.json",
    "id.key",
    "app.sqlite",
    "app.sqlite-wal",
    "app.sqlite-shm",
    "app.sqlite-journal",
    "app.sqlite3",
    "foo.sqlite.bak",
    "settings.json",
    "settings.local.json",
    "settings-foo.json",
  ])("%s は除外対象 (true)", (name) => {
    expect(isExcludedFile(name)).toBe(true);
  });

  it("大文字のファイル名でも除外される（大文字小文字無視）", () => {
    expect(isExcludedFile("AUTH.JSON")).toBe(true);
    expect(isExcludedFile("x.KEY")).toBe(true);
    expect(isExcludedFile(".CREDENTIALS.JSON")).toBe(true);
    expect(isExcludedFile("SETTINGS.JSON")).toBe(true);
  });

  it.each(["settings.md", "key.txt", "sqlite.txt"])("%s は除外対象ではない (false)", (name) => {
    expect(isExcludedFile(name)).toBe(false);
  });

  it("末尾以外に一致しても除外しない（拡張子の前方一致だけでは弾かない）", () => {
    expect(isExcludedFile("notauth.jsonx")).toBe(false);
    expect(isExcludedFile("credentials.json")).toBe(false);
  });

  // Round 2: 照合前の正規化（path.basename → 末尾ドット・空白除去 → ADS 切り落とし）を検証する。
  describe("照合前の正規化", () => {
    it("フルパスで渡されても basename だけを見て除外対象と判定する", () => {
      expect(isExcludedFile(path.join("C:\\x", ".claude", "auth.json"))).toBe(true);
    });

    it("末尾のドットが付いていても除外対象と判定する（Windows の末尾ドット無視回避策）", () => {
      expect(isExcludedFile("auth.json.")).toBe(true);
    });

    it("末尾の空白が付いていても除外対象と判定する（Windows の末尾空白無視回避策）", () => {
      expect(isExcludedFile("auth.json ")).toBe(true);
    });

    it("代替データストリーム（`:stream`）が付いていても除外対象と判定する", () => {
      expect(isExcludedFile(".credentials.json:stream")).toBe(true);
    });

    it("大文字のファイル名でも除外対象と判定する", () => {
      expect(isExcludedFile("AUTH.JSON")).toBe(true);
    });

    it("大文字のファイル名 + フルパスの組み合わせでも除外対象と判定する", () => {
      expect(isExcludedFile(path.join("C:\\X", ".CLAUDE", "AUTH.JSON"))).toBe(true);
    });
  });
});
