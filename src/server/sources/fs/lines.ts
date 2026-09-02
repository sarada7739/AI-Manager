// Buffer を完全な行（\n で終わる行）だけの配列に分割する共通処理。
// head.ts / tail.ts の両方から使う。
// node:* 以外の依存なし。

/**
 * head / tail が 1 回の呼び出しで読み取れる最大バイト数（8MiB）。
 * 呼び出し側が指定した maxBytes がこれを超える場合、head.ts / tail.ts はこの値にクランプしてから読み取る。
 * 巨大な JSONL を誤って全文読みしないための上限（CLAUDE.md §4「大きいファイルは全文を読まない」）。
 */
export const MAX_READ_BYTES = 8 * 1024 * 1024;

/** splitCompleteLines のオプション。 */
export interface SplitCompleteLinesOptions {
  /**
   * 先頭の不完全行を捨てるかどうか。
   * tail 側で、読み取り開始位置がファイル先頭でない（＝行の途中から始まっている可能性がある）場合に true にする。
   */
  dropFirst: boolean;
  /**
   * 末尾に改行が無い最終行を捨てるかどうか。
   * ファイル全体を読み切れていない場合や、書き込み途中の可能性がある場合に true にする。
   */
  dropLastIfNoNewline: boolean;
}

const NEWLINE = 0x0a; // "\n"
const CARRIAGE_RETURN = 0x0d; // "\r"

/**
 * Buffer を `\n` で分割し、完全な行だけを文字列配列として返す。
 * - `\r\n` の `\r` は除去する
 * - 空行（長さ 0）は結果に含めない
 * - UTF-8 のデコードは行の境界を確定させた後に行うため、マルチバイト文字が
 *   途中で切れて壊れることはない（境界を跨ぐ不完全な行はそもそも捨てられる）
 */
export function splitCompleteLines(buffer: Buffer, opts: SplitCompleteLinesOptions): string[] {
  if (buffer.length === 0) {
    return [];
  }

  let start = 0;

  if (opts.dropFirst) {
    const firstNewline = buffer.indexOf(NEWLINE);
    if (firstNewline === -1) {
      // 改行が一つも無い = バッファ全体が不完全な 1 行だけ
      return [];
    }
    start = firstNewline + 1;
  }

  const lines: string[] = [];

  while (start < buffer.length) {
    const newlineIndex = buffer.indexOf(NEWLINE, start);

    if (newlineIndex === -1) {
      // 末尾の不完全行（改行で終わっていない）
      if (!opts.dropLastIfNoNewline) {
        pushLine(lines, buffer, start, buffer.length);
      }
      break;
    }

    pushLine(lines, buffer, start, newlineIndex);
    start = newlineIndex + 1;
  }

  return lines;
}

/** buffer[start, end) を \r\n の \r を除去して utf8 デコードし、空行でなければ lines に追加する。 */
function pushLine(lines: string[], buffer: Buffer, start: number, end: number): void {
  let sliceEnd = end;
  if (sliceEnd > start && buffer[sliceEnd - 1] === CARRIAGE_RETURN) {
    sliceEnd -= 1;
  }
  if (sliceEnd <= start) {
    return; // 空行は含めない
  }
  lines.push(buffer.toString("utf8", start, sliceEnd));
}
