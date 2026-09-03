// Codex CLI の rollout（JSONL）の末尾から、詳細画面用の直近メッセージを取り出す。
// parser.ts の本文抽出ヘルパーを再利用する（重複実装しない）。ARCHITECTURE.md §4.3, タスクカード T-014 参照。
// パスは呼び出し側（store）が持つ jsonlPath をそのまま受け取るだけで、ここでは組み立てない。

import { asString } from "../../../shared/guards.js";
import { maskSecrets } from "../../../shared/masking.js";
import type { Result } from "../../../shared/result.js";
import { err, ok } from "../../../shared/result.js";
import type { RecentMessage } from "../../../shared/types.js";
import { readTailLines } from "../fs/tail.js";
import { extractResponseText, parseLine } from "./parser.js";

/** 詳細取得のために末尾から読むバイト数。 */
export const DETAIL_TAIL_BYTES = 256 * 1024;
/** 返す直近メッセージの最大件数。 */
export const DETAIL_MAX_MESSAGES = 20;
/** 1 件の本文の最大文字数（超過時は末尾を「…」に置き換え、合計をこの文字数に収める）。 */
export const DETAIL_TEXT_MAX_CHARS = 500;

/** readCodexDetail が返す断片。 */
export interface DetailParts {
  recentMessages: RecentMessage[];
  parseWarnings: string[];
}

/** readCodexDetail のオプション（テストでの readTailLines 差し替え用）。 */
export interface ReadDetailOptions {
  readTailLines?: typeof readTailLines;
}

/**
 * マスク済みの本文を DETAIL_TEXT_MAX_CHARS 文字に切り詰める。
 * 連続する空白・改行は畳まない（詳細画面では改行を保つ）。超過時は末尾を「…」に置き換える。
 */
function finalizeDetailText(raw: string): string {
  const masked = maskSecrets(raw);
  if (masked.length <= DETAIL_TEXT_MAX_CHARS) {
    return masked;
  }
  return `${masked.slice(0, DETAIL_TEXT_MAX_CHARS - 1)}…`;
}

/**
 * Codex rollout の末尾 DETAIL_TAIL_BYTES から、直近の user / assistant メッセージを
 * 最大 DETAIL_MAX_MESSAGES 件、時系列順（ファイル内の順）で取り出す。
 * - response_item: payload.type === "message" かつ role が user / assistant の行のみ（developer は除外）。
 * - event_msg: payload.type === "user_message" の message のみ。
 * - 本文が抽出できない行（tool_use のみ等）・空文字は除外する。
 * - JSON パースに失敗した行数は parseWarnings に件数だけを入れる（本文・実パスは含めない）。
 * - 読み取り失敗（file_unreadable）はそのまま err を返す。呼び出し側（route）で固定文言に
 *   置き換えること（元の message には実パスが含まれ得るため、そのまま API に出してはならない）。
 */
export async function readCodexDetail(
  jsonlPath: string,
  opts?: ReadDetailOptions,
): Promise<Result<DetailParts>> {
  const readTail = opts?.readTailLines ?? readTailLines;
  const tailResult = await readTail(jsonlPath, DETAIL_TAIL_BYTES);
  if (!tailResult.ok) {
    return err(tailResult.error);
  }

  let failures = 0;
  const messages: RecentMessage[] = [];

  for (const raw of tailResult.value) {
    const parsed = parseLine(raw);
    if (parsed === null) {
      failures += 1;
      continue;
    }

    if (parsed.type === "response_item") {
      if (asString(parsed.payload, "type") !== "message") {
        continue;
      }
      const rawRole = asString(parsed.payload, "role");
      if (rawRole !== "user" && rawRole !== "assistant") {
        continue;
      }
      const role: "user" | "assistant" = rawRole === "user" ? "user" : "assistant";
      const text = extractResponseText(parsed.payload);
      if (text === null) {
        continue;
      }
      messages.push({ role, at: parsed.timestamp, text: finalizeDetailText(text) });
      continue;
    }

    if (parsed.type === "event_msg") {
      if (asString(parsed.payload, "type") !== "user_message") {
        continue;
      }
      const message = asString(parsed.payload, "message");
      if (message === undefined || message.length === 0) {
        continue;
      }
      messages.push({ role: "user", at: parsed.timestamp, text: finalizeDetailText(message) });
    }
  }

  const recentMessages = messages.slice(-DETAIL_MAX_MESSAGES);
  const parseWarnings = failures > 0 ? [`${failures} 件の行を解釈できませんでした。`] : [];

  return ok({ recentMessages, parseWarnings });
}
