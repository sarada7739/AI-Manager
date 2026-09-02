// fs 読み取り系（head.ts / tail.ts）で重複していた「読み取り失敗 → AppError」変換を 1 か所にまとめる。
// node:fs から投げられるエラー（EISDIR / ENOENT / EACCES 等）の原因ごとに、次にどうすればよいかのヒントを出し分ける。

import { asString } from "../../../shared/guards.js";
import type { AppError } from "../../../shared/result.js";

/**
 * ファイル読み取り失敗を共通のエラー形状（AppError, code: "file_unreadable"）に変換する。
 * - `cause` が Node の fs エラー（`.code` を持つ）であれば、EISDIR / ENOENT / EACCES ごとに異なるヒントを返す。
 * - それ以外の原因は汎用的なヒントを返す。
 * - `opts.hint` を渡した場合は、原因の種類にかかわらずそちらを優先する（呼び出し側で原因を判定済みのケース向け）。
 */
export function fileUnreadableError(cause: unknown, opts?: { hint?: string }): AppError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const code = asString(cause, "code");

  return {
    code: "file_unreadable",
    message: `ファイルを読み取れませんでした: ${detail}`,
    hint: opts?.hint ?? hintForNodeErrorCode(code),
  };
}

/** Node の fs エラーコードごとに、次にどうすればよいかのヒントを返す。 */
function hintForNodeErrorCode(code: string | undefined): string {
  switch (code) {
    case "ENOENT":
      return "ファイルが存在しません。パスを確認してください。";
    case "EACCES":
      return "読み取り権限がありません。ファイルの権限を確認してください。";
    case "EISDIR":
      return "パスがディレクトリを指しています。ファイルを指定してください。";
    default:
      return "ファイルが存在し、読み取り権限があるか確認してください。";
  }
}
