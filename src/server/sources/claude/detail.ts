// Claude Code のセッション JSONL の末尾から、詳細画面用の直近メッセージを取り出す。
// parser.ts と同じ解釈規則（isSidechain / isMeta の user / <synthetic> の assistant / 本文なしの除外）を
// 再利用する（重複実装しない）。ARCHITECTURE.md §4.3, タスクカード T-014 参照。
// パスは呼び出し側（store）が持つ jsonlPath をそのまま受け取るだけで、ここでは組み立てない。

import { asRecord, asString } from "../../../shared/guards.js";
import { maskSecrets } from "../../../shared/masking.js";
import type { Result } from "../../../shared/result.js";
import { err, ok } from "../../../shared/result.js";
import type { RecentMessage } from "../../../shared/types.js";
import { readTailLines } from "../fs/tail.js";
import { extractAssistantText, extractUserText, isIgnorableLine, parseLine } from "./parser.js";

/** 詳細取得のために末尾から読むバイト数。 */
export const DETAIL_TAIL_BYTES = 256 * 1024;
/** 返す直近メッセージの最大件数。 */
export const DETAIL_MAX_MESSAGES = 20;
/** 1 件の本文の最大文字数（超過時は末尾を「…」に置き換え、合計をこの文字数に収める）。 */
export const DETAIL_TEXT_MAX_CHARS = 500;

/** readClaudeDetail が返す断片。 */
export interface DetailParts {
  recentMessages: RecentMessage[];
  parseWarnings: string[];
}

/** readClaudeDetail のオプション（テストでの readTailLines 差し替え用）。 */
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
 * Claude セッション JSONL の末尾 DETAIL_TAIL_BYTES から、直近の user / assistant メッセージを
 * 最大 DETAIL_MAX_MESSAGES 件、時系列順（ファイル内の順）で取り出す。
 * - isSidechain（サブエージェント）の行、isMeta の user 行、model が "<synthetic>" の assistant 行は除外する。
 * - 本文が抽出できない行（tool_result / tool_use のみ等）も除外する。
 * - timestamp を持たない行は除外する。
 * - JSON パースに失敗した行数は parseWarnings に件数だけを入れる（本文・実パスは含めない）。
 * - 読み取り失敗（file_unreadable）はそのまま err を返す。呼び出し側（route）で固定文言に
 *   置き換えること（元の message には実パスが含まれ得るため、そのまま API に出してはならない）。
 */
export async function readClaudeDetail(
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
    if (isIgnorableLine(parsed)) {
      continue;
    }
    if (parsed.type !== "user" && parsed.type !== "assistant") {
      continue;
    }
    const role: "user" | "assistant" = parsed.type === "user" ? "user" : "assistant";

    const message = asRecord(parsed.value, "message");
    if (message === undefined) {
      continue;
    }
    const text =
      role === "user" ? extractUserText(message.content) : extractAssistantText(message.content);
    if (text === null) {
      continue;
    }
    const at = asString(parsed.value, "timestamp");
    if (at === undefined) {
      continue;
    }

    messages.push({ role, at, text: finalizeDetailText(text) });
  }

  const recentMessages = messages.slice(-DETAIL_MAX_MESSAGES);
  const parseWarnings = failures > 0 ? [`${failures} 件の行を解釈できませんでした。`] : [];

  return ok({ recentMessages, parseWarnings });
}
