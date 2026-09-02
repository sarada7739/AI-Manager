// 成功 / 失敗を明示的に表す Result 型。
// 読み取り失敗などを例外に頼らず表現するために使う（CLAUDE.md §4 参照）。
// node:* / react への依存禁止。

/** アプリケーション全体で使う標準的なエラー形状。 */
export interface AppError {
  /** エラーコード。 */
  code: string;
  /** ユーザー・開発者向けのメッセージ。 */
  message: string;
  /** 次にどうすればよいかのヒント（任意）。 */
  hint?: string;
}

/** 成功または失敗のいずれかを表す型。E の既定値は AppError。 */
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

/** 成功結果を作る。 */
export function ok<T, E = AppError>(value: T): Result<T, E> {
  return { ok: true, value };
}

/** 失敗結果を作る。 */
export function err<T, E = AppError>(error: E): Result<T, E> {
  return { ok: false, error };
}

/** 成功結果かどうかを判定する型ガード。 */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

/** 失敗結果かどうかを判定する型ガード。 */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}
