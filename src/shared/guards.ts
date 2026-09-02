// 外部入力（JSONL、プロセス出力、設定ファイルなど）を検証するための型ガード。
// `any` は使わず、`unknown` を安全に絞り込む。
// node:* / react への依存禁止。

/** オブジェクト（null でない object）かどうかを判定する。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 文字列かどうかを判定する。 */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** 数値かどうかを判定する（NaN は除く）。 */
export function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

/** 真偽値かどうかを判定する。 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** 配列かどうかを判定する。 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** オブジェクトの指定キーが文字列であればその値を、そうでなければ undefined を返す。 */
export function asString(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) {
    return undefined;
  }
  const value = obj[key];
  return isString(value) ? value : undefined;
}

/** オブジェクトの指定キーが数値であればその値を、そうでなければ undefined を返す。 */
export function asNumber(obj: unknown, key: string): number | undefined {
  if (!isRecord(obj)) {
    return undefined;
  }
  const value = obj[key];
  return isNumber(value) ? value : undefined;
}

/** オブジェクトの指定キーがオブジェクトであればその値を、そうでなければ undefined を返す。 */
export function asRecord(obj: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(obj)) {
    return undefined;
  }
  const value = obj[key];
  return isRecord(value) ? value : undefined;
}
