// Claude Code のセッション JSONL（1 行 1 JSON）を解釈し、一覧表示に必要な断片を取り出す。
// 純粋関数のみ。node:* を import しない。全文は読まず、readHeadLines / readTailLines（T-007）が
// 読んだ先頭・末尾の行だけを材料にする。ARCHITECTURE.md §2 sources/claude/parser.ts に対応。

import {
  asRecord,
  asString,
  isArray,
  isBoolean,
  isRecord,
  isString,
} from "../../../shared/guards.js";
import type { Entrypoint } from "../../../shared/types.js";
import { CLAUDE_SESSION_ID_PATTERN } from "./locator.js";

/** `parseClaudeSummary` が返す断片。 */
export interface ClaudeSummaryParts {
  cwd: string | null;
  version: string | null;
  /** "cli" / "claude-desktop" のみ採用。それ以外・欠落は "unknown"。 */
  entrypoint: Entrypoint;
  /** 生値。"HEAD" → null の正規化は索引側（T-012）の担当。 */
  gitBranch: string | null;
  /** 最初に解釈できた行の timestamp（ISO 文字列）。 */
  firstAt: string | null;
  /** 最後に解釈できた行の timestamp。 */
  lastAt: string | null;
  /** 最後の assistant 行の message.model（"<synthetic>" は無視）。 */
  model: string | null;
  title: string | null;
  /** 切り詰め・マスクはしない（T-012 の索引側が担当）。 */
  lastMessage: string | null;
  lastRole: "user" | "assistant" | null;
  /** bridge-session.ownerAccountUuid（小文字化）。UUID 形式でなければ null。 */
  ownerAccountUuid: string | null;
  /** 解釈できなかった行数（JSON パース失敗・非オブジェクト・`type` が文字列でない行。head + tail の合計）。 */
  parseFailures: number;
}

/** JSONL 1 行分の共通の型。`type` だけを保証し、それ以外のフィールドは種別ごとに読む。 */
interface ClaudeLine {
  type: string;
  value: Record<string, unknown>;
}

/** lastMessage / lastRole の 1 件。 */
interface LastMessageResult {
  message: string;
  role: "user" | "assistant";
}

/**
 * head / tail の行配列から Claude セッションの要約断片を取り出す純粋関数。
 *
 * - 各行は JSON.parse してオブジェクトであり、かつ `type` が文字列であることを要求する。
 *   パース失敗・非オブジェクト・`type` が文字列でない行はスキップし `parseFailures` を加算する。
 *   形が合っていても未知の `type` の行は無視するだけで `parseFailures` には数えない。
 * - `isSidechain: true` の行（サブエージェント）、`isMeta: true` の user 行（システム注入）、
 *   `message.model === "<synthetic>"` の assistant 行（内部生成）は、cwd / version / gitBranch /
 *   entrypoint / model と、user / assistant 本文に基づく title / lastMessage の抽出から除外する
 *   （custom-title / ai-title / last-prompt / bridge-session の行は user / assistant ではないため対象外）。
 * - lastMessage は tail の user / assistant → 最後の `last-prompt` → head の user / assistant の順で探す
 *   （`last-prompt` はターンごとに追記されるため、tail にあれば head の本文より新しい）。
 * - head と tail は同じ行を含み得る（小さいファイル）。重複排除はしない。`parseFailures` は合計。
 * - head / tail が両方空でも例外を投げず、すべて null（`entrypoint: "unknown"`, `parseFailures: 0`）を返す。
 */
export function parseClaudeSummary(
  headLines: readonly string[],
  tailLines: readonly string[],
): ClaudeSummaryParts {
  const head = parseRecords(headLines);
  const tail = parseRecords(tailLines);
  const parseFailures = head.failures + tail.failures;

  const headUsable = head.records.filter((line) => !isIgnorableLine(line));
  const tailUsable = tail.records.filter((line) => !isIgnorableLine(line));
  const usable = [...headUsable, ...tailUsable];
  const all = [...head.records, ...tail.records];

  const cwd = firstFieldValue(usable, "cwd");
  const version = firstFieldValue(usable, "version");
  const gitBranch = firstFieldValue(usable, "gitBranch");
  const entrypoint = resolveEntrypoint(firstFieldValue(usable, "entrypoint"));

  const model = lastAssistantModel(all);

  const customTitle = lastNonEmptyField(all, "custom-title", "customTitle");
  const aiTitle = lastNonEmptyField(all, "ai-title", "aiTitle");
  const title = customTitle ?? aiTitle ?? firstUserTitleLine(usable) ?? null;

  const lastPrompt = lastNonEmptyField(all, "last-prompt", "lastPrompt");
  const last =
    findLastUserOrAssistant(tailUsable) ??
    (lastPrompt !== null ? { message: lastPrompt, role: "user" as const } : null) ??
    findLastUserOrAssistant(headUsable);

  return {
    cwd,
    version,
    entrypoint,
    gitBranch,
    firstAt: firstTimestamp(head.records) ?? firstTimestamp(tail.records),
    lastAt: lastTimestamp(tail.records) ?? lastTimestamp(head.records),
    model,
    title,
    lastMessage: last !== null ? last.message : null,
    lastRole: last !== null ? last.role : null,
    ownerAccountUuid: firstOwnerAccountUuid(all),
    parseFailures,
  };
}

