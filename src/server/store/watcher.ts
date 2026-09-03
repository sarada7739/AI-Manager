// ファイル監視（fs.watch）とポーリングのフォールバックを組み合わせた監視器。
// ARCHITECTURE.md §2 の server/store/watcher.ts、§4.2「差分更新」に対応する。
// Windows の fs.watch（recursive）は取りこぼしがあり得るため、ポーリングを常に併走させ、
// どちらかで検知した変更を debounce してから 1 回にまとめて呼び出し元に通知する。
//
// 【ファイルを開かない】stat / readdir は sources の locator（locateClaudeSessions /
// locateCodexSessions） と running.ts（readRunningMeta）経由でのみ行う。本ファイルは
// node:fs から `watch` だけを import し、readFile 等は一切呼ばない。
// fs.watch のイベントから「索引対象のパスかどうか」を判定する処理（isIndexRelevantPath）は
// 文字列の分解・照合のみで、stat も readdir も行わない
// （ARCHITECTURE.md §2.1「ファイルパスの組み立ては server/sources と server/config.ts のみ」の
// 例外ではなく、そもそもファイルシステムに触れていない点に注意。実際の存在確認は locator 側が担う）。
// 【ログにパスを出さない】警告・エラーは固定文言のみ。件数はログに出してよい。

import type { FSWatcher } from "node:fs";
import { watch } from "node:fs";
import path from "node:path";
import type { Logger } from "../log.js";
import { CLAUDE_SESSION_ID_PATTERN, locateClaudeSessions } from "../sources/claude/locator.js";
import { readRunningMeta } from "../sources/claude/running.js";
import { CODEX_ROLLOUT_FILE_PATTERN, locateCodexSessions } from "../sources/codex/locator.js";
import { isExcludedFile, isUnderRoot } from "../sources/fs/safe-path.js";

/** 監視モード。`"poll"` はポーリングのみ、`"fs"` / `"both"` は fs 監視も併用（実質 both か poll の 2 値）。 */
export type WatcherMode = "fs" | "poll" | "both";

