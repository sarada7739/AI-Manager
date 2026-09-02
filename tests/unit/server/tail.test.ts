import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readTailLines } from "../../../src/server/sources/fs/tail";

// T-007: readTailLines の受け入れ条件を検証する。
// 合成ファイルを os.tmpdir() 配下の一時ディレクトリに作成し、実ログには依存しない。

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-manager-tail-test-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFixture(name: string, content: string | Buffer): Promise<string> {
  const filePath = join(dir, name);
  await writeFile(filePath, content);
  return filePath;
}

describe("readTailLines: 小さいファイルの全行取得", () => {
  it("末尾改行ありの小さいファイルは全行を返す", async () => {
    const filePath = await writeFixture("small-with-newline.txt", "line1\nline2\nline3\n");
    const result = await readTailLines(filePath, 1000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["line1", "line2", "line3"]);
    }
  });

  it("末尾改行なしのファイルは最終行が落ちる", async () => {
    const filePath = await writeFixture("small-without-newline.txt", "line1\nline2\nline3");
    const result = await readTailLines(filePath, 1000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["line1", "line2"]);
    }
  });
});

describe("readTailLines: maxBytes による途中読み取りと先頭不完全行の除外", () => {
  // "12345\n" は 6 バイト固定長の行。5 行 = 30 バイト。
  const fixedLine = "12345\n";
  const content = fixedLine.repeat(5);

  it("開始位置がちょうど \\n の直後（行境界）でも先頭の1行は不完全行として捨てられる", async () => {
    const filePath = await writeFixture("fixed-lines-boundary.txt", content);
    // maxBytes=12: startPosition = 30-12 = 18（line4 の先頭ちょうど）
    const result = await readTailLines(filePath, 12);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // line4 は実際には完全行だが、読み取り開始位置の情報だけでは判別できないため保守的に捨てられ、line5 のみ残る
      expect(result.value).toEqual(["12345"]);
    }
  });

  it("開始位置が \\n の1バイト後でも先頭の不完全行は捨てられる", async () => {
    const filePath = await writeFixture("fixed-lines-boundary-2.txt", content);
    // maxBytes=11: startPosition = 30-11 = 19（line4 の1バイト目の次）
    const result = await readTailLines(filePath, 11);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["12345"]);
    }
  });
});

describe("readTailLines: 空ファイル・存在しないパス・maxBytes 境界", () => {
  it("空ファイルは ok([]) を返す", async () => {
    const filePath = await writeFixture("empty.txt", "");
    const result = await readTailLines(filePath, 1000);
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("存在しないパスは err(file_unreadable) を返し message / hint が空でない", async () => {
    const filePath = join(dir, "does-not-exist.txt");
    const result = await readTailLines(filePath, 1000);
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
    const result = await readTailLines(filePath, 0);
    expect(result).toEqual({ ok: true, value: [] });
  });
});

describe("readTailLines: マルチバイト境界", () => {
  // line1: "abc\n"
  // line2: "日本語テスト\n" （各文字 3 バイト。「本」は line2 の2文字目）
  // line3: "def\n"
  const line1 = "abc\n";
  const line2 = "日本語テスト\n";
  const line3 = "def\n";
  const content = line1 + line2 + line3;

  // ハードコードせず Buffer.byteLength から「本」の先頭バイト位置を導出する。
  const line1Bytes = Buffer.byteLength(line1, "utf8");
  const honStart = line1Bytes + Buffer.byteLength("日", "utf8");
  const totalBytes = Buffer.byteLength(content, "utf8");

  it("開始位置が「本」の2バイト目（文字の途中）でも U+FFFD を含まず、壊れた先頭行は捨てられ def のみ返る", async () => {
    const filePath = await writeFixture("multibyte-mid-1.txt", content);
    const startPosition = honStart + 1; // 「本」の2バイト目
    const maxBytes = totalBytes - startPosition;

    const result = await readTailLines(filePath, maxBytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const line of result.value) {
        expect(line).not.toContain("�");
      }
      expect(result.value).toEqual(["def"]);
    }
  });

  it("開始位置が「本」の3バイト目（文字の途中）でも U+FFFD を含まず、壊れた先頭行は捨てられ def のみ返る", async () => {
    const filePath = await writeFixture("multibyte-mid-2.txt", content);
    const startPosition = honStart + 2; // 「本」の3バイト目
    const maxBytes = totalBytes - startPosition;

    const result = await readTailLines(filePath, maxBytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const line of result.value) {
        expect(line).not.toContain("�");
      }
      expect(result.value).toEqual(["def"]);
    }
  });
});