/** オブジェクトの指定キーが真偽値であればその値を、そうでなければ undefined を返す。 */
function asBoolean(obj: unknown, key: string): boolean | undefined {
  if (!isRecord(obj)) {
    return undefined;
  }
  const value = obj[key];
  return isBoolean(value) ? value : undefined;
}

/** 1 行を ClaudeLine にパースする。失敗（JSON 不正・非オブジェクト・type 欠落/非文字列）は null。 */
function parseLine(raw: string): ClaudeLine | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(json)) {
    return null;
  }
  const type = asString(json, "type");
  if (type === undefined) {
    return null;
  }
  return { type, value: json };
}

/** 行配列をパースし、成功した記録と失敗行数を返す。 */
function parseRecords(lines: readonly string[]): { records: ClaudeLine[]; failures: number } {
  const records: ClaudeLine[] = [];
  let failures = 0;
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed === null) {
      failures += 1;
      continue;
    }
    records.push(parsed);
  }
  return { records, failures };
}

/**
 * サブエージェント（isSidechain）・システム注入（user かつ isMeta）・内部生成
 * （assistant かつ message.model === "<synthetic>"）の行かどうかを判定する。
 * これらは cwd / version / gitBranch / entrypoint / model / title / lastMessage の
 * どの抽出からも除外する。
 */
function isIgnorableLine(line: ClaudeLine): boolean {
  if (asBoolean(line.value, "isSidechain") === true) {
    return true;
  }
  if (line.type === "user" && asBoolean(line.value, "isMeta") === true) {
    return true;
  }
  if (line.type === "assistant") {
    const message = asRecord(line.value, "message");
    if (message !== undefined && asString(message, "model") === "<synthetic>") {
      return true;
    }
  }
  return false;
}

/** user / assistant 行の中から、指定フィールド（トップレベル）の最初の値を返す。 */
function firstFieldValue(records: readonly ClaudeLine[], field: string): string | null {
  for (const record of records) {
    if (record.type !== "user" && record.type !== "assistant") {
      continue;
    }
    const value = asString(record.value, field);
    if (value !== undefined) {
      return value;
    }
  }
  return null;
}

/** assistant 行の message.model のうち、並び順で最後に出現した値を返す（synthetic は事前に除外済み）。 */
function lastAssistantModel(records: readonly ClaudeLine[]): string | null {
  let model: string | null = null;
  for (const record of records) {
    if (record.type !== "assistant" || isIgnorableLine(record)) {
      continue;
    }
    const message = asRecord(record.value, "message");
    if (message === undefined) {
      continue;
    }
    const value = asString(message, "model");
    if (value !== undefined) {
      model = value;
    }
  }
  return model;
}

/** 指定 type の行のうち、指定フィールドが空でない値のうち最後に出現したものを返す。 */
function lastNonEmptyField(
  records: readonly ClaudeLine[],
  type: string,
  field: string,
): string | null {
  let result: string | null = null;
  for (const record of records) {
    if (record.type !== type) {
      continue;
    }
    const value = asString(record.value, field);
    if (value !== undefined && value.length > 0) {
      result = value;
    }
  }
  return result;
}

/**
 * user の message.content から本文を取り出す。
 * 文字列ならそのまま（trim 後に空なら「本文なし」＝ null）。
 * 配列なら type === "text" の text を "\n" で連結。text が無く type === "image" が
 * 1 つでもあれば "(画像)"。どちらも無ければ「本文なし」＝ null（tool_result のみ等）。
 */
