// Codex CLI の rollout（JSONL 1 行）を解釈し、一覧表示に必要な断片を取り出す。
// 純粋関数のみ。node:* を import しない。
// ADR-0005: session_meta / turn_context / event_msg / response_item の 4 種のみを解釈し、
// 未知の type（および event_msg.payload.type / response_item.payload.type の未知値）は無視する。

import { asRecord, asString, isArray, isRecord, isString } from "../../../shared/guards.js";
import type { Entrypoint } from "../../../shared/types.js";

/** rollout 1 行分の共通形（`{ timestamp, type, payload }`）。 */
interface CodexRecord {
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
}

/** `parseCodexSummary` が返す断片。 */
export interface CodexSummaryParts {
  cwd: string | null;
  /** session_meta.originator の生値。 */
  originator: string | null;
  cliVersion: string | null;
  modelProvider: string | null;
  /** session_meta.git.branch。無ければ null（"HEAD" → null の正規化は索引側 T-012 の担当）。 */
  gitBranch: string | null;
  /** 最後に出現した turn_context.model。 */
  model: string | null;
  /** 最初の event_msg.user_message.message の先頭 1 行（trim。空なら次の候補）。 */
  title: string | null;
  lastMessage: string | null;
  lastRole: "user" | "assistant" | null;
  /** 最初に解釈できた行の timestamp。 */
  firstAt: string | null;
  /** 最後に解釈できた行の timestamp。 */
  lastAt: string | null;
  entrypoint: Entrypoint;
  /** JSON パースに失敗した行数（head + tail）。 */
  parseFailures: number;
}

/**
 * head / tail の行配列から rollout の要約断片を取り出す純粋関数。
 *
 * - 各行は `{ timestamp, type, payload }`（timestamp/type は文字列、payload はオブジェクト）の
 *   形を要求する。JSON パース失敗、または形が合わない行はスキップし `parseFailures` を加算する。
 * - 形が合っていても `type` が未知（session_meta / turn_context / event_msg / response_item 以外）の
 *   行は無視するだけで `parseFailures` には数えない。
 * - head と tail は同じ行を含み得る（小さいファイル）。重複排除はしない。
 * - 本文の切り詰め・マスクは行わない（T-012 の索引側が担当）。
 * - head / tail が両方空でも例外を投げず、すべて null（`entrypoint: "unknown"`, `parseFailures: 0`）を返す。
 */
export function parseCodexSummary(
  headLines: readonly string[],
  tailLines: readonly string[],
): CodexSummaryParts {
  const head = parseRecords(headLines);
  const tail = parseRecords(tailLines);
  const parseFailures = head.failures + tail.failures;

  const sessionMeta =
    findFirstByType(head.records, "session_meta") ?? findFirstByType(tail.records, "session_meta");
  const cwd = sessionMeta !== null ? (asString(sessionMeta.payload, "cwd") ?? null) : null;
  const originator =
    sessionMeta !== null ? (asString(sessionMeta.payload, "originator") ?? null) : null;
  const cliVersion =
    sessionMeta !== null ? (asString(sessionMeta.payload, "cli_version") ?? null) : null;
  const modelProvider =
    sessionMeta !== null ? (asString(sessionMeta.payload, "model_provider") ?? null) : null;
  const gitBranch = extractGitBranch(sessionMeta);

  const model = lastTurnContextModel([...head.records, ...tail.records]);
  const title = firstUserMessageTitle(head.records) ?? firstUserMessageTitle(tail.records);
  const last = findLastMessage(tail.records) ?? findLastMessage(head.records);

  return {
    cwd,
    originator,
    cliVersion,
    modelProvider,
    gitBranch,
    model,
    title,
    lastMessage: last !== null ? last.message : null,
    lastRole: last !== null ? last.role : null,
    firstAt: firstTimestamp(head.records) ?? firstTimestamp(tail.records),
    lastAt: lastTimestamp(tail.records) ?? lastTimestamp(head.records),
    entrypoint: resolveEntrypoint(originator),
    parseFailures,
  };
}

/** 1 行を CodexRecord にパースする。失敗（JSON 不正・形不一致）は null。 */
function parseLine(raw: string): CodexRecord | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(json)) {
    return null;
  }
  const timestamp = asString(json, "timestamp");
  const type = asString(json, "type");
  const payload = asRecord(json, "payload");
  if (timestamp === undefined || type === undefined || payload === undefined) {
    return null;
  }
  return { timestamp, type, payload };
}

