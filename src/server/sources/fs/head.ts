// ファイル先頭の一部だけを読み取り、完全な行だけを返す。
// 25MB 級の JSONL でも全文を読まないための最小読み取り API（CLAUDE.md §4）。
// ロックは取らない。fs.promises.open → read → close(finally) で範囲読み取りする。

import { open } from "node:fs/promises";
import type { Result } from "../../../shared/result.js";
import { err, ok } from "../../../shared/result.js";
import { fileUnreadableError } from "./errors.js";
import { MAX_READ_BYTES, splitCompleteLines } from "./lines.js";

/**
 * ファイル先頭の maxBytes を読み、完全な行（`\n` で終わる行。`\r\n` の `\r` は除去）だけを返す。
 * - `filePath` は呼び出し側で `isUnderRoot` / `isExcludedFile` を通した検証済みパスであること。
 *   本関数はパス検証を行わない。
 * - `maxBytes` が `MAX_READ_BYTES`（8MiB）を超える場合は `MAX_READ_BYTES` にクランプしてから読み取る
 * - 最後の不完全行は捨てる
 * - ファイルサイズが maxBytes（クランプ後）以下で、かつ実際にファイル全体を読み切れた場合は、
 *   末尾に改行が無い最終行も完全な行とみなして返す
 * - 空ファイルは `ok([])`
 * - `maxBytes <= 0` は `ok([])`
 * - 対象パスが通常ファイルでない（ディレクトリ等）場合は例外を投げず
 *   `err({ code: "file_unreadable", ... })` を返す
 * - ファイルが存在しない・読み取れない場合も例外を投げず `err({ code: "file_unreadable", ... })` を返す
 */
export async function readHeadLines(filePath: string, maxBytes: number): Promise<Result<string[]>> {
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
    const buffer = Buffer.alloc(readSize);
    const { bytesRead } = await handle.read(buffer, 0, readSize, 0);
    const readBuffer = bytesRead < readSize ? buffer.subarray(0, bytesRead) : buffer;

    // stat 時点のファイルサイズが maxBytes 以下、かつ実際に全バイトを読み切れた場合のみ
    // 「全文を読み切れた」とみなす（読み取り中の切り詰めを誤って全文扱いしないため）
    const readWholeFile = stat.size <= effectiveMaxBytes && bytesRead === stat.size;

    return ok(
      splitCompleteLines(readBuffer, {
        dropFirst: false,
        dropLastIfNoNewline: !readWholeFile,
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