describe("readTailLines: ディレクトリを渡した場合", () => {
  it("ディレクトリパスは err(file_unreadable) を返し message に「ファイルではない」を含む", async () => {
    const dirPath = join(dir, "a-directory");
    await mkdir(dirPath);
    const result = await readTailLines(dirPath, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("file_unreadable");
      expect(result.error.message).toContain("ファイルではない");
    }
  });
});

describe("readTailLines: MAX_READ_BYTES によるクランプ", () => {
  it("maxBytes に Number.MAX_SAFE_INTEGER を渡しても例外を投げず、小さいファイルの全行を返す（クランプされる）", async () => {
    const filePath = await writeFixture("clamp-small.txt", "line1\nline2\nline3\n");
    const result = await readTailLines(filePath, Number.MAX_SAFE_INTEGER);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["line1", "line2", "line3"]);
    }
  });
});

describe("readTailLines: 約200KBの合成JSONLをmaxBytes 64KBで読む", () => {
  function buildJsonlContent(lineCount: number): string {
    const lines: string[] = [];
    for (let seq = 0; seq < lineCount; seq++) {
      lines.push(JSON.stringify({ seq, data: "x".repeat(200) }));
    }
    return lines.join("\n");
  }

  const LINE_COUNT = 900; // 1行あたり約220バイト * 900 ≒ 200KB
  const MAX_BYTES = 64 * 1024;

  it("末尾改行なしのファイルでは、返る全行がJSON.parseでき最後の行は末尾から2番目の連番になる", async () => {
    const content = buildJsonlContent(LINE_COUNT); // 末尾改行なし
    expect(content.length).toBeGreaterThan(150 * 1024);
    const filePath = await writeFixture("synthetic-no-trailing-newline.jsonl", content);

    const result = await readTailLines(filePath, MAX_BYTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.length).toBeGreaterThan(0);
    const parsed = result.value.map((line) => JSON.parse(line) as { seq: number; data: string });

    // 全行がパースでき、連番が単調増加であること
    for (let i = 1; i < parsed.length; i++) {
      const current = parsed[i];
      const previous = parsed[i - 1];
      expect(current).toBeDefined();
      expect(previous).toBeDefined();
      expect(current?.seq).toBe((previous?.seq ?? -1) + 1);
    }

    // 最終行（連番 LINE_COUNT - 1）は改行なしのため常に捨てられ、末尾から2番目の連番が最後になる
    const lastParsed = parsed.at(-1);
    expect(lastParsed).toBeDefined();
    expect(lastParsed?.seq).toBe(LINE_COUNT - 2);
  });

  it("末尾に改行を付けた場合は最後の行が最後の連番になる", async () => {
    const content = `${buildJsonlContent(LINE_COUNT)}\n`; // 末尾改行あり
    const filePath = await writeFixture("synthetic-with-trailing-newline.jsonl", content);

    const result = await readTailLines(filePath, MAX_BYTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.length).toBeGreaterThan(0);
    const parsed = result.value.map((line) => JSON.parse(line) as { seq: number; data: string });

    for (let i = 1; i < parsed.length; i++) {
      const current = parsed[i];
      const previous = parsed[i - 1];
      expect(current).toBeDefined();
      expect(previous).toBeDefined();
      expect(current?.seq).toBe((previous?.seq ?? -1) + 1);
    }

    const lastParsed = parsed.at(-1);
    expect(lastParsed).toBeDefined();
    expect(lastParsed?.seq).toBe(LINE_COUNT - 1);
  });
});

describe("readTailLines: ファイルハンドルリークの確認", () => {
  it("同じファイルを 100 回連続で読んでも例外が出ない", async () => {
    const filePath = await writeFixture("repeat-read.txt", "line1\nline2\nline3\n");
    for (let i = 0; i < 100; i++) {
      const result = await readTailLines(filePath, 1000);
      expect(result.ok).toBe(true);
    }
  });
});
