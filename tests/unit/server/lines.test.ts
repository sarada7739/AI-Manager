import { describe, expect, it } from "vitest";
import { MAX_READ_BYTES, splitCompleteLines } from "../../../src/server/sources/fs/lines";

// T-007: splitCompleteLines の単体テスト。
// LF / CRLF / 混在、空行の除外、dropFirst true/false、dropLastIfNoNewline true/false、
// 空 Buffer、改行だけの Buffer を検証する。
// MAX_READ_BYTES（head.ts / tail.ts が共有する読み取り上限）の値も検証する。

describe("MAX_READ_BYTES", () => {
  it("8MiB（8 * 1024 * 1024）である", () => {
    expect(MAX_READ_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe("splitCompleteLines: 改行の扱い", () => {
  it("LF 区切りの完全な行だけを返す", () => {
    const buf = Buffer.from("a\nb\nc\n", "utf8");
    const result = splitCompleteLines(buf, { dropFirst: false, dropLastIfNoNewline: false });
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("CRLF の \\r を除去する", () => {
    const buf = Buffer.from("a\r\nb\r\n", "utf8");
    const result = splitCompleteLines(buf, { dropFirst: false, dropLastIfNoNewline: false });
    expect(result).toEqual(["a", "b"]);
  });

  it("LF と CRLF が混在していても正しく分割する", () => {
    const buf = Buffer.from("a\r\nb\nc\r\n", "utf8");
    const result = splitCompleteLines(buf, { dropFirst: false, dropLastIfNoNewline: false });
    expect(result).toEqual(["a", "b", "c"]);
  });
});

describe("splitCompleteLines: 空行の除外", () => {
  it("LF が連続する空行は結果に含めない", () => {
    const buf = Buffer.from("a\n\nb\n", "utf8");
    const result = splitCompleteLines(buf, { dropFirst: false, dropLastIfNoNewline: false });
    expect(result).toEqual(["a", "b"]);
  });

  it("CRLF のみの空行（\\r\\n）も除外する", () => {
    const buf = Buffer.from("a\r\n\r\nb\r\n", "utf8");
    const result = splitCompleteLines(buf, { dropFirst: false, dropLastIfNoNewline: false });
    expect(result).toEqual(["a", "b"]);
  });
});

describe("splitCompleteLines: dropFirst オプション", () => {
  it("dropFirst: false のときは先頭の行も含める", () => {
    const buf = Buffer.from("abc\ndef\n", "utf8");
    const result = splitCompleteLines(buf, { dropFirst: false, dropLastIfNoNewline: false });
    expect(result).toEqual(["abc", "def"]);
  });

  it("dropFirst: true のときは最初の改行までを捨てる", () => {
    const buf = Buffer.from("abc\ndef\n", "utf8");
    const result = splitCompleteLines(buf, { dropFirst: true, dropLastIfNoNewline: false });
    expect(result).toEqual(["def"]);
  });

  it("dropFirst: true で改行が一つも無い場合は空配列を返す", () => {
    const buf = Buffer.from("abcdef", "utf8");
    const result = splitCompleteLines(buf, { dropFirst: true, dropLastIfNoNewline: false });
    expect(result).toEqual([]);
  });

  it("dropFirst: true で Buffer が改行から始まる場合は空文字の先頭行のみ捨てる", () => {
    const buf = Buffer.from("\nabc\n", "utf8");
    const result = splitCompleteLines(buf, { dropFirst: true, dropLastIfNoNewline: false });
    expect(result).toEqual(["abc"]);
  });
});

describe("splitCompleteLines: dropLastIfNoNewline オプション", () => {
  it("dropLastIfNoNewline: true のとき末尾改行なしの最終行を捨てる", () => {
    const buf = Buffer.from("a\nb", "utf8");
    const result = splitCompleteLines(buf, { dropFirst: false, dropLastIfNoNewline: true });
    expect(result).toEqual(["a"]);
  });

  it("dropLastIfNoNewline: false のとき末尾改行なしの最終行も含める", () => {
    const buf = Buffer.from("a\nb", "utf8");
    const result = splitCompleteLines(buf, { dropFirst: false, dropLastIfNoNewline: false });
    expect(result).toEqual(["a", "b"]);
  });

  it("最終行が改行で終わっていれば dropLastIfNoNewline の値に関わらず含める", () => {
    const buf = Buffer.from("a\nb\n", "utf8");
    const withDrop = splitCompleteLines(buf, { dropFirst: false, dropLastIfNoNewline: true });
    const withoutDrop = splitCompleteLines(buf, { dropFirst: false, dropLastIfNoNewline: false });
    expect(withDrop).toEqual(["a", "b"]);
    expect(withoutDrop).toEqual(["a", "b"]);
  });
});

describe("splitCompleteLines: 境界値", () => {
  it("空 Buffer は空配列を返す（オプションに関わらず）", () => {
    const buf = Buffer.alloc(0);
    expect(splitCompleteLines(buf, { dropFirst: false, dropLastIfNoNewline: false })).toEqual([]);
    expect(splitCompleteLines(buf, { dropFirst: true, dropLastIfNoNewline: true })).toEqual([]);
  });

  it("改行だけの Buffer はすべて空行として除外される", () => {
    const buf = Buffer.from("\n\n\n", "utf8");
    const result = splitCompleteLines(buf, { dropFirst: false, dropLastIfNoNewline: false });
    expect(result).toEqual([]);
  });

  it("改行だけの Buffer + dropFirst: true でも空配列", () => {
    const buf = Buffer.from("\n\n\n", "utf8");
    const result = splitCompleteLines(buf, { dropFirst: true, dropLastIfNoNewline: false });
    expect(result).toEqual([]);
  });
});
