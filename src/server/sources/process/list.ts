// Windows のプロセス一覧を取得する。
// ARCHITECTURE.md §7「子プロセスは process/list.ts の固定コマンド（引数なし）のみ。
// ユーザー入力を渡さない」を実装する。ADR-0003 の「running」判定のための材料（プロセス生存確認）を提供する。
//
// 【設計上の注意】
// - `execFile`（`exec` は使わない。シェルを経由しない）で `powershell.exe` を起動する。
// - 引数は本ファイル内の固定定数配列のみ。呼び出し元からのパラメータは一切渡さない。
// - 例外は投げない。失敗はすべて `{ available: false, reason }` に変換する。
// - 結果は `PROCESS_CACHE_MS` の間キャッシュし、同時に複数回呼ばれた場合は
//   進行中の Promise を共有する（子プロセスを 2 本起動しない）。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { asString, isRecord } from "../../../shared/guards.js";

/** プロセス一覧の 1 件。 */
export interface ProcessInfo {
  pid: number;
  name: string;
  /** Windows FILETIME（100ns 単位）。取得できなければ null。 */
  creationFileTime: number | null;
  commandLine: string | null;
}

/** `listProcesses` の結果。 */
export type ProcessListResult =
  | { available: true; processes: ProcessInfo[]; fetchedAt: number }
  | { available: false; reason: string };

/** 子プロセスの実行を差し替えるための関数型（テスト用）。stdout 文字列を返す。失敗は reject。 */
export type ProcessRunner = (file: string, args: readonly string[]) => Promise<string>;

/** `listProcesses` のオプション。 */
export interface ListProcessesOptions {
  runner?: ProcessRunner;
  now?: () => number;
}

/** キャッシュの有効期間（ミリ秒）。 */
export const PROCESS_CACHE_MS = 2000;

/**
 * PowerShell に渡す固定スクリプト。
 * `claude` / `codex` で始まるプロセスだけを対象にし、pid / name / creationFileTime / commandLine を
 * JSON 配列で返す。`creationFileTime` は JSON の数値精度（2^53）を超えるため文字列として返す
 * （Node 側で `Number()` に変換する）。`-InputObject` に配列を渡すことで 0 件・1 件でも
 * JSON 配列になる（念のため Node 側でも単一オブジェクトを配列として扱う）。
 *
 * 先頭で `[Console]::OutputEncoding` を UTF-8（BOM なし）に固定している。本機では PowerShell 5.1 の
 * 既定 stdout エンコーディングが CP932 で、`ConvertTo-Json` は非 ASCII をエスケープしないため、
 * コマンドラインに日本語（CP932 の trail byte が `\` (0x5C) になる文字を含む）が 1 本でも
 * 含まれると出力バイト列が壊れ、Node 側の `JSON.parse` が失敗してプロセス列挙全体が
 * `available: false` になる（reviewer が実測済み）。固定定数のままでユーザー入力は増えない。
 */
const PROCESS_LIST_SCRIPT =
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); " +
  "$ErrorActionPreference = 'Stop'; " +
  "$list = @(Get-CimInstance Win32_Process -Filter \"Name LIKE 'claude%' OR Name LIKE 'codex%'\" | " +
  "ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; name = [string]$_.Name; " +
  "creationFileTime = $(if ($_.CreationDate) { [string]$_.CreationDate.ToFileTime() } else { $null }); " +
  "commandLine = $_.CommandLine } }); " +
  "ConvertTo-Json -InputObject $list -Compress";

/**
 * `powershell.exe` に渡す固定引数。ユーザー入力を一切含まない。
 * `-ExecutionPolicy Bypass` はインライン `-Command` には効かない（スクリプトファイルではなく
 * コマンド文字列を渡しているため実行ポリシーの対象にならない）ので付けない。
 */
export const PROCESS_LIST_ARGS: readonly string[] = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  PROCESS_LIST_SCRIPT,
];

const PROCESS_LIST_FILE = "powershell.exe";

const execFileAsync = promisify(execFile);

