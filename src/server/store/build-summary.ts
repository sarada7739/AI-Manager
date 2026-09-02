// 1 セッション分の SessionSummary を組み立てる補助関数群。
// index.ts から呼ばれる純粋寄りのビルダー（読み取りは deps 経由で行うため副作用はあるが、
// ファイルパスの組み立ては locator が返した既存パスへの path.join のみに限定する）。
// ARCHITECTURE.md §2.1「ファイルパスの組み立ては sources と config のみ」に反しない範囲で、
// custom-title.json のパスだけは `projects/<dir>/<sessionId>/custom-title.json` の組み立てを
// ここで行う（タスクカードの設計で明示的に許可された唯一の例外）。

import path from "node:path";
import { normalizeBranch } from "../../shared/format.js";
import { asString } from "../../shared/guards.js";
import { maskSecrets } from "../../shared/masking.js";
import type { Result } from "../../shared/result.js";
import { ok } from "../../shared/result.js";
import type { StateInput } from "../../shared/state.js";
import { resolveState } from "../../shared/state.js";
import type { Entrypoint, SessionState, SessionSummary, StateReason } from "../../shared/types.js";
import type { ClaudeSessionFile } from "../sources/claude/locator.js";
import { parseClaudeSummary } from "../sources/claude/parser.js";
import type { RunningMatch, RunningMeta } from "../sources/claude/running.js";
import { matchRunning } from "../sources/claude/running.js";
import type { CodexSessionFile } from "../sources/codex/locator.js";
import { parseCodexSummary } from "../sources/codex/parser.js";
import type { readHeadLines } from "../sources/fs/head.js";
import type { readTailLines } from "../sources/fs/tail.js";
import type { ProcessInfo } from "../sources/process/list.js";
import { extractResumeId } from "../sources/process/list.js";

/** head / tail を分けて読むか、まとめて読むかの閾値（タスクカードの設計どおり）。 */
export const HEAD_BYTES = 64 * 1024;
export const TAIL_BYTES = 64 * 1024;
export const LAST_MESSAGE_MAX_CHARS = 200;
export const TITLE_MAX_CHARS = 120;
export const UNTITLED = "(無題)";

/** ログファイルを読み取れなかったときに表示する固定文言（実パス・エラー詳細を含めない）。 */
const FILE_READ_ERROR_MESSAGE =
  "ログファイルを読み取れませんでした。ファイルの権限を確認するか「更新」を押してください。";

/** システム注入テキストの先頭タグ判定（例: `<command-name>`, `<system-reminder>`）。 */
const SYSTEM_TAG_PATTERN = /^<[a-z][a-z0-9-]*>/;

type ReadHeadLinesFn = typeof readHeadLines;
type ReadTailLinesFn = typeof readTailLines;

/** 1 セッションの組み立て結果。索引側でのみ使う内部形（refreshFiles のパス照合・重複解消用）。 */
export interface IndexedSession {
  summary: SessionSummary;
  /** 元ファイルの絶対パス。refreshFiles でのパス一致判定にのみ使う（ログ・API には出さない）。 */
  jsonlPath: string;
  /** このセッションを産出した root。refreshFiles でロケータを再実行する root の特定に使う。 */
  root: string;
  /** file.mtime の生値（重複セッションの新旧比較に使う）。 */
  mtimeMs: number;
}

/** 文字列の末尾を省略し「…」で終える形で max 文字に収める（先頭を残す。folder 表示用の truncateStart とは逆向き）。 */
function truncateEnd(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  if (max <= 1) {
    return "…";
  }
  return `${text.slice(0, max - 1)}…`;
}