/** `startWatcher` のオプション。 */
export interface WatcherOptions {
  /** 監視対象のルートディレクトリ一覧（`config.roots`）。 */
  roots: readonly string[];
  /** ポーリング間隔（秒）。 */
  pollIntervalSec: number;
  /** debounce の待ち時間（ms）。既定 300。 */
  debounceMs?: number;
  /**
   * debounce の上限待ち時間（ms）。既定 2000。連続する変更で debounce が延々と
   * 再スケジュールされ続けても、最初の変更からこの時間内には必ず 1 回 flush する。
   */
  maxWaitMs?: number;
  /** 変更検知後（debounce 済み）に呼ばれるコールバック。 */
  onChange: (paths: readonly string[]) => void | Promise<void>;
  log: Logger;
  // テスト用差し替え（省略時は実物）。
  fsWatch?: typeof watch;
  locateClaudeSessions?: typeof locateClaudeSessions;
  locateCodexSessions?: typeof locateCodexSessions;
  readRunningMeta?: typeof readRunningMeta;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

/** `startWatcher` の戻り値。 */
export interface WatcherHandle {
  /** 現在の監視モード。 */
  mode(): WatcherMode;
  /** 監視・タイマーをすべて止める。 */
  stop(): void;
  /** ポーリングを即時 1 回実行する（テスト・手動トリガー用）。多重実行はしない。 */
  pollNow(): Promise<void>;
}

/** debounce の既定待ち時間。 */
const DEFAULT_DEBOUNCE_MS = 300;
/** debounce の既定上限待ち時間。 */
const DEFAULT_MAX_WAIT_MS = 2000;

/** root の basename（小文字）から分類する。`store/index.ts` の classifyRoot と同じ規則。 */
type RootKind = "claude" | "codex" | "both";

function classifyRoot(root: string): RootKind {
  const base = path.basename(root).toLowerCase();
  if (base === ".claude") {
    return "claude";
  }
  if (base === ".codex") {
    return "codex";
  }
  return "both";
}

/** ポーリングで比較する 1 ファイル分のメタ情報。 */
interface FileMeta {
  path: string;
  mtime: number;
  size: number;
}

/** root ごとの直近スナップショット。 */
interface RootSnapshot {
  /** キーは小文字化した絶対パス。 */
  files: Map<string, FileMeta>;
  /** 稼働メタ（`sessions/<pid>.json`）の pid 集合。claude を含まない root では常に空。 */
  pids: Set<number>;
}

/** `.jsonl` 拡張子（大文字小文字無視）。 */
const JSONL_EXTENSION = ".jsonl";

/**
 * Claude セッション JSONL 名（`<uuid>.jsonl`、大文字小文字無視）に一致するかどうか。
 * `locator.ts` の `CLAUDE_SESSION_ID_PATTERN`（UUID 判定の唯一の定義）をそのまま使う
 * （Round 3 レビュー引き継ぎ: 正規表現の `source` からアンカー `^`/`$` を `slice` で
 * 剥がして再構成すると、パターンの中身が変わったときに壊れやすい。拡張子を文字列として
 * 切り落としてから既存パターンにそのまま照合する方が安全）。
 */
function isClaudeSessionJsonlName(name: string): boolean {
  if (!name.toLowerCase().endsWith(JSONL_EXTENSION)) {
    return false;
  }
  const withoutExtension = name.slice(0, -JSONL_EXTENSION.length);
  return CLAUDE_SESSION_ID_PATTERN.test(withoutExtension);
}

/** 稼働メタファイル名（`<pid>.json`）のパターン。`running.ts` 内部の規則と同じ。 */
const PID_JSON_FILE_PATTERN = /^\d+\.json$/i;

/** `sessions/YYYY/MM/DD/` の `YYYY` / `MM` `DD` ディレクトリ名パターン（`codex/locator.ts` と同じ規則）。 */
const YEAR_DIR_PATTERN = /^\d{4}$/;
const MONTH_OR_DAY_DIR_PATTERN = /^\d{2}$/;

/**
 * fs.watch が通知した変更パスが「索引が実際に読む可能性のあるセッションファイル」かどうかを
 * 判定する。ここでのパス分解・照合は文字列操作のみで、stat / readdir は一切行わない。
 *
 * `history.jsonl`（プロンプトごとに追記）、`subagents/agent-*.jsonl`（稼働中は常時追記）、
 * `custom-title.json`、`*.desktop-released.json`、`agent-*.meta.json` のような、索引が
 * 直接読まない `.jsonl` / `.json` はここで弾く（Round 2 レビュー BLOCKING: これらを通すと
 * `refreshFiles` が未知パスとして扱い、余計な `rebuild()` を誘発してしまう）。
 * - Claude root: `<root>/projects/<dir>/<uuid>.jsonl` と `<root>/sessions/<pid>.json` のみ通す。
 * - Codex root: `<root>/sessions/YYYY/MM/DD/rollout-*.jsonl` のみ通す。
 * - 「両方」root は両方の規則の和。
 * - `isUnderRoot` で root 外を指すパス（`filename` に `..` を含む等）も弾く。
 */
function isIndexRelevantPath(root: string, fullPath: string): boolean {
  if (!isUnderRoot(fullPath, [root])) {
    return false;
  }
  if (isExcludedFile(path.basename(fullPath))) {
    return false;
  }

  const kind = classifyRoot(root);
  const wantsClaude = kind === "claude" || kind === "both";
  const wantsCodex = kind === "codex" || kind === "both";

  const relative = path.relative(root, fullPath);
  const segments = relative.split(path.sep).filter((segment) => segment.length > 0);

  if (wantsClaude) {
    if (
      segments.length === 3 &&
      segments[0]?.toLowerCase() === "projects" &&
      isClaudeSessionJsonlName(segments[2] ?? "")
    ) {
      return true;
    }
    if (
      segments.length === 2 &&
      segments[0]?.toLowerCase() === "sessions" &&
      PID_JSON_FILE_PATTERN.test(segments[1] ?? "")
    ) {
      return true;
    }
  }

  if (wantsCodex) {
    if (
      segments.length === 5 &&
      segments[0]?.toLowerCase() === "sessions" &&
      YEAR_DIR_PATTERN.test(segments[1] ?? "") &&
      MONTH_OR_DAY_DIR_PATTERN.test(segments[2] ?? "") &&
      MONTH_OR_DAY_DIR_PATTERN.test(segments[3] ?? "") &&
      CODEX_ROLLOUT_FILE_PATTERN.test(segments[4] ?? "")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * fs.watch + ポーリングのフォールバックを開始する。
 * - 各 root に `fsWatch(root, { recursive: true, persistent: false }, listener)` を試みる。
 *   例外・非同期の "error" イベントのいずれでもその root の fs 監視だけを諦める（ポーリングは継続）。
 * - `pollIntervalSec` ごとに全 root をポーリングし、追加・変更・削除のあったパスを検知する。
 * - fs / ポーリングいずれで検知した変更も 1 つの debounce 経路に集約し、`debounceMs` 後に
 *   まとめて `onChange` へ渡す。`onChange` は直列化して呼ぶ（前回の呼び出し完了を待つ）。
 */
export function startWatcher(opts: WatcherOptions): WatcherHandle {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const fsWatchFn = opts.fsWatch ?? watch;
  const locateClaudeSessionsFn = opts.locateClaudeSessions ?? locateClaudeSessions;
  const locateCodexSessionsFn = opts.locateCodexSessions ?? locateCodexSessions;
  const readRunningMetaFn = opts.readRunningMeta ?? readRunningMeta;
  const setTimer = opts.setTimer ?? setTimeout;
  const clearTimer = opts.clearTimer ?? clearTimeout;
  const setIntervalFn = opts.setIntervalFn ?? setInterval;
  const clearIntervalFn = opts.clearIntervalFn ?? clearInterval;
  const log = opts.log;

  let stopped = false;

  // ---- debounce ----
  const pendingPaths = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  // バッチの最初の変更でだけ張り、以後の変更では再スケジュールしない「強制 flush」タイマー。
  // debounce（`debounceTimer`）が変更のたびに延々と再スケジュールされ続けても、
  // 最初の変更から maxWaitMs 以内には必ず 1 回 flush する（絶対時刻の計算はタイマー側
  // （実 setTimeout / vi.useFakeTimers いずれも）に委ね、こちら側では経過時間を計算しない）。
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  let flushChain: Promise<void> = Promise.resolve();

  function clearPendingTimers(): void {
    if (debounceTimer !== undefined) {
      clearTimer(debounceTimer);
      debounceTimer = undefined;
    }
    if (maxWaitTimer !== undefined) {
      clearTimer(maxWaitTimer);
      maxWaitTimer = undefined;
    }
  }

  function runFlush(): void {
    if (pendingPaths.size === 0) {
      return;
    }
    const paths = [...pendingPaths];
    pendingPaths.clear();
    clearPendingTimers();
    // 直列化: 前回の onChange 呼び出しが終わってから次を実行する。
    flushChain = flushChain
      .then(() => opts.onChange(paths))
      .catch(() => {
        log.warn("変更通知の処理に失敗しました。次の変更検知で再試行します。");
      });
  }

  function scheduleFlush(): void {
    if (stopped) {
      return;
    }
    if (maxWaitTimer === undefined) {
      // このバッチの最初の変更。ここでだけ張り、以後の変更では触らない。
      maxWaitTimer = setTimer(() => {
        maxWaitTimer = undefined;
        runFlush();
      }, maxWaitMs);
    }
    if (debounceTimer !== undefined) {
      clearTimer(debounceTimer);
    }
    debounceTimer = setTimer(() => {
      debounceTimer = undefined;
      runFlush();
    }, debounceMs);
  }

  function addChange(fullPath: string): void {
    if (stopped) {
      return;
    }
    pendingPaths.add(fullPath);
    scheduleFlush();
  }

  // ---- fs.watch ----
  const fsWatchers: FSWatcher[] = [];
  const successfulFsRoots = new Set<string>();

  function detachFsWatcher(root: string, watcher: FSWatcher): void {
    successfulFsRoots.delete(root);
    const index = fsWatchers.indexOf(watcher);
    if (index >= 0) {
      fsWatchers.splice(index, 1);
    }
    try {
      watcher.close();
    } catch {
      // 既に閉じている等は無視する
    }
  }

  function attachFsWatcher(root: string): void {
    try {
      const watcher = fsWatchFn(
        root,
        { recursive: true, persistent: false },
        (_eventType, filename) => {
          if (stopped) {
            return;
          }
          if (filename === null || typeof filename !== "string") {
            // filename が取れないイベントは root 自体を変更集合に入れる
            // （refreshFiles が未知パスとして rebuild にフォールバックする）。
            addChange(root);
            return;
          }
          const fullPath = path.join(root, filename);
          if (!isIndexRelevantPath(root, fullPath)) {
            return;
          }
          addChange(fullPath);
        },
      );
      watcher.on("error", () => {
        log.warn("ファイル監視でエラーが発生しました。ポーリングのみで継続します。");
        detachFsWatcher(root, watcher);
      });
      fsWatchers.push(watcher);
      successfulFsRoots.add(root);
    } catch {
      log.warn("ファイル監視を開始できませんでした。ポーリングのみで継続します。");
    }
  }

  for (const root of opts.roots) {
    attachFsWatcher(root);
  }

  // ---- ポーリング ----
  const snapshots = new Map<string, RootSnapshot>();
  let polling = false;

  async function pollRoot(root: string): Promise<void> {
    const kind = classifyRoot(root);
    const wantsClaude = kind === "claude" || kind === "both";
    const wantsCodex = kind === "codex" || kind === "both";

    const files = new Map<string, FileMeta>();
    let pids = new Set<number>();

    const tasks: Array<Promise<void>> = [];
    if (wantsClaude) {
      tasks.push(
        locateClaudeSessionsFn(root).then((result) => {
          for (const file of result.sessions) {
            files.set(file.jsonlPath.toLowerCase(), {
              path: file.jsonlPath,
              mtime: file.mtime,
              size: file.sizeBytes,
            });
          }
        }),
      );
      tasks.push(
        readRunningMetaFn(root).then((result) => {
          pids = new Set(result.metas.map((meta) => meta.pid));
        }),
      );
    }
    if (wantsCodex) {
      tasks.push(
        locateCodexSessionsFn(root).then((result) => {
          for (const file of result.sessions) {
            files.set(file.jsonlPath.toLowerCase(), {
              path: file.jsonlPath,
              mtime: file.mtime,
              size: file.sizeBytes,
            });
          }
        }),
      );
    }

    await Promise.all(tasks);

    const previous = snapshots.get(root);
    snapshots.set(root, { files, pids });

    if (previous === undefined) {
      // 初回は差分を出さずスナップショットを取るだけ。
      return;
    }

    for (const [key, meta] of files) {
      const prevMeta = previous.files.get(key);
      if (prevMeta === undefined || prevMeta.mtime !== meta.mtime || prevMeta.size !== meta.size) {
        addChange(meta.path);
      }
    }
    for (const [key, prevMeta] of previous.files) {
      if (!files.has(key)) {
        addChange(prevMeta.path);
      }
    }

    if (wantsClaude) {
      const sessionsDir = path.join(root, "sessions");
      for (const pid of pids) {
        if (!previous.pids.has(pid)) {
          addChange(path.join(sessionsDir, `${pid}.json`));
        }
      }
      for (const pid of previous.pids) {
        if (!pids.has(pid)) {
          addChange(path.join(sessionsDir, `${pid}.json`));
        }
      }
    }
  }

  async function pollNow(): Promise<void> {
    if (polling || stopped) {
      return;
    }
    polling = true;
    try {
      for (const root of opts.roots) {
        await pollRoot(root);
      }
    } finally {
      polling = false;
    }
  }

  // 起動直後に 1 回実行してベースラインのスナップショットを取る（差分は出ない）。
  void pollNow();

  const pollTimer = setIntervalFn(() => {
    void pollNow();
  }, Math.max(1, opts.pollIntervalSec) * 1000);

  return {
    mode(): WatcherMode {
      return successfulFsRoots.size > 0 ? "both" : "poll";
    },
    stop(): void {
      stopped = true;
      clearIntervalFn(pollTimer);
      clearPendingTimers();
      for (const watcher of [...fsWatchers]) {
        try {
          watcher.close();
        } catch {
          // 既に閉じている等は無視する
        }
      }
      fsWatchers.length = 0;
      successfulFsRoots.clear();
      pendingPaths.clear();
      snapshots.clear();
    },
    pollNow,
  };
}