/** 行配列をパースし、成功した記録と失敗行数を返す。 */
function parseRecords(lines: readonly string[]): { records: CodexRecord[]; failures: number } {
  const records: CodexRecord[] = [];
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

/** 指定した type の最初の記録を返す。 */
function findFirstByType(records: readonly CodexRecord[], type: string): CodexRecord | null {
  return records.find((record) => record.type === type) ?? null;
}

/** session_meta.payload.git.branch を取り出す。 */
function extractGitBranch(sessionMeta: CodexRecord | null): string | null {
  if (sessionMeta === null) {
    return null;
  }
  const git = asRecord(sessionMeta.payload, "git");
  if (git === undefined) {
    return null;
  }
  return asString(git, "branch") ?? null;
}

/** turn_context.payload.model のうち、記録の並び順で最後に出現した値を返す。 */
function lastTurnContextModel(records: readonly CodexRecord[]): string | null {
  let model: string | null = null;
  for (const record of records) {
    if (record.type !== "turn_context") {
      continue;
    }
    const value = asString(record.payload, "model");
    if (value !== undefined) {
      model = value;
    }
  }
  return model;
}

/** 最初の event_msg.user_message.message の先頭 1 行（trim 後、空なら次の候補へ）。 */
function firstUserMessageTitle(records: readonly CodexRecord[]): string | null {
  for (const record of records) {
    if (record.type !== "event_msg") {
      continue;
    }
    if (asString(record.payload, "type") !== "user_message") {
      continue;
    }
    const message = asString(record.payload, "message");
    if (message === undefined) {
      continue;
    }
    const [firstLine] = message.split("\n");
    const trimmed = firstLine !== undefined ? firstLine.trim() : "";
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

/** lastMessage / lastRole の 1 件。 */
interface LastMessage {
  message: string;
  role: "user" | "assistant";
}

/**
 * 記録を末尾から逆走査し、最初に見つかった次のいずれかを返す。
 * (a) event_msg.task_complete.last_agent_message（空でない）→ role: assistant
 * (b) response_item（type: message, role: user/assistant, 本文が空でない）
 * (c) event_msg.user_message.message（空でない）→ role: user
 */
function findLastMessage(records: readonly CodexRecord[]): LastMessage | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record === undefined) {
      continue;
    }

    if (record.type === "event_msg") {
      const payloadType = asString(record.payload, "type");
      if (payloadType === "task_complete") {
        const lastAgentMessage = asString(record.payload, "last_agent_message");
        if (lastAgentMessage !== undefined && lastAgentMessage.length > 0) {
          return { message: lastAgentMessage, role: "assistant" };
        }
        continue;
      }
      if (payloadType === "user_message") {
        const message = asString(record.payload, "message");
        if (message !== undefined && message.length > 0) {
          return { message, role: "user" };
        }
        continue;
      }
      continue;
    }

    if (record.type === "response_item") {
      if (asString(record.payload, "type") !== "message") {
        continue;
      }
      const role = asString(record.payload, "role");
      if (role !== "user" && role !== "assistant") {
        continue;
      }
      const text = extractResponseText(record.payload);
      if (text !== null) {
        return { message: text, role };
      }
    }
  }
  return null;
}

/** `content` 配列要素のうち本文として採用する `type`（`input_text` / `output_text`）。 */
const TEXT_CONTENT_TYPES = new Set(["input_text", "output_text"]);

/** response_item.payload.content（文字列 or `{ type, text }` 配列）から本文を取り出す。 */
function extractResponseText(payload: Record<string, unknown>): string | null {
  const content = payload.content;
  if (isString(content)) {
    return content.length > 0 ? content : null;
  }
  if (isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (!isRecord(item)) {
        continue;
      }
      // type を持つ要素は input_text / output_text だけを対象にする。type が無い要素は
      // 未知形への寛容さを残すためそのまま許可する。
      const type = asString(item, "type");
      if (type !== undefined && !TEXT_CONTENT_TYPES.has(type)) {
        continue;
      }
      const text = asString(item, "text");
      // 空文字は「本文なし」として連結対象から外す（区切りの "\n" だけが残るのを防ぐ）
      if (text !== undefined && text.length > 0) {
        parts.push(text);
      }
    }
    const joined = parts.join("\n");
    return joined.length > 0 ? joined : null;
  }
  return null;
}

/** 記録配列の最初の timestamp。 */
function firstTimestamp(records: readonly CodexRecord[]): string | null {
  const [first] = records;
  return first !== undefined ? first.timestamp : null;
}

/** 記録配列の最後の timestamp。 */
function lastTimestamp(records: readonly CodexRecord[]): string | null {
  const last = records.at(-1);
  return last !== undefined ? last.timestamp : null;
}

/** originator から entrypoint を決定する。 */
function resolveEntrypoint(originator: string | null): Entrypoint {
  if (originator === "codex_exec") {
    return "codex-exec";
  }
  if (originator === "codex_cli_rs") {
    return "codex-tui";
  }
  return "unknown";
}
