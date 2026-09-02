import { describe, expect, it } from "vitest";
import { type AppError, err, isErr, isOk, ok, type Result } from "../../../src/shared/result";

// T-002: Result<T, E = AppError>, ok(), err(), isOk(), isErr() の受け入れ条件を検証する。

describe("ok / err の判別", () => {
  it("ok() は ok: true と value を持つ", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    expect(r).toEqual({ ok: true, value: 42 });
  });

  it("err() は ok: false と error を持つ", () => {
    const e: AppError = { code: "E_TEST", message: "テスト用エラー" };
    const r = err(e);
    expect(r.ok).toBe(false);
    expect(r).toEqual({ ok: false, error: e });
  });

  it("err の hint は省略可能", () => {
    const e: AppError = { code: "E_NO_HINT", message: "hint なし" };
    const r = err(e);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.hint).toBeUndefined();
    }
  });

  it("err の hint を指定できる", () => {
    const e: AppError = { code: "E_HINT", message: "hint あり", hint: "再試行してください" };
    const r = err(e);
    if (!r.ok) {
      expect(r.error.hint).toBe("再試行してください");
    }
  });
});

describe("isOk / isErr の判定", () => {
  it("isOk は ok:true の Result に対して true を返す", () => {
    const r = ok("value");
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
  });

  it("isErr は ok:false の Result に対して true を返す", () => {
    const r = err<string>({ code: "E", message: "失敗" });
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
  });

  it("isOk による型絞り込みでコンパイル時に r.value へアクセスできる", () => {
    const r: Result<number> = ok(7);
    if (isOk(r)) {
      // ここで r.value が number 型としてアクセスできることをコンパイルで検証する
      const value: number = r.value;
      expect(value).toBe(7);
    } else {
      throw new Error("到達しないはず");
    }
  });

  it("isErr による型絞り込みでコンパイル時に r.error へアクセスできる", () => {
    const r: Result<number> = err({ code: "E_FAIL", message: "失敗した" });
    if (isErr(r)) {
      // ここで r.error が AppError 型としてアクセスできることをコンパイルで検証する
      const error: AppError = r.error;
      expect(error.code).toBe("E_FAIL");
    } else {
      throw new Error("到達しないはず");
    }
  });

  it("カスタムエラー型 E を指定した Result でも isOk/isErr が機能する", () => {
    type CustomError = { kind: "custom"; detail: string };
    const r: Result<number, CustomError> = err({ kind: "custom", detail: "詳細" });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      const detail: string = r.error.detail;
      expect(detail).toBe("詳細");
    }
  });
});
