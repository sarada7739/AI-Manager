// toApiError の単体テスト。AppError（hint 任意）→ ApiError（hint 必須）の変換を検証する。

import { describe, expect, it } from "vitest";
import { DEFAULT_ERROR_HINT, toApiError } from "../../../src/server/errors";

describe("toApiError", () => {
  it("hint がある場合はそのまま使われる", () => {
    const result = toApiError({
      code: "config_invalid",
      message: "設定が不正です。",
      hint: "個別のヒント",
    });

    expect(result).toEqual({
      error: { code: "config_invalid", message: "設定が不正です。", hint: "個別のヒント" },
    });
  });

  it("hint が未設定（undefined）の場合は DEFAULT_ERROR_HINT が使われる", () => {
    const result = toApiError({ code: "internal", message: "内部エラーです。" });

    expect(result).toEqual({
      error: { code: "internal", message: "内部エラーです。", hint: DEFAULT_ERROR_HINT },
    });
  });

  it("hint が空文字の場合も「次にどうするか」が無いとみなし既定文言に置き換える", () => {
    const result = toApiError({ code: "internal", message: "内部エラーです。", hint: "" });

    expect(result.error.hint).toBe(DEFAULT_ERROR_HINT);
  });

  it("code / message はそのまま転記される", () => {
    const result = toApiError({
      code: "not_found",
      message: "見つかりません。",
      hint: "確認してください。",
    });

    expect(result.error.code).toBe("not_found");
    expect(result.error.message).toBe("見つかりません。");
  });
});
