import { describe, expect, it } from "vitest";
import { fileUnreadableError } from "../../../src/server/sources/fs/errors";

// T-007 Round 2: fileUnreadableError の受け入れ条件を検証する。
// Node の fs エラーコード（ENOENT / EACCES / EISDIR）ごとに hint が異なること、
// コードを持たない cause（{} / string / null）でも例外を投げず汎用的な hint を返すことを確認する。

describe("fileUnreadableError: code / message / hint の基本形", () => {
  it.each([
    ["ENOENT" as const, { code: "ENOENT" }],
    ["EACCES" as const, { code: "EACCES" }],
    ["EISDIR" as const, { code: "EISDIR" }],
    ["空オブジェクト", {}],
    ["文字列", "string"],
    ["null", null],
  ])("cause = %s のとき code は file_unreadable で message / hint が空でない", (_label, cause) => {
    const result = fileUnreadableError(cause);
    expect(result.code).toBe("file_unreadable");
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.hint).toBeTruthy();
    expect((result.hint ?? "").length).toBeGreaterThan(0);
  });
});

describe("fileUnreadableError: 原因ごとに異なる hint を出し分ける", () => {
  it("ENOENT と EACCES の hint は異なる", () => {
    const enoent = fileUnreadableError({ code: "ENOENT" });
    const eacces = fileUnreadableError({ code: "EACCES" });
    expect(enoent.hint).not.toBe(eacces.hint);
  });

  it("EACCES と EISDIR の hint は異なる", () => {
    const eacces = fileUnreadableError({ code: "EACCES" });
    const eisdir = fileUnreadableError({ code: "EISDIR" });
    expect(eacces.hint).not.toBe(eisdir.hint);
  });

  it("ENOENT と EISDIR の hint は異なる", () => {
    const enoent = fileUnreadableError({ code: "ENOENT" });
    const eisdir = fileUnreadableError({ code: "EISDIR" });
    expect(enoent.hint).not.toBe(eisdir.hint);
  });

  it("ENOENT の hint はパス不在について言及する", () => {
    const result = fileUnreadableError({ code: "ENOENT" });
    expect(result.hint).toContain("存在しません");
  });

  it("EACCES の hint は権限について言及する", () => {
    const result = fileUnreadableError({ code: "EACCES" });
    expect(result.hint).toContain("権限");
  });

  it("EISDIR の hint はディレクトリについて言及する", () => {
    const result = fileUnreadableError({ code: "EISDIR" });
    expect(result.hint).toContain("ディレクトリ");
  });

  it("code を持たない cause（{}）は汎用的な hint を返し、ENOENT の hint とは異なる", () => {
    const generic = fileUnreadableError({});
    const enoent = fileUnreadableError({ code: "ENOENT" });
    expect(generic.hint).not.toBe(enoent.hint);
  });

  it("未知のエラーコードは汎用的な hint を返す", () => {
    const result = fileUnreadableError({ code: "EUNKNOWN" });
    expect(result.hint).toBeTruthy();
    expect((result.hint ?? "").length).toBeGreaterThan(0);
  });
});

describe("fileUnreadableError: Error インスタンスの message を detail として使う", () => {
  it("Error インスタンスを渡すと message に元のエラーメッセージが含まれる", () => {
    const cause = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const result = fileUnreadableError(cause);
    expect(result.message).toContain("permission denied");
  });
});

describe("fileUnreadableError: opts.hint による上書き", () => {
  it("opts.hint を渡すと原因の種類にかかわらずそちらを優先する", () => {
    const result = fileUnreadableError({ code: "ENOENT" }, { hint: "呼び出し側指定のヒント" });
    expect(result.code).toBe("file_unreadable");
    expect(result.hint).toBe("呼び出し側指定のヒント");
  });
});
