// `sessions/<pid>.json`（稼働中プロセスのメタ）の読込と検証、およびプロセス一覧との突合。
// ADR-0003 の running 判定に必要な材料（プロセス生存確認・procStart 一致確認）を集める。
// 判定そのもの（running / active / idle への変換）は `src/shared/state.ts` の `resolveState` が行うため、
// 本ファイルからは呼ばない。
//
// docs/RESEARCH.md §2.2 のスキーマ実測結果に基づく。`.key` ファイルは開かない
// （ARCHITECTURE.md §7「読まないファイル: sessions/*.key」）。

import type { Dirent, Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { asNumber, asString, isRecord } from "../../../shared/guards.js";
import type { Entrypoint } from "../../../shared/types.js";
import { isExcludedFile, isUnderRoot } from "../fs/safe-path.js";
import type { ProcessInfo } from "../process/list.js";

/** `sessions/<pid>.json` から取り出す稼働中メタ情報。 */
export interface RunningMeta {
  /** 正の整数。 */
  pid: number;
  /** 小文字化した UUID。 */
  sessionId: string;
  cwd: string;
  /** epoch ms。 */
  startedAt: number;
  /** Windows FILETIME。 */
  procStart: number;
  entrypoint: Entrypoint;
  version: string | null;
}

/** `readRunningMeta` の結果。 */
export interface ReadRunningMetaResult {
  metas: RunningMeta[];
  warnings: string[];
}

/** `sessions/` 直下で対象とするファイル名パターン（`<pid>.json`）。 */
const SESSION_FILE_NAME_PATTERN = /^(\d+)\.json$/;

/** UUID 形式（大文字小文字無視）。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** メタファイルの想定サイズ上限（数 KB のはずなので余裕を持って 256 KiB）。 */
const MAX_META_FILE_BYTES = 256 * 1024;

/** エラーが ENOENT（存在しない）かどうかを判定する。 */
function isEnoent(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

/** FILETIME 値（数値、または数字だけの文字列）を number に変換する。それ以外は undefined。 */
function parseFileTime(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === "string" && /^[0-9]+$/.test(raw)) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** `entrypoint` の値を検証する。`"cli"` / `"claude-desktop"` 以外・欠落は `"unknown"`。 */
function parseEntrypoint(value: string | undefined): Entrypoint {
  return value === "cli" || value === "claude-desktop" ? value : "unknown";
}

/**
 * JSON をパース済みの値から `RunningMeta` を組み立てる。
 * 型が揃わないもの、`filePid`（ファイル名の `<pid>`）と JSON 内の `pid` が一致しないものは
 * 不正として undefined を返す（別プロセスのメタを誤って採用しないため）。
 * `messagingSocketPath` などの他フィールドは読まない。
 */
function parseRunningMeta(value: unknown, filePid: number): RunningMeta | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const pid = asNumber(value, "pid");
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  if (pid !== filePid) {
    return undefined;
  }

  const rawSessionId = asString(value, "sessionId");
  if (rawSessionId === undefined || !UUID_PATTERN.test(rawSessionId)) {
    return undefined;
  }

  const cwd = asString(value, "cwd");
  if (cwd === undefined) {
    return undefined;
  }

  const startedAt = asNumber(value, "startedAt");
  if (startedAt === undefined) {
    return undefined;
  }

  // procStart（Windows FILETIME）は 2^53 を超えるため、実機では数値ではなく数字の文字列で書かれる
  // （docs/RESEARCH.md §2.2 の追記）。数値・数字文字列のどちらも受け付け、それ以外は不正とする
  const procStart = parseFileTime(value.procStart);
  if (procStart === undefined) {
    return undefined;
  }

  return {
    pid,
    sessionId: rawSessionId.toLowerCase(),
    cwd,
    startedAt,
    procStart,
    entrypoint: parseEntrypoint(asString(value, "entrypoint")),
    version: asString(value, "version") ?? null,
  };
}

/** 1 ファイルを読み、検証済みの `RunningMeta` を返す。読めない・不正な場合は undefined。 */
async function readOneMeta(fullPath: string, filePid: number): Promise<RunningMeta | undefined> {
  let stats: Stats;
  try {
    stats = await stat(fullPath);
  } catch {
    return undefined;
  }
  // メタファイルは数 KB のはず。想定外に大きいファイルは読まずスキップする
  if (!stats.isFile() || stats.size > MAX_META_FILE_BYTES) {
    return undefined;
  }

  let raw: string;
  try {
    raw = await readFile(fullPath, "utf8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  return parseRunningMeta(parsed, filePid);
}

/**
 * `root`（`.claude` 相当のディレクトリ）配下の `sessions/*.json` を読み、
 * 検証済みの `RunningMeta` 一覧を返す。`.key` ファイルは開かない。例外は投げない。
 * - `root` が絶対パスでなければ空配列 + 警告
 * - `sessions/` が無ければ（ENOENT）空配列 + 警告
 * - 通常ファイルかつ `^\d+\.json$` に一致するものだけを対象にする（ディレクトリには入らない）。
 *   シンボリックリンクは多くの場合 `readdir` の `Dirent.isFile()` が false を返す段階で
 *   除外されるが、これは環境依存で完全な保証ではない。最終的な安全性は `parseRunningMeta` の
 *   スキーマ検証（pid が正整数であること、ファイル名の `<pid>` と JSON 内の `pid` が一致すること、
 *   `sessionId` が UUID 形式であること、`procStart` が数値または数字文字列として存在すること）が担保する。
 *   検証を通らないものは不正として捨てるため、リンク先が想定外の内容でも誤って採用されない。
 */
export async function readRunningMeta(root: string): Promise<ReadRunningMetaResult> {
  if (!path.isAbsolute(root)) {
    return {
      metas: [],
      warnings: [
        "root が絶対パスではないため、稼働メタを読み取れません。設定の roots を絶対パスに直してください。",
      ],
    };
  }

  const sessionsDir = path.join(root, "sessions");

  let entries: Dirent[];
  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) {
      return {
        metas: [],
        warnings: [
          "sessions ディレクトリが見つかりません。稼働中のセッションが無いか、Claude Code を一度起動してください。",
        ],
      };
    }
    return {
      metas: [],
      warnings: [
        "sessions ディレクトリを読み取れませんでした。権限を確認するか、しばらくしてから再度お試しください。",
      ],
    };
  }

  const metas: RunningMeta[] = [];
  let invalidCount = 0;

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const fileName = entry.name;
    const match = SESSION_FILE_NAME_PATTERN.exec(fileName);
    if (match === null) {
      continue;
    }
    if (isExcludedFile(fileName)) {
      continue;
    }

    const fullPath = path.join(sessionsDir, fileName);
    if (!isUnderRoot(fullPath, [root])) {
      invalidCount += 1;
      continue;
    }

    const filePidStr = match[1];
    const filePid = filePidStr === undefined ? Number.NaN : Number(filePidStr);
    if (!Number.isInteger(filePid) || filePid <= 0) {
      invalidCount += 1;
      continue;
    }

    const meta = await readOneMeta(fullPath, filePid);
    if (meta === undefined) {
      invalidCount += 1;
      continue;
    }
    metas.push(meta);
  }

  const warnings: string[] = [];
  if (invalidCount > 0) {
    warnings.push(
      `sessions 配下の稼働メタのうち ${invalidCount} 件を読み取れないか形式が不正なためスキップしました。` +
        "ファイルが壊れている場合は該当プロセスを終了すると再作成されます。",
    );
  }

  return { metas, warnings };
}