/** 既定の runner。`exec` は使わずシェルを経由しない。 */
async function defaultRunner(file: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(file, [...args], {
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

/** name が対象（claude / codex で始まる。大文字小文字無視）かどうかを判定する。 */
function isTargetProcessName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("claude") || lower.startsWith("codex");
}

/** `creationFileTime` の値（文字列 or 数値 or null）を number | null に変換する。 */
function parseCreationFileTime(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    // 数字だけの文字列に限定する（空文字・`0x10` のような `Number()` が受理してしまう表記を弾く）
    if (!/^\d+$/.test(value)) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** JSON の 1 要素を `ProcessInfo` に変換する。不正な要素は undefined を返す（呼び出し側で捨てる）。 */
function parseProcessInfo(item: unknown): ProcessInfo | undefined {
  if (!isRecord(item)) {
    return undefined;
  }

  const pidValue = item.pid;
  if (typeof pidValue !== "number" || !Number.isInteger(pidValue) || pidValue <= 0) {
    return undefined;
  }

  const name = asString(item, "name");
  if (name === undefined || name.length === 0) {
    return undefined;
  }

  const commandLine = asString(item, "commandLine") ?? null;
  const creationFileTime = parseCreationFileTime(item.creationFileTime);

  return { pid: pidValue, name, creationFileTime, commandLine };
}

/** stdout（JSON 文字列）を `ProcessInfo[]` に変換する。PowerShell 側の LIKE に加えて二重に名前で絞る。 */
function parseProcessListOutput(stdout: string): ProcessInfo[] {
  // `UTF8Encoding($false)` を使っているので通常 BOM は出ないが、環境差に備えて先頭の U+FEFF を
  // 念のため取り除く（`trim()` も U+FEFF を空白として除去するので、これは冗長な保険）。
  const withoutBom = stdout.charCodeAt(0) === 0xfeff ? stdout.slice(1) : stdout;
  const trimmed = withoutBom.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const parsed: unknown = JSON.parse(trimmed);
  // `-InputObject` は配列を渡しているため通常は配列で返るが、念のため単一オブジェクトも配列として扱う
  const items = Array.isArray(parsed) ? parsed : [parsed];

  const processes: ProcessInfo[] = [];
  for (const item of items) {
    const info = parseProcessInfo(item);
    if (info !== undefined && isTargetProcessName(info.name)) {
      processes.push(info);
    }
  }
  return processes;
}

interface CacheEntry {
  result: ProcessListResult;
  fetchedAt: number;
}

let cache: CacheEntry | undefined;
let inFlight: Promise<ProcessListResult> | undefined;

/** 実際にプロセス一覧を取得する（キャッシュ・同時実行の共有を行わない内部関数）。 */
async function fetchProcessList(
  runner: ProcessRunner,
  now: () => number,
): Promise<ProcessListResult> {
  let stdout: string;
  try {
    stdout = await runner(PROCESS_LIST_FILE, PROCESS_LIST_ARGS);
  } catch {
    return {
      available: false,
      reason:
        "プロセス一覧を取得できませんでした。PowerShell の実行に失敗しました。稼働中判定はログの更新時刻のみで行います。",
    };
  }

  let processes: ProcessInfo[];
  try {
    processes = parseProcessListOutput(stdout);
  } catch {
    return {
      available: false,
      reason:
        "プロセス一覧を取得できませんでした。出力の解析に失敗しました。稼働中判定はログの更新時刻のみで行います。",
    };
  }

  return { available: true, processes, fetchedAt: now() };
}

/**
 * `claude` / `codex` で始まる名前のプロセス一覧を取得する。
 * `PROCESS_CACHE_MS` の間キャッシュし、同時に複数回呼ばれた場合は進行中の Promise を共有する。
 * 失敗結果（`available: false`）もキャッシュする。例外は投げない。
 */
export async function listProcesses(opts?: ListProcessesOptions): Promise<ProcessListResult> {
  const runner = opts?.runner ?? defaultRunner;
  const now = opts?.now ?? Date.now;

  if (cache !== undefined && now() - cache.fetchedAt < PROCESS_CACHE_MS) {
    return cache.result;
  }

  if (inFlight !== undefined) {
    return inFlight;
  }

  const promise = fetchProcessList(runner, now)
    .then((result) => {
      cache = { result, fetchedAt: now() };
      return result;
    })
    .finally(() => {
      inFlight = undefined;
    });

  inFlight = promise;
  return promise;
}

/** キャッシュを破棄する（テストと明示的な再走査用）。 */
export function clearProcessListCache(): void {
  cache = undefined;
  inFlight = undefined;
}

// `--resume` の値部分だけを取り出す。値が `-` で始まる場合（例: `--resume --model x` の
// `--model`）はオプションの取り違えなので捕捉しない（先頭が `-` 以外の 1 文字目 + それ以降の
// 非空白・非ダブルクォート文字、という形にする）。
const RESUME_ID_PATTERN = /--resume[= ]"?([^\s"-][^\s"]*)"?/;

/** コマンドラインから `--resume=<id>` または `--resume <id>` の id を取り出す。無ければ null。 */
export function extractResumeId(commandLine: string | null): string | null {
  if (commandLine === null) {
    return null;
  }
  const match = RESUME_ID_PATTERN.exec(commandLine);
  if (match === null) {
    return null;
  }
  return match[1] ?? null;
}
