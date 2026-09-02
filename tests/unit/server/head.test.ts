import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readHeadLines } from "../../../src/server/sources/fs/head";

// T-007: readHeadLines の受け入れ条件を検証する。
// 合成ファイルを os.tmpdir() 配下の一時ディレクトリに作成し、実ログには依存しない。

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-manager-head-test-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFixture(name: string, content: string | Buffer): Promise<string> {
  const filePath = join(dir, name);
  await writeFile(filePath, content);
  return filePath;
}

describe("readHeadLines: 小さいファイルの全行取得", () => {
  it("末尾改行ありの小さいファイルは全行を返す", async () => {
    const filePath = await writeFixture("small-with-newline.txt", "line1\nline2\nline3\n");
    const result = await readHeadLines(filePath, 1000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["line1", "line2", "line3"]);
    }
  });

  it("末尾改行なしの小さいファイルは最終行も含めて全行を返す（サイズ <= maxBytes）", async () => {
    const filePath = await writeFixture("small-without-newline.txt", "line1\nline2\nline3");
    const result = await readHeadLines(filePath, 1000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["line1", "line2", "line3"]);
    }
  });
});

describe("readHeadLines: maxBytes による途中切断", () => {
  // "12345\n" は 6 バイト固定長の行。5 行 = 30 バイト。
  const fixedLine = "12345\n";
  const content = fixedLine.repeat(5);

  it("maxBytes がちょうど行末の \\n の位置なら、その行までを完全な行として返す", async () => {
    const filePath = await writeFixture("fixed-lines.txt", content);
    // 12 バイト = 2 行分ちょうど（"12345\n12345\n"）
    const result = await readHeadLines(filePath, 12);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["12345", "12345"]);
    }
  });

  it("maxBytes が行末 \\n の 1 バイト前なら、最後の不完全行は捨てられる", async () => {
    const filePath = await writeFixture("fixed-lines-2.txt", content);
    // 11 バイト = "12345\n1234"（2 行目が不完全）
    const result = await readHeadLines(filePath, 11);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["12345"]);
    }
  });
});

describe("readHeadLines: 空ファイル・存在しないパス・maxBytes 境界", () => {
  it("空ファイルは ok([]) を返す", async () => {
    const filePath = await writeFixture("empty.txt", "");
    const result = await readHeadLines(filePath, 1000);
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("存在しないパスは err(file_unreadable) を返し message / hint が空でない", async () => {
    const filePath = join(dir, "does-not-exist.txt");
    const result = await readHeadLines(filePath, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("file_unreadable");
      expect(result.error.message.length).toBeGreaterThan(0);
      expect(result.error.hint).toBeTruthy();
      expect((result.error.hint ?? "").length).toBeGreaterThan(0);
    }
  });

  it("maxBytes が 0 のとき ok([]) を返す", async () => {
    const filePath = await writeFixture("maxbytes-zero.txt", "line1\nline2\n");
    const result = await readHeadLines(filePath, 0);
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("maxBytes が負のとき ok([]) を返す", async () => {
    const filePath = await writeFixture("maxbytes-negative.txt", "line1\nline2\n");
    const result = await readHeadLines(filePath, -10);
    expect(result).toEqual({ ok: true, value: [] });
  });
});

describe("readHeadLines: マルチバイト境界", () => {
  it("日本語行を maxBytes で文字の途中で切っても U+FFFD を含まない", async () => {
    // line1: "abc\n"
    // line2: "日本語テスト\n"
    // line3: "def\n"
    const line1 = "abc\n";
    const line2 = "日本語テスト\n";
    const line3 = "def\n";
    const content = line1 + line2 + line3;
    const filePath = await writeFixture("multibyte.txt", content);

    // ハードコードせず Buffer.byteLength から「テ」の1バイト目までの位置を導出する。
    // maxBytes = line1 + "日本語" の全バイト数 + 1 バイト
    // → line2 の "テ"（3 バイト文字）の先頭1バイトだけを含む位置で読み取りが切れる
    const line1Bytes = Buffer.byteLength(line1, "utf8");
    const teOffset = line1Bytes + Buffer.byteLength("日本語", "utf8");
    const maxBytes = teOffset + 1;

    const result = await readHeadLines(filePath, maxBytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 壊れた行は丸ごと捨てられるため、置換文字は一切含まれない
      for (const line of result.value) {
        expect(line).not.toContain("�");
      }
      expect(result.value).toEqual(["abc"]);
    }
  });
});

describe("readHeadLines: ディレクトリを渡した場合", () => {
  it("ディレクトリパスは err(file_unreadable) を返し message に「ファイルではない」を含む", async () => {
    const dirPath = join(dir, "a-directory");
    await mkdir(dirPath);
    const result = await readHeadLines(dirPath, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("file_unreadable");
      expect(result.error.message).toContain("ファイルではない");
    }
  });
});

describe("readHeadLines: MAX_READ_BYTES によるクランプ", () => {
  it("maxBytes に Number.MAX_SAFE_INTEGER を渡しても例外を投げず、小さいファイルの全行を返す（クランプされる）", async () => {
    const filePath = await writeFixture("clamp-small.txt", "line1\nline2\nline3\n");
    const result = await readHeadLines(filePath, Number.MAX_SAFE_INTEGER);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["line1", "line2", "line3"]);
    }
  });
});

describe("readHeadLines: ファイルハンドルリークの確認", () => {
  it("同じファイルを 100 回連続で読んでも例外が出ない", async () => {
    const filePath = await writeFixture("repeat-read.txt", "line1\nline2\nline3\n");
    for (let i = 0; i < 100; i++) {
      const result = await readHeadLines(filePath, 1000);
      expect(result.ok).toBe(true);
    }
  });
});