function extractUserText(content: unknown): string | null {
  if (isString(content)) {
    return content.trim().length > 0 ? content : null;
  }
  if (isArray(content)) {
    const texts: string[] = [];
    let hasImage = false;
    for (const item of content) {
      if (!isRecord(item)) {
        continue;
      }
      const type = asString(item, "type");
      if (type === "text") {
        const text = asString(item, "text");
        // 空文字は連結対象から外す（区切りの改行だけが残るのを防ぐ。codex/parser.ts と同じ扱い）
        if (text !== undefined && text.length > 0) {
          texts.push(text);
        }
      } else if (type === "image") {
        hasImage = true;
      }
    }
    const joined = texts.join("\n");
    if (joined.length > 0) {
      return joined;
    }
    return hasImage ? "(画像)" : null;
  }
  return null;
}

/**
 * assistant の message.content から本文を取り出す。
 * 配列なら type === "text" の text を "\n" で連結。空なら「本文なし」＝ null
 * （tool_use だけの行はメッセージとして扱わない）。文字列が来た場合はそのまま採用する。
 */
function extractAssistantText(content: unknown): string | null {
  if (isString(content)) {
    return content.length > 0 ? content : null;
  }
  if (isArray(content)) {
    const texts: string[] = [];
    for (const item of content) {
      if (!isRecord(item)) {
        continue;
      }
      if (asString(item, "type") !== "text") {
        continue;
      }
      const text = asString(item, "text");
      // 空文字は連結対象から外す（codex/parser.ts と同じ扱い）
      if (text !== undefined && text.length > 0) {
        texts.push(text);
      }
    }
    const joined = texts.join("\n");
    return joined.length > 0 ? joined : null;
  }
  return null;
}

/**
 * 最初の user メッセージ本文（抽出規則は extractUserText と同じ）の先頭 1 行を返す。
 * 先頭行が空なら次の行、全部空なら次の候補行に進む。
 */
function firstUserTitleLine(records: readonly ClaudeLine[]): string | null {
  for (const record of records) {
    if (record.type !== "user") {
      continue;
    }
    const message = asRecord(record.value, "message");
    if (message === undefined) {
      continue;
    }
    const text = extractUserText(message.content);
    if (text === null) {
      continue;
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
}

/**
 * 記録を末尾から逆走査し、最初に見つかった本文のある user / assistant 行を返す
 * （isSidechain / isMeta / synthetic はすでに除外済みの配列を渡す前提）。
 */
function findLastUserOrAssistant(records: readonly ClaudeLine[]): LastMessageResult | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record === undefined) {
      continue;
    }
    if (record.type === "user") {
      const message = asRecord(record.value, "message");
      if (message === undefined) {
        continue;
      }
      const text = extractUserText(message.content);
      if (text !== null) {
        return { message: text, role: "user" };
      }
      continue;
    }
    if (record.type === "assistant") {
      const message = asRecord(record.value, "message");
      if (message === undefined) {
        continue;
      }
      const text = extractAssistantText(message.content);
      if (text !== null) {
        return { message: text, role: "assistant" };
      }
    }
  }
  return null;
}

/** 記録配列のうち、timestamp を持つ最初の値。 */
function firstTimestamp(records: readonly ClaudeLine[]): string | null {
  for (const record of records) {
    const value = asString(record.value, "timestamp");
    if (value !== undefined) {
      return value;
    }
  }
  return null;
}

/** 記録配列のうち、timestamp を持つ最後の値。 */
function lastTimestamp(records: readonly ClaudeLine[]): string | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record === undefined) {
      continue;
    }
    const value = asString(record.value, "timestamp");
    if (value !== undefined) {
      return value;
    }
  }
  return null;
}

/** bridge-session.ownerAccountUuid のうち最初に見つかった値。小文字化し UUID 形式を検証する。 */
function firstOwnerAccountUuid(records: readonly ClaudeLine[]): string | null {
  for (const record of records) {
    if (record.type !== "bridge-session") {
      continue;
    }
    const value = asString(record.value, "ownerAccountUuid");
    if (value === undefined) {
      continue;
    }
    const lower = value.toLowerCase();
    return CLAUDE_SESSION_ID_PATTERN.test(lower) ? lower : null;
  }
  return null;
}

/** entrypoint の生値から Entrypoint を決定する。"cli" / "claude-desktop" のみ採用。 */
function resolveEntrypoint(raw: string | null): Entrypoint {
  if (raw === "cli" || raw === "claude-desktop") {
    return raw;
  }
  return "unknown";
}
