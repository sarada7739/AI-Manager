// ファイル末尾の一部だけを読み取り、完全な行だけを返す。
// 25MB 級の JSONL でも全文を読まないための最小読み取り API（CLAUDE.md §4）。
// ロックは取らない。fs.promises.open → read → close(finally) で範囲読み取りする。

import { open } from "node:fs/promises";
import type { Result } from "../../../shared/result.js";
import { err, ok } from "../../../shared/result.js";
import { fileUnreadableError } from "./errors.js";
import { MAX_READ_BYTES, splitCompleteLines } from "./lines.js";

/**
 * ファイル末尾の maxBytes を読み、完全な行（`\n` で終わる行。`\r\n` の `\r` は除去）だけを返す。
 * - `filePath` は呼び出し側で `isUnderRoot` / `isExcludedFile` を通した検証済みパスであること。
 *   本関数はパス検証を行わない。
 * - `maxBytes` が `MAX_READ_BYTES`（8MiB）を超える場合は `MAX_READ_BYTES` にクランプしてから読み取る
 * - 読み取り開始位置が行の途中（＝ファイル先頭から読んでいない）場合、最初の不完全行は捨てる
 * - ファイル全体を読み切れた場合は先頭行も完全とみなす
 * - 末尾に改行が無い最終行は「書き込み途中」の可能性があるため常に捨てる
 *   （ファイルサイズ ≤ maxBytes（クランプ後）で全文を読めた場合も、一貫性のため同様に捨てる）
 * - 空ファイルは `ok([])`
 * - `maxBytes <= 0` は `ok([])`
 * - 対象パスが通常ファイルでない（ディレクトリ等）場合は例外を投げず
 *   `err({ code: "file_unreadable", ... })` を返す
 * - ファイルが存在しない・読み取れない場合も例外を投げず `err({ code: "file_unreadable", ... })` を返す
 */
export async function readTailLines(filePath: string, maxBytes: number): Promise<Result<string[]>> {
  if (maxBytes <= 0) {
    return ok([]);
  }
  const effectiveMaxBytes = Math.min(maxBytes, MAX_READ_BYTES);

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, "r");
  } catch (error) {
    return err(fileUnreadableError(error));
  }

  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      // Windows ではディレクトリの stat.size が 0 になり得るため、size チェックより前に判定する
      return err({
        code: "file_unreadable",
        message: "ファイルではないため読み取れません",
        hint: "パスが通常のファイルを指しているか確認してください",
      });
    }
    if (stat.size === 0) {
      return ok([]);
    }

    const readSize = Math.min(effectiveMaxBytes, stat.size);
    const startPosition = stat.size - readSize;
    const buffer = Buffer.alloc(readSize);
    const { bytesRead } = await handle.read(buffer, 0, readSize, startPosition);
    const readBuffer = bytesRead < readSize ? buffer.subarray(0, bytesRead) : buffer;

    // ファイル先頭から読んでいない場合、バッファの先頭は行の途中から始まっている可能性がある
    const dropFirst = startPosition > 0;

    return ok(
      splitCompleteLines(readBuffer, {
        dropFirst,
        dropLastIfNoNewline: true,
      }),
    );
  } catch (error) {
    return err(fileUnreadableError(error));
  } finally {
    try {
      await handle.close();
    } catch {
      // close 失敗は読み取り結果に影響しないため無視
    }
  }
}
