// AppError（hint 任意）→ ApiError（hint 必須）への変換を 1 か所に集約する。
// T-002 レビューの引き継ぎ: hint が未設定の場合はここで既定文言を補う。

import type { AppError } from "../shared/result.js";
import type { ApiError } from "../shared/types.js";

/** hint 未設定時の既定文言。「次にどうするか」が無いエラーに一律で使う。 */
export const DEFAULT_ERROR_HINT = "時間をおいて「更新」を押してください。";

/** AppError を API 応答用の ApiError（`{ error: { code, message, hint } }`）に変換する。 */
export function toApiError(error: AppError): ApiError {
  return {
    error: {
      code: error.code,
      message: error.message,
      // 空文字も「次にどうするか」が無いとみなして既定文言に置き換える
      hint: error.hint || DEFAULT_ERROR_HINT,
    },
  };
}