/** `procStart` と `creationFileTime` の許容差（FILETIME の 100ns 単位。1 秒 = 10_000_000）。 */
export const PROC_START_TOLERANCE_TICKS = 10_000_000;

/** `matchRunning` の結果。 */
export interface RunningMatch {
  /** 同じ pid のプロセスが一覧にあるか。 */
  alive: boolean;
  /** alive かつ procStart と creationFileTime が一致するか。 */
  procStartMatches: boolean;
  /** 一致したプロセス（補助情報）。 */
  process: ProcessInfo | null;
}

/**
 * `meta.pid` と一致するプロセスを `processes` から探し、`procStart` の一致も確認する。
 *
 * 【なぜ厳密一致でないか】
 * procStart は JSON 数値として 2^53 を超えるため JS では下位桁が丸められ、
 * CIM の CreationDate はマイクロ秒精度で FILETIME の下位桁が落ちる。
 * どちらも 1 秒未満のずれなので、PID 再利用の検出（数秒〜数日ずれる）には
 * 1 秒（`PROC_START_TOLERANCE_TICKS`）の許容差で十分。
 */
export function matchRunning(meta: RunningMeta, processes: readonly ProcessInfo[]): RunningMatch {
  const process = processes.find((candidate) => candidate.pid === meta.pid) ?? null;
  if (process === null) {
    return { alive: false, procStartMatches: false, process: null };
  }

  const procStartMatches =
    process.creationFileTime !== null &&
    Math.abs(process.creationFileTime - meta.procStart) <= PROC_START_TOLERANCE_TICKS;

  return { alive: true, procStartMatches, process };
}