/** タイトル候補が空でないかどうかを判定する。 */
function isNonEmpty(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

/** タイトル候補がシステム注入テキスト（`<command-name>` 等）かどうかを判定する。 */
function isSystemTag(value: string): boolean {
  return SYSTEM_TAG_PATTERN.test(value);
}

/**
 * タイトルを確定する。候補が無ければ UNTITLED。
 * maskSecrets → 改行を空白に置換 → trim → TITLE_MAX_CHARS 文字に切る。
 */
function finalizeTitle(raw: string | null): string {
  if (!isNonEmpty(raw)) {
    return UNTITLED;
  }
  const masked = maskSecrets(raw);
  const collapsed = masked.replace(/\r?\n/g, " ").trim();
  if (collapsed.length === 0) {
    return UNTITLED;
  }
  return truncateEnd(collapsed, TITLE_MAX_CHARS);
}

/**
 * 最終メッセージを確定する。
 * maskSecrets → 連続する空白・改行を 1 つの空白に畳んで trim → LAST_MESSAGE_MAX_CHARS 文字に切る。
 */
function finalizeLastMessage(raw: string | null): string {
  const masked = maskSecrets(raw ?? "");
  const collapsed = masked.replace(/\s+/g, " ").trim();
  return truncateEnd(collapsed, LAST_MESSAGE_MAX_CHARS);
}

/**
 * `custom-title.json` を読み、`customTitle` が空でない文字列ならそれを返す。
 * 読み取り・JSON 解析に失敗した場合は null（呼び出し側で parts.title にフォールバックする）。
 */
async function readCustomTitle(
  readHead: ReadHeadLinesFn,
  projectDir: string,
  sessionId: string,
): Promise<string | null> {
  // custom-title.json のパス組み立てはタスクカードで明示的に許可された例外（既存の projectDir への join のみ）。
  const filePath = path.join(projectDir, sessionId, "custom-title.json");
  const result = await readHead(filePath, 64 * 1024);
  if (!result.ok) {
    return null;
  }
  const joined = result.value.join("\n");
  if (joined.trim().length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(joined);
  } catch {
    return null;
  }
  const customTitle = asString(parsed, "customTitle");
  return customTitle !== undefined && customTitle.trim().length > 0 ? customTitle : null;
}

/** `readHeadLines` / `readTailLines` の呼び出し方針を決め、head / tail を読む。 */
async function readHeadAndTail(
  readHead: ReadHeadLinesFn,
  readTail: ReadTailLinesFn,
  filePath: string,
  sizeBytes: number,
): Promise<{ head: Result<string[]>; tail: Result<string[]> }> {
  if (sizeBytes <= HEAD_BYTES + TAIL_BYTES) {
    // head / tail の範囲が重なると parseFailures が二重計上されるため、まとめて 1 回だけ読む（T-011 引き継ぎ）。
    const head = await readHead(filePath, HEAD_BYTES + TAIL_BYTES);
    return { head, tail: ok([]) };
  }
  const [head, tail] = await Promise.all([
    readHead(filePath, HEAD_BYTES),
    readTail(filePath, TAIL_BYTES),
  ]);
  return { head, tail };
}

/** `deriveClaudeState` の戻り値。 */
export interface DerivedClaudeState {
  state: SessionState;
  stateReason: StateReason;
  pid: number | null;
  startedAt: string | null;
}

/**
 * Claude セッションの稼働状態（state / stateReason / pid / startedAt）を導出する。
 * `buildClaudeSession`（新規組み立て）と `SessionIndex.refreshFiles`（稼働メタだけの差分再計算）の
 * 両方から呼ばれる共通ロジック（レビュー Round 2 引き継ぎ）。
 * `meta.startedAt` が不正な値で `Date#toISOString` が例外を投げた場合は `startedAt: null` にフォールバックする。
 */
export function deriveClaudeState(
  meta: RunningMeta | undefined,
  match: RunningMatch | null,
  processInfoAvailable: boolean,
  mtimeMs: number,
  nowMs: number,
  activeWindowMinutes: number,
): DerivedClaudeState {
  const stateInput: StateInput = {
    hasProcessMeta: meta !== undefined,
    processAlive: match?.alive ?? false,
    procStartMatches: match?.procStartMatches ?? false,
    processInfoAvailable,
    mtimeMs,
    nowMs,
    activeWindowMinutes,
  };
  const result = resolveState(stateInput);
  const pid = result.state === "running" && meta !== undefined ? meta.pid : null;

  let startedAt: string | null = null;
  if (result.state === "running" && meta !== undefined) {
    try {
      startedAt = new Date(meta.startedAt).toISOString();
    } catch {
      startedAt = null;
    }
  }

  return { state: result.state, stateReason: result.reason, pid, startedAt };
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

/** `buildClaudeSession` の入力。 */
export interface BuildClaudeSessionParams {
  file: ClaudeSessionFile;
  root: string;
  metas: readonly RunningMeta[];
  processes: readonly ProcessInfo[];
  processInfoAvailable: boolean;
  activeWindowMinutes: number;
  nowMs: number;
  readHeadLines: ReadHeadLinesFn;
  readTailLines: ReadTailLinesFn;
}

/** 読み取り失敗時（またはビルド中の想定外の例外の受け皿として）の Claude セッション要約を組み立てる。 */
export function buildClaudeFailedSummary(
  file: ClaudeSessionFile,
  root: string,
  meta: RunningMeta | undefined,
  customTitle: string | null,
): IndexedSession {
  const title = finalizeTitle(isNonEmpty(customTitle) ? customTitle : null);
  const summary: SessionSummary = {
    key: `claude:${file.id}`,
    tool: "claude",
    id: file.id,
    title,
    lastMessage: FILE_READ_ERROR_MESSAGE,
    lastRole: null,
    cwd: meta?.cwd ?? "",
    branch: null,
    model: null,
    entrypoint: meta?.entrypoint ?? "unknown",
    accountKey: "claude:cli",
    state: "error",
    stateReason: "none",
    pid: null,
    startedAt: null,
    firstAt: null,
    updatedAt: new Date(file.mtime).toISOString(),
    logSizeBytes: file.sizeBytes,
    subagentCount: file.subagentCount,
    released: file.released,
  };
  return { summary, jsonlPath: file.jsonlPath, root, mtimeMs: file.mtime };
}

/** 1 件の Claude セッション（head/tail 読み取り〜状態判定まで）を組み立てる。例外は投げない想定（呼び出し側が保険をかける）。 */
export async function buildClaudeSession(
  params: BuildClaudeSessionParams,
): Promise<IndexedSession> {
  const { file, root, metas, processes, processInfoAvailable, activeWindowMinutes, nowMs } = params;

  // file.id（locator）・meta.sessionId（running）はどちらも locator/running 側で小文字化済みのため、
  // ここでは単純な一致判定でよい。
  const meta = metas.find((candidate) => candidate.sessionId === file.id);
  const match = meta !== undefined ? matchRunning(meta, processes) : null;

  const customTitle = file.hasCustomTitleFile
    ? await readCustomTitle(params.readHeadLines, file.projectDir, file.id)
    : null;

  const { head, tail } = await readHeadAndTail(
    params.readHeadLines,
    params.readTailLines,
    file.jsonlPath,
    file.sizeBytes,
  );

  if (!head.ok || !tail.ok) {
    return buildClaudeFailedSummary(file, root, meta, customTitle);
  }

  const parts = parseClaudeSummary(head.value, tail.value);

  const rawTitle =
    customTitle ?? (parts.title !== null && !isSystemTag(parts.title) ? parts.title : null);
  const title = finalizeTitle(rawTitle);
  const lastMessage = finalizeLastMessage(parts.lastMessage);
  const cwd = parts.cwd ?? meta?.cwd ?? "";
  const branch = normalizeBranch(parts.gitBranch);
  const entrypoint: Entrypoint =
    parts.entrypoint !== "unknown" ? parts.entrypoint : (meta?.entrypoint ?? "unknown");
  const accountKey =
    parts.ownerAccountUuid !== null ? `claude:${parts.ownerAccountUuid}` : "claude:cli";

  const derived = deriveClaudeState(
    meta,
    match,
    processInfoAvailable,
    file.mtime,
    nowMs,
    activeWindowMinutes,
  );

  const summary: SessionSummary = {
    key: `claude:${file.id}`,
    tool: "claude",
    id: file.id,
    title,
    lastMessage,
    lastRole: parts.lastRole,
    cwd,
    branch,
    model: parts.model,
    entrypoint,
    accountKey,
    state: derived.state,
    stateReason: derived.stateReason,
    pid: derived.pid,
    startedAt: derived.startedAt,
    firstAt: parts.firstAt,
    updatedAt: new Date(file.mtime).toISOString(),
    logSizeBytes: file.sizeBytes,
    subagentCount: file.subagentCount,
    released: file.released,
  };

  return { summary, jsonlPath: file.jsonlPath, root, mtimeMs: file.mtime };
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

/** `buildCodexSession` の入力。 */
export interface BuildCodexSessionParams {
  file: CodexSessionFile;
  root: string;
  processes: readonly ProcessInfo[];
  processInfoAvailable: boolean;
  activeWindowMinutes: number;
  nowMs: number;
  readHeadLines: ReadHeadLinesFn;
  readTailLines: ReadTailLinesFn;
}

/** 読み取り失敗時（または想定外の例外の受け皿）の Codex セッション要約を組み立てる。 */
export function buildCodexFailedSummary(file: CodexSessionFile, root: string): IndexedSession {
  const summary: SessionSummary = {
    key: `codex:${file.id}`,
    tool: "codex",
    id: file.id,
    title: UNTITLED,
    lastMessage: FILE_READ_ERROR_MESSAGE,
    lastRole: null,
    cwd: "",
    branch: null,
    model: null,
    entrypoint: "unknown",
    accountKey: "codex:unknown",
    state: "error",
    stateReason: "none",
    pid: null,
    startedAt: null,
    firstAt: null,
    updatedAt: new Date(file.mtime).toISOString(),
    logSizeBytes: file.sizeBytes,
    subagentCount: 0,
    released: false,
  };
  return { summary, jsonlPath: file.jsonlPath, root, mtimeMs: file.mtime };
}

/** FILETIME（100ns 単位）を epoch ms に変換する（ADR-0003 の Codex 稼働判定で使う）。 */
const FILETIME_TICKS_PER_MS = 10_000;
const FILETIME_EPOCH_DIFF_MS = 11_644_473_600_000;
function fileTimeToEpochMs(fileTime: number): number {
  return fileTime / FILETIME_TICKS_PER_MS - FILETIME_EPOCH_DIFF_MS;
}

/**
 * Codex プロセスの中から threadId に対応するものを探す。
 * まず `extractResumeId`（`--resume=<id>` / `--resume <id>` の値）が threadId と一致するかを見る。
 * `--resume` が無い（extractResumeId が null の）プロセスに限り、コマンドライン全体への部分一致に
 * フォールバックする（cwd やプロンプト本文に別セッションの UUID が偶然含まれて誤判定する余地を
 * 減らすため。`--resume` はあるが別 id のプロセスは、たとえ commandLine 中に threadId の文字列が
 * どこかに含まれていても採用しない。レビュー Round 2 引き継ぎ）。
 * commandLine の中身は SessionSummary やログに一切出さない（含有判定にのみ使う。T-010 引き継ぎ）。
 */
function findMatchingCodexProcess(
  threadId: string,
  processes: readonly ProcessInfo[],
): ProcessInfo | null {
  const lowerId = threadId.toLowerCase();
  for (const candidate of processes) {
    if (!candidate.name.toLowerCase().startsWith("codex")) {
      continue;
    }
    if (candidate.commandLine === null) {
      continue;
    }
    const resumeId = extractResumeId(candidate.commandLine);
    if (resumeId !== null) {
      if (resumeId.toLowerCase() === lowerId) {
        return candidate;
      }
      continue;
    }
    if (candidate.commandLine.toLowerCase().includes(lowerId)) {
      return candidate;
    }
  }
  return null;
}

/** 1 件の Codex セッションを組み立てる。例外は投げない想定（呼び出し側が保険をかける）。 */
export async function buildCodexSession(params: BuildCodexSessionParams): Promise<IndexedSession> {
  const { file, root, processes, processInfoAvailable, activeWindowMinutes, nowMs } = params;

  const { head, tail } = await readHeadAndTail(
    params.readHeadLines,
    params.readTailLines,
    file.jsonlPath,
    file.sizeBytes,
  );

  if (!head.ok || !tail.ok) {
    return buildCodexFailedSummary(file, root);
  }

  const parts = parseCodexSummary(head.value, tail.value);

  const title = finalizeTitle(parts.title);
  const lastMessage = finalizeLastMessage(parts.lastMessage);
  const branch = normalizeBranch(parts.gitBranch);
  const accountKey = `codex:${parts.modelProvider ?? "unknown"}`;

  // Codex は sessions/<pid>.json に相当するメタが無いため、プロセスのコマンドラインに threadId が
  // 含まれることを「プロセスメタあり + 生存 + procStart 一致」の 3 条件相当として扱う（ADR-0003）。
  const matchedProcess = processInfoAvailable ? findMatchingCodexProcess(file.id, processes) : null;
  const stateInput: StateInput =
    matchedProcess !== null
      ? {
          hasProcessMeta: true,
          processAlive: true,
          procStartMatches: true,
          processInfoAvailable,
          mtimeMs: file.mtime,
          nowMs,
          activeWindowMinutes,
        }
      : {
          hasProcessMeta: false,
          processAlive: false,
          procStartMatches: false,
          processInfoAvailable,
          mtimeMs: file.mtime,
          nowMs,
          activeWindowMinutes,
        };
  const state = resolveState(stateInput);
  const pid = state.state === "running" && matchedProcess !== null ? matchedProcess.pid : null;
  const startedAt =
    state.state === "running" && matchedProcess !== null && matchedProcess.creationFileTime !== null
      ? new Date(fileTimeToEpochMs(matchedProcess.creationFileTime)).toISOString()
      : null;

  const summary: SessionSummary = {
    key: `codex:${file.id}`,
    tool: "codex",
    id: file.id,
    title,
    lastMessage,
    lastRole: parts.lastRole,
    cwd: parts.cwd ?? "",
    branch,
    model: parts.model,
    entrypoint: parts.entrypoint,
    accountKey,
    state: state.state,
    stateReason: state.reason,
    pid,
    startedAt,
    firstAt: parts.firstAt,
    updatedAt: new Date(file.mtime).toISOString(),
    logSizeBytes: file.sizeBytes,
    subagentCount: 0,
    released: false,
  };

  return { summary, jsonlPath: file.jsonlPath, root, mtimeMs: file.mtime };
}
