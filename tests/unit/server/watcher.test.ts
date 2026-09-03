import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../src/server/log";
import { createLogger } from "../../../src/server/log";
import type {
  ClaudeSessionFile,
  LocateClaudeResult,
} from "../../../src/server/sources/claude/locator";
import type {
  ReadRunningMetaResult,
  RunningMeta,
} from "../../../src/server/sources/claude/running";
import type {
  CodexSessionFile,
  LocateCodexResult,
} from "../../../src/server/sources/codex/locator";
import type { WatcherOptions } from "../../../src/server/store/watcher";
import { startWatcher } from "../../../src/server/store/watcher";

// T-015 startWatcher の受け入れ条件を検証する。
// 実 fs.watch / 実タイマーは一切使わず、すべてフェイクを注入する。
// root は合成パス（存在しなくてよい）。ログは createLogger + sink 収集でパス漏れを確認する。

const CLAUDE_ROOT = "C:\\synthetic\\.claude";
const CODEX_ROOT = "C:\\synthetic\\.codex";

// fs 経路の許可リスト（第1段階レビュー対応）は projects/<dir>/<uuid>.jsonl のみを通すため、
// debounce・stop・reject 系のテストでも有効な UUID を使う。
const UUID_A = "00000000-0000-4000-8000-0000000000a1";
const UUID_B = "00000000-0000-4000-8000-0000000000b2";
const UUID_C = "00000000-0000-4000-8000-0000000000c3";

/** ---- フェイク Logger（パス確認が不要なテスト用の軽量版） ---- */
function makeFakeLog(): { log: Logger; warns: string[] } {
  const warns: string[] = [];
  const log: Logger = {
    info: () => {},
    warn: (message) => warns.push(message),
    error: () => {},
  };
  return { log, warns };
}

/** ---- フェイク createLogger（sink でパス混入を検証するテスト用） ---- */
function makeSinkLog(): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const log = createLogger({
    roots: [CLAUDE_ROOT, CODEX_ROOT],
    homeDir: "C:\\synthetic",
    sink: (line) => lines.push(line),
  });
  return { log, lines };
}

/** ---- フェイク fsWatch ---- */
type FsWatchListener = (eventType: string, filename: string | null) => void;

function makeFakeFsWatch(throwRoots: readonly string[] = []) {
  const listeners = new Map<string, FsWatchListener>();
  const errorHandlers = new Map<string, (err: Error) => void>();
  const closedRoots: string[] = [];

  const fsWatch = vi.fn((root: string, _options: unknown, listener: FsWatchListener) => {
    if (throwRoots.includes(root)) {
      throw new Error("fs.watch is not supported here");
    }
    listeners.set(root, listener);
    const watcher = {
      on: vi.fn((event: string, handler: (err: Error) => void) => {
        if (event === "error") {
          errorHandlers.set(root, handler);
        }
        return watcher;
      }),
      close: vi.fn(() => {
        closedRoots.push(root);
      }),
    };
    return watcher;
  });

  return { fsWatch, listeners, errorHandlers, closedRoots };
}

/** ---- フェイクタイマー（setTimer/clearTimer/setIntervalFn/clearIntervalFn を手動制御） ---- */
function makeFakeTimers() {
  let nextId = 1;
  const timeouts = new Map<number, () => void>();
  const timeoutDelays: number[] = [];
  const intervals = new Map<number, () => void>();
  const intervalDelays: number[] = [];

  const setTimer = vi.fn((fn: () => void, delay?: number) => {
    const id = nextId++;
    timeouts.set(id, fn);
    timeoutDelays.push(delay ?? 0);
    return id as unknown as ReturnType<typeof setTimeout>;
  });
  const clearTimer = vi.fn((id: unknown) => {
    timeouts.delete(id as number);
  });
  const setIntervalFn = vi.fn((fn: () => void, delay?: number) => {
    const id = nextId++;
    intervals.set(id, fn);
    intervalDelays.push(delay ?? 0);
    return id as unknown as ReturnType<typeof setInterval>;
  });
  const clearIntervalFn = vi.fn((id: unknown) => {
    intervals.delete(id as number);
  });

  function fireAllTimeouts(): void {
    const fns = [...timeouts.values()];
    timeouts.clear();
    for (const fn of fns) fn();
  }

  /** 指定した id のタイマーだけを発火する（他は触らない）。maxWaitMs と debounce を区別して検証するために使う。 */
  function fireTimeout(id: unknown): void {
    const fn = timeouts.get(id as number);
    if (fn === undefined) {
      return;
    }
    timeouts.delete(id as number);
    fn();
  }

  return {
    setTimer,
    clearTimer,
    setIntervalFn,
    clearIntervalFn,
    timeoutDelays,
    intervalDelays,
    fireAllTimeouts,
    fireTimeout,
    pendingTimeoutCount: () => timeouts.size,
  };
}

/** ---- 静かなポーリング依存（このテストの主眼でない限り差分を出さない固定フェイク） ---- */
function makeEmptyClaudeLocate() {
  return vi.fn(async (): Promise<LocateClaudeResult> => ({ sessions: [], warnings: [] }));
}
function makeEmptyCodexLocate() {
  return vi.fn(async (): Promise<LocateCodexResult> => ({ sessions: [], warnings: [] }));
}
function makeEmptyRunningMeta() {
  return vi.fn(async (): Promise<ReadRunningMetaResult> => ({ metas: [], warnings: [] }));
}

function makeClaudeFile(
  overrides: Partial<ClaudeSessionFile> & { jsonlPath: string },
): ClaudeSessionFile {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    projectDir: path.dirname(overrides.jsonlPath),
    sizeBytes: 100,
    mtime: 1000,
    hasCustomTitleFile: false,
    released: false,
    subagentCount: 0,
    ...overrides,
  };
}

/**
 * 「呼ばれた回数」ではなく「解決（settle）した回数」を追跡するラッパ。
 * `void pollNow()` は startWatcher 内で fire-and-forget されるため、call 数が 1 になった
 * 直後はまだ Promise チェーンの途中（polling フラグが true のまま）のことがある。
 * settledCount を条件にした vi.waitFor は、実際に処理が完了してから解決する。
 */
function withSettleTracking<Args extends unknown[], R>(
  impl: (...args: Args) => Promise<R>,
): { fn: (...args: Args) => Promise<R>; settledCount: () => number } {
  let settled = 0;
  const fn = vi.fn(async (...args: Args) => {
    const result = await impl(...args);
    settled += 1;
    return result;
  });
  return { fn, settledCount: () => settled };
}

function makeCodexFile(
  overrides: Partial<CodexSessionFile> & { jsonlPath: string },
): CodexSessionFile {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    sizeBytes: 100,
    mtime: 1000,
    ...overrides,
  };
}

function makeRunningMeta(overrides: Partial<RunningMeta> & { pid: number }): RunningMeta {
  return {
    sessionId: "00000000-0000-4000-8000-000000000001",
    cwd: "C:\\synthetic\\project",
    startedAt: 1000,
    procStart: 1000,
    entrypoint: "cli",
    version: null,
    ...overrides,
  };
}

/** startWatcher に渡す共通オプションを組み立てる（省略した依存は「差分なし」の静かなフェイク）。 */
function baseOptions(overrides: Partial<WatcherOptions> = {}): WatcherOptions {
  const { log } = makeFakeLog();
  const timers = makeFakeTimers();
  return {
    roots: [CLAUDE_ROOT, CODEX_ROOT],
    pollIntervalSec: 10,
    onChange: vi.fn(),
    log,
    locateClaudeSessions: makeEmptyClaudeLocate(),
    locateCodexSessions: makeEmptyCodexLocate(),
    readRunningMeta: makeEmptyRunningMeta(),
    setTimer: timers.setTimer as unknown as typeof setTimeout,
    clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
    setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
    clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
    ...overrides,
  };
}

describe("startWatcher: mode()", () => {
  it("全 root で fsWatch が成功すると mode() は 'both'", async () => {
    const { fsWatch } = makeFakeFsWatch([]);
    const handle = startWatcher(
      baseOptions({ fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"] }),
    );
    await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(2));

    expect(handle.mode()).toBe("both");
    handle.stop();
  });

  it("全 root で fsWatch が throw すると mode() は 'poll'", async () => {
    const { fsWatch } = makeFakeFsWatch([CLAUDE_ROOT, CODEX_ROOT]);
    const handle = startWatcher(
      baseOptions({ fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"] }),
    );
    await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(2));

    expect(handle.mode()).toBe("poll");
    handle.stop();
  });

  it("一部 root だけ fsWatch が成功する混在状態でも mode() は 'both'", async () => {
    const { fsWatch } = makeFakeFsWatch([CODEX_ROOT]);
    const handle = startWatcher(
      baseOptions({ fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"] }),
    );
    await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(2));

    expect(handle.mode()).toBe("both");
    handle.stop();
  });

  it("成功していた root が error イベントを発すると fs root が減り mode() が 'both' → 'poll' に変わる（1 root のみ監視の場合）", async () => {
    const { fsWatch, errorHandlers } = makeFakeFsWatch([]);
    const handle = startWatcher(
      baseOptions({
        roots: [CLAUDE_ROOT],
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
      }),
    );
    await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(1));
    expect(handle.mode()).toBe("both");

    errorHandlers.get(CLAUDE_ROOT)?.(new Error("boom"));

    expect(handle.mode()).toBe("poll");
    handle.stop();
  });

  it("2 root成功のうち 1 root が error イベントを発しても、もう一方が残るため mode() は 'both' のまま", async () => {
    const { fsWatch, errorHandlers } = makeFakeFsWatch([]);
    const handle = startWatcher(
      baseOptions({ fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"] }),
    );
    await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(2));

    errorHandlers.get(CLAUDE_ROOT)?.(new Error("boom"));

    expect(handle.mode()).toBe("both");
    handle.stop();
  });
});

describe("startWatcher: fs.watch のイベント → debounce → onChange", () => {
  it("listener の change イベントは 300ms の debounce（フェイクタイマー）後に onChange へ 1 回渡る", async () => {
    const { fsWatch, listeners } = makeFakeFsWatch([]);
    const onChange = vi.fn();
    const timers = makeFakeTimers();
    const handle = startWatcher(
      baseOptions({
        roots: [CLAUDE_ROOT],
        onChange,
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
        setTimer: timers.setTimer as unknown as typeof setTimeout,
        clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
        setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
        clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
      }),
    );
    await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(1));

    const listener = listeners.get(CLAUDE_ROOT);
    expect(listener).toBeDefined();
    listener?.("change", "projects\\dir\\00000000-0000-4000-8000-000000000099.jsonl");

    expect(timers.timeoutDelays.at(-1)).toBe(300);
    expect(onChange).not.toHaveBeenCalled();

    timers.fireAllTimeouts();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    expect(onChange).toHaveBeenCalledWith([
      path.join(CLAUDE_ROOT, "projects\\dir\\00000000-0000-4000-8000-000000000099.jsonl"),
    ]);
    handle.stop();
  });

  it("連続 3 イベントは debounce の再スケジュールにより 1 回の onChange にまとまる", async () => {
    const { fsWatch, listeners } = makeFakeFsWatch([]);
    const onChange = vi.fn();
    const timers = makeFakeTimers();
    const handle = startWatcher(
      baseOptions({
        roots: [CLAUDE_ROOT],
        onChange,
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
        setTimer: timers.setTimer as unknown as typeof setTimeout,
        clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
        setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
        clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
      }),
    );
    await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(1));

    const listener = listeners.get(CLAUDE_ROOT);
    listener?.("change", `projects\\dir\\${UUID_A}.jsonl`);
    listener?.("change", `projects\\dir\\${UUID_B}.jsonl`);
    listener?.("change", `projects\\dir\\${UUID_C}.jsonl`);

    // debounce タイマーはその都度 clearTimer され、保留中は最新の 1 個だけになる
    // （実装が maxWaitMs 用に別タイマーを 1 個持つ設計の場合は 2 個になりうるため、
    // 内部本数そのものより「1 回にまとまって flush される」ことを主眼に検証する）。
    expect(timers.pendingTimeoutCount()).toBeGreaterThanOrEqual(1);
    expect(timers.pendingTimeoutCount()).toBeLessThanOrEqual(2);

    timers.fireAllTimeouts();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    const [paths] = onChange.mock.calls[0] as [string[]];
    expect(paths.sort()).toEqual(
      [
        path.join(CLAUDE_ROOT, `projects\\dir\\${UUID_A}.jsonl`),
        path.join(CLAUDE_ROOT, `projects\\dir\\${UUID_B}.jsonl`),
        path.join(CLAUDE_ROOT, `projects\\dir\\${UUID_C}.jsonl`),
      ].sort(),
    );
    handle.stop();
  });

  it("filename が null のイベントは root 自体を変更集合に入れる", async () => {
    const { fsWatch, listeners } = makeFakeFsWatch([]);
    const onChange = vi.fn();
    const timers = makeFakeTimers();
    const handle = startWatcher(
      baseOptions({
        roots: [CLAUDE_ROOT],
        onChange,
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
        setTimer: timers.setTimer as unknown as typeof setTimeout,
        clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
        setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
        clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
      }),
    );
    await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(1));

    listeners.get(CLAUDE_ROOT)?.("rename", null);
    timers.fireAllTimeouts();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    expect(onChange).toHaveBeenCalledWith([CLAUDE_ROOT]);
    handle.stop();
  });

  it.each([
    ["secret.key", false],
    ["session.lock", false],
    ["x.sqlite-wal", false],
    ["auth.json", false],
    ["settings.json", false],
    ["sessions\\123.json", true],
  ])(
    "変更ファイル %s は onChange 発火が %s になる（除外対象は無視、sessions/*.json は通る）",
    async (relativePath, shouldFire) => {
      const { fsWatch, listeners } = makeFakeFsWatch([]);
      const onChange = vi.fn();
      const timers = makeFakeTimers();
      const handle = startWatcher(
        baseOptions({
          roots: [CLAUDE_ROOT],
          onChange,
          fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
          setTimer: timers.setTimer as unknown as typeof setTimeout,
          clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
          setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
          clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
        }),
      );
      await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(1));

      listeners.get(CLAUDE_ROOT)?.("change", relativePath);
      timers.fireAllTimeouts();

      if (shouldFire) {
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
        expect(onChange).toHaveBeenCalledWith([path.join(CLAUDE_ROOT, relativePath)]);
      } else {
        // debounce タイマー自体が発火していないはず（addChange に到達していない）。
        expect(timers.timeoutDelays.length).toBe(0);
        expect(onChange).not.toHaveBeenCalled();
      }
      handle.stop();
    },
  );
});

describe("startWatcher: fsWatch の呼び出しオプション", () => {
  it("fsWatch は第 2 引数に { recursive: true, persistent: false } を渡す", async () => {
    const { fsWatch } = makeFakeFsWatch([]);
    const handle = startWatcher(
      baseOptions({
        roots: [CLAUDE_ROOT],
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
      }),
    );
    await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(1));

    const [, options] = fsWatch.mock.calls[0] as [string, unknown, FsWatchListener];
    expect(options).toEqual({ recursive: true, persistent: false });
    handle.stop();
  });
});

describe("startWatcher: fs 経路のパス絞り込み（第1段階レビュー対応・BLOCKING）", () => {
  const UUID = "00000000-0000-4000-8000-000000000abc";

  it.each([
    // Claude root で許可されるパス
    [`projects\\dir\\${UUID}.jsonl`, true],
    ["sessions\\123.json", true],
    // Claude root で無視すべきパス（許可リスト外）
    ["history.jsonl", false],
    [`projects\\dir\\${UUID}\\subagents\\agent-x.jsonl`, false],
    [`projects\\dir\\${UUID}\\custom-title.json`, false],
    [`projects\\dir\\${UUID}.desktop-released.json`, false],
    [`projects\\dir\\${UUID}\\subagents\\agent-x.meta.json`, false],
    ["..\\..\\evil.jsonl", false],
  ])(
    "Claude root: 変更ファイル %s は onChange 発火が %s になる（許可リストは projects/<dir>/<uuid>.jsonl と sessions/<pid>.json のみ）",
    async (relativePath, shouldFire) => {
      const { fsWatch, listeners } = makeFakeFsWatch([]);
      const onChange = vi.fn();
      const timers = makeFakeTimers();
      const handle = startWatcher(
        baseOptions({
          roots: [CLAUDE_ROOT],
          onChange,
          fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
          setTimer: timers.setTimer as unknown as typeof setTimeout,
          clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
          setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
          clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
        }),
      );
      await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(1));

      listeners.get(CLAUDE_ROOT)?.("change", relativePath);
      timers.fireAllTimeouts();

      if (shouldFire) {
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
      } else {
        // 少し待っても debounce タイマー自体が発火しないはず（addChange に到達していない）。
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(onChange).not.toHaveBeenCalled();
      }
      handle.stop();
    },
  );

  it.each([
    [`sessions\\2026\\01\\01\\rollout-x-${UUID}.jsonl`, true],
    ["sessions\\notes.jsonl", false],
  ])(
    "Codex root: 変更ファイル %s は onChange 発火が %s になる（許可リストは sessions/YYYY/MM/DD/rollout-*.jsonl のみ）",
    async (relativePath, shouldFire) => {
      const { fsWatch, listeners } = makeFakeFsWatch([]);
      const onChange = vi.fn();
      const timers = makeFakeTimers();
      const handle = startWatcher(
        baseOptions({
          roots: [CODEX_ROOT],
          onChange,
          fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
          setTimer: timers.setTimer as unknown as typeof setTimeout,
          clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
          setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
          clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
        }),
      );
      await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(1));

      listeners.get(CODEX_ROOT)?.("change", relativePath);
      timers.fireAllTimeouts();

      if (shouldFire) {
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(onChange).not.toHaveBeenCalled();
      }
      handle.stop();
    },
  );

  it("filename が null のイベントは許可リストの対象外でも root 自体を変更集合に入れる", async () => {
    const { fsWatch, listeners } = makeFakeFsWatch([]);
    const onChange = vi.fn();
    const timers = makeFakeTimers();
    const handle = startWatcher(
      baseOptions({
        roots: [CLAUDE_ROOT],
        onChange,
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
        setTimer: timers.setTimer as unknown as typeof setTimeout,
        clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
        setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
        clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
      }),
    );
    await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(1));

    listeners.get(CLAUDE_ROOT)?.("rename", null);
    timers.fireAllTimeouts();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    expect(onChange).toHaveBeenCalledWith([CLAUDE_ROOT]);
    handle.stop();
  });
});

describe("startWatcher: CLAUDE_SESSION_ID_PATTERN の前提を固定（Round 2 レビュー対応）", () => {
  // 実装は `CLAUDE_SESSION_ID_PATTERN`（locator.ts）から projects/<dir>/<uuid>.jsonl の
  // 判定パターンを組み立てる（`.slice` の有無に関わらず、観測できる挙動は変わらないはず）。
  // ここでは大文字小文字・非 UUID 名を含めて、その前提を固定する。
  it.each([
    ["projects\\dir\\00000000-0000-4000-8000-000000000abc.jsonl", true, "小文字 UUID"],
    ["projects\\dir\\00000000-0000-4000-8000-000000000ABC.jsonl", true, "大文字 UUID"],
    [
      "projects\\dir\\00000000-0000-4000-8000-000000000ABC.JSONL",
      true,
      "大文字 UUID + 大文字拡張子",
    ],
    ["projects\\dir\\not-a-uuid.jsonl", false, "UUID 形式でない名前"],
    ["projects\\dir\\00000000-0000-4000-8000-000000000ab.jsonl", false, "UUID の桁数が足りない"],
  ])("%s は onChange 発火が %s になる（%s）", async (relativePath, shouldFire) => {
    const { fsWatch, listeners } = makeFakeFsWatch([]);
    const onChange = vi.fn();
    const timers = makeFakeTimers();
    const handle = startWatcher(
      baseOptions({
        roots: [CLAUDE_ROOT],
        onChange,
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
        setTimer: timers.setTimer as unknown as typeof setTimeout,
        clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
        setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
        clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
      }),
    );
    await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(1));

    listeners.get(CLAUDE_ROOT)?.("change", relativePath);
    timers.fireAllTimeouts();

    if (shouldFire) {
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
      expect(onChange).toHaveBeenCalledWith([path.join(CLAUDE_ROOT, relativePath)]);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onChange).not.toHaveBeenCalled();
    }
    handle.stop();
  });
});

describe("startWatcher: maxWaitMs（第1段階レビュー対応・強制フラッシュ）", () => {
  /**
   * 実装が「maxWaitMs 用の別タイマーを注入可能な setTimer で張る」設計か、
   * 「Date.now() を直接読んで 1 本の debounce タイマーの delay を縮める」設計かは
   * このレビュー対応の期間中に複数回入れ替わっている（手動確認済み）。
   * どちらの内部実装でも通る、ブラックボックスな検証にするため、ここだけは
   * `vi.useFakeTimers()` でグローバルな setTimeout と Date.now を一貫してフェイクする
   * （タスク指示が明示的に許容する代替手段）。`setTimer` 等は注入せず既定
   * （フェイク済みのグローバル）に委ねる。
   */
  it("debounceMs（300ms）未満の間隔でイベントを送り続けても、maxWaitMs（既定 2000ms）以内に 1 回は flush される", async () => {
    vi.useFakeTimers();
    try {
      const { fsWatch, listeners } = makeFakeFsWatch([]);
      const onChange = vi.fn();
      const handle = startWatcher(
        baseOptions({
          roots: [CLAUDE_ROOT],
          onChange,
          fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
          setTimer: undefined,
          clearTimer: undefined,
          setIntervalFn: undefined,
          clearIntervalFn: undefined,
        }),
      );
      expect(fsWatch).toHaveBeenCalledTimes(1);

      const listener = listeners.get(CLAUDE_ROOT);
      expect(listener).toBeDefined();
      const filePath = `projects\\dir\\${UUID_A}.jsonl`;

      // 100ms 間隔（debounce の 300ms 未満）でイベントを送り続け、debounce が発火する
      // 前に毎回リセットされ続ける状況を作る。2000ms（既定 maxWaitMs）を跨ぐまで続ける。
      for (let i = 0; i < 25; i += 1) {
        listener?.("change", filePath);
        await vi.advanceTimersByTimeAsync(100);
      }

      expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(1);
      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("debounceMs より長い間隔（500ms）でイベントを送れば、maxWaitMs を待たず debounceMs 後に flush される（通常の debounce 経路の回帰確認）", async () => {
    vi.useFakeTimers();
    try {
      const { fsWatch, listeners } = makeFakeFsWatch([]);
      const onChange = vi.fn();
      const handle = startWatcher(
        baseOptions({
          roots: [CLAUDE_ROOT],
          onChange,
          fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
          setTimer: undefined,
          clearTimer: undefined,
          setIntervalFn: undefined,
          clearIntervalFn: undefined,
        }),
      );
      const listener = listeners.get(CLAUDE_ROOT);
      const filePath = `projects\\dir\\${UUID_A}.jsonl`;

      listener?.("change", filePath);
      await vi.advanceTimersByTimeAsync(500);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([path.join(CLAUDE_ROOT, filePath)]);
      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("maxWaitMs=1000 を明示すると、300ms未満の間隔で送り続けても1000ms経過ちょうどで1回目のflushが起き、その時点の保留パスを全て含む（Round 2 レビュー対応: 件数・内容を固定）", async () => {
    vi.useFakeTimers();
    try {
      const { fsWatch, listeners } = makeFakeFsWatch([]);
      const onChange = vi.fn();
      const handle = startWatcher(
        baseOptions({
          roots: [CLAUDE_ROOT],
          onChange,
          maxWaitMs: 1000,
          fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
          setTimer: undefined,
          clearTimer: undefined,
          setIntervalFn: undefined,
          clearIntervalFn: undefined,
        }),
      );
      const listener = listeners.get(CLAUDE_ROOT);
      expect(listener).toBeDefined();

      const filePathA = `projects\\dir\\${UUID_A}.jsonl`;
      const filePathB = `projects\\dir\\${UUID_B}.jsonl`;
      const filePathC = `projects\\dir\\${UUID_C}.jsonl`;
      // 5 回、200ms 間隔（既定 debounceMs=300 未満）で送る（t=0,200,400,600,800）。
      // debounceTimer はその都度 300ms 後に再スケジュールされ続ける（次の発火予定は t=1100）ため、
      // 自然には一度も発火しない。
      const files = [filePathA, filePathB, filePathC, filePathA, filePathB];
      for (const [i, file] of files.entries()) {
        listener?.("change", file);
        if (i < files.length - 1) {
          await vi.advanceTimersByTimeAsync(200);
        }
      }
      // ここまでで経過 800ms。まだ flush されていないはず。
      expect(onChange).not.toHaveBeenCalled();

      // 残り 200ms を進め、最初の変更（t=0）からちょうど 1000ms（maxWaitMs）に到達させる。
      // debounceTimer の次の発火予定（t=1100）より先に、maxWaitMs の強制 flush が起きるはず。
      await vi.advanceTimersByTimeAsync(200);

      expect(onChange).toHaveBeenCalledTimes(1);
      const [paths] = onChange.mock.calls[0] as [string[]];
      expect(paths.sort()).toEqual(
        [
          path.join(CLAUDE_ROOT, filePathA),
          path.join(CLAUDE_ROOT, filePathB),
          path.join(CLAUDE_ROOT, filePathC),
        ].sort(),
      );

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("startWatcher: ポーリング", () => {
  it("初回 pollNow はスナップショットを取るだけで onChange を呼ばない", async () => {
    const claudeFile = makeClaudeFile({
      jsonlPath: path.join(CLAUDE_ROOT, "projects\\dir\\a.jsonl"),
      mtime: 1000,
      sizeBytes: 100,
    });
    const locateClaudeSessions = vi.fn(
      async (): Promise<LocateClaudeResult> => ({ sessions: [claudeFile], warnings: [] }),
    );
    const onChange = vi.fn();
    const { fsWatch } = makeFakeFsWatch([CLAUDE_ROOT, CODEX_ROOT]);
    const handle = startWatcher(
      baseOptions({
        roots: [CLAUDE_ROOT],
        onChange,
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
        locateClaudeSessions,
      }),
    );

    await vi.waitFor(() => expect(locateClaudeSessions).toHaveBeenCalledTimes(1));
    expect(onChange).not.toHaveBeenCalled();
    handle.stop();
  });

  it("2 回目の pollNow で 追加 / mtime 変更 / 削除 のパスが渡る", async () => {
    const filePathA = path.join(CLAUDE_ROOT, "projects\\dir\\a.jsonl");
    const filePathB = path.join(CLAUDE_ROOT, "projects\\dir\\b.jsonl");
    const filePathC = path.join(CLAUDE_ROOT, "projects\\dir\\c.jsonl");

    const first: LocateClaudeResult = {
      sessions: [
        makeClaudeFile({ jsonlPath: filePathA, mtime: 1000, sizeBytes: 100 }),
        makeClaudeFile({ jsonlPath: filePathC, mtime: 1000, sizeBytes: 100 }),
      ],
      warnings: [],
    };
    const second: LocateClaudeResult = {
      sessions: [
        makeClaudeFile({ jsonlPath: filePathA, mtime: 2000, sizeBytes: 150 }), // mtime変更
        makeClaudeFile({ jsonlPath: filePathB, mtime: 1000, sizeBytes: 100 }), // 追加
        // filePathC は削除された
      ],
      warnings: [],
    };
    let call = 0;
    const { fn: locateClaudeSessions, settledCount } = withSettleTracking(
      async (): Promise<LocateClaudeResult> => {
        const result = call === 0 ? first : second;
        call += 1;
        return result;
      },
    );

    const onChange = vi.fn();
    const timers = makeFakeTimers();
    const { fsWatch } = makeFakeFsWatch([CLAUDE_ROOT, CODEX_ROOT]);
    const handle = startWatcher(
      baseOptions({
        roots: [CLAUDE_ROOT],
        onChange,
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
        locateClaudeSessions,
        setTimer: timers.setTimer as unknown as typeof setTimeout,
        clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
        setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
        clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
      }),
    );
    // 起動直後の baseline pollNow（fire-and-forget）が完了するまで待つ。
    await vi.waitFor(() => expect(settledCount()).toBe(1));

    await handle.pollNow();
    expect(locateClaudeSessions).toHaveBeenCalledTimes(2);
    timers.fireAllTimeouts();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    const [paths] = onChange.mock.calls[0] as [string[]];
    expect(paths.sort()).toEqual([filePathA, filePathB, filePathC].sort());
    handle.stop();
  });

  it("readRunningMeta の pid 増減で <root>/sessions/<pid>.json が onChange に渡る", async () => {
    const readRunningMetaSeq: ReadRunningMetaResult[] = [
      { metas: [makeRunningMeta({ pid: 100 })], warnings: [] },
      { metas: [makeRunningMeta({ pid: 100 }), makeRunningMeta({ pid: 200 })], warnings: [] },
    ];
    let call = 0;
    const { fn: readRunningMeta, settledCount } = withSettleTracking(
      async (): Promise<ReadRunningMetaResult> => {
        const result = readRunningMetaSeq[Math.min(call, readRunningMetaSeq.length - 1)];
        call += 1;
        return result as ReadRunningMetaResult;
      },
    );

    const onChange = vi.fn();
    const timers = makeFakeTimers();
    const { fsWatch } = makeFakeFsWatch([CLAUDE_ROOT, CODEX_ROOT]);
    const handle = startWatcher(
      baseOptions({
        roots: [CLAUDE_ROOT],
        onChange,
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
        readRunningMeta,
        setTimer: timers.setTimer as unknown as typeof setTimeout,
        clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
        setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
        clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
      }),
    );
    await vi.waitFor(() => expect(settledCount()).toBe(1));

    await handle.pollNow();
    timers.fireAllTimeouts();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    expect(onChange).toHaveBeenCalledWith([path.join(CLAUDE_ROOT, "sessions", "200.json")]);
    handle.stop();
  });

  it("readRunningMeta の pid 減少でも <root>/sessions/<pid>.json が onChange に渡る", async () => {
    const readRunningMetaSeq: ReadRunningMetaResult[] = [
      { metas: [makeRunningMeta({ pid: 100 }), makeRunningMeta({ pid: 300 })], warnings: [] },
      { metas: [makeRunningMeta({ pid: 100 })], warnings: [] },
    ];
    let call = 0;
    const { fn: readRunningMeta, settledCount } = withSettleTracking(
      async (): Promise<ReadRunningMetaResult> => {
        const result = readRunningMetaSeq[Math.min(call, readRunningMetaSeq.length - 1)];
        call += 1;
        return result as ReadRunningMetaResult;
      },
    );

    const onChange = vi.fn();
    const timers = makeFakeTimers();
    const { fsWatch } = makeFakeFsWatch([CLAUDE_ROOT, CODEX_ROOT]);
    const handle = startWatcher(
      baseOptions({
        roots: [CLAUDE_ROOT],
        onChange,
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
        readRunningMeta,
        setTimer: timers.setTimer as unknown as typeof setTimeout,
        clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
        setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
        clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
      }),
    );
    await vi.waitFor(() => expect(settledCount()).toBe(1));

    await handle.pollNow();
    timers.fireAllTimeouts();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    expect(onChange).toHaveBeenCalledWith([path.join(CLAUDE_ROOT, "sessions", "300.json")]);
    handle.stop();
  });

  it("codex root（.codex）では locateCodexSessions の追加ファイルが onChange に渡る（claude 側の locator は使われない）", async () => {
    const codexFilePath = path.join(CODEX_ROOT, "sessions\\2026\\01\\01\\rollout-x.jsonl");
    const codexSeq: LocateCodexResult[] = [
      { sessions: [], warnings: [] },
      { sessions: [makeCodexFile({ jsonlPath: codexFilePath })], warnings: [] },
    ];
    let call = 0;
    const { fn: locateCodexSessions, settledCount } = withSettleTracking(
      async (): Promise<LocateCodexResult> => {
        const result = codexSeq[Math.min(call, codexSeq.length - 1)];
        call += 1;
        return result as LocateCodexResult;
      },
    );
    const locateClaudeSessions = vi.fn(
      async (): Promise<LocateClaudeResult> => ({
        sessions: [],
        warnings: [],
      }),
    );

    const onChange = vi.fn();
    const timers = makeFakeTimers();
    const { fsWatch } = makeFakeFsWatch([CLAUDE_ROOT, CODEX_ROOT]);
    const handle = startWatcher(
      baseOptions({
        roots: [CODEX_ROOT],
        onChange,
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
        locateCodexSessions,
        locateClaudeSessions,
        setTimer: timers.setTimer as unknown as typeof setTimeout,
        clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
        setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
        clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
      }),
    );
    await vi.waitFor(() => expect(settledCount()).toBe(1));
    expect(locateClaudeSessions).not.toHaveBeenCalled();

    await handle.pollNow();
    timers.fireAllTimeouts();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith([codexFilePath]);
    handle.stop();
  });

  it("pollIntervalSec に応じて setIntervalFn が (fn, pollIntervalSec*1000) で呼ばれる", async () => {
    const timers = makeFakeTimers();
    const { fsWatch } = makeFakeFsWatch([CLAUDE_ROOT, CODEX_ROOT]);
    const handle = startWatcher(
      baseOptions({
        pollIntervalSec: 7,
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
        setTimer: timers.setTimer as unknown as typeof setTimeout,
        clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
        setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
        clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
      }),
    );

    expect(timers.intervalDelays).toEqual([7000]);
    handle.stop();
  });
});

describe("startWatcher: stop()", () => {
  it("stop() 後は fs イベント・タイマー発火のいずれでも onChange が呼ばれない。close/clearIntervalFn も呼ばれる", async () => {
    const { fsWatch, listeners, closedRoots } = makeFakeFsWatch([]);
    const onChange = vi.fn();
    const timers = makeFakeTimers();
    const handle = startWatcher(
      baseOptions({
        roots: [CLAUDE_ROOT],
        onChange,
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
        setTimer: timers.setTimer as unknown as typeof setTimeout,
        clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
        setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
        clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
      }),
    );
    await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(1));

    handle.stop();

    expect(closedRoots).toContain(CLAUDE_ROOT);
    expect(timers.clearIntervalFn).toHaveBeenCalled();

    listeners.get(CLAUDE_ROOT)?.("change", "sessions\\1.json");
    timers.fireAllTimeouts();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onChange).not.toHaveBeenCalled();

    const callsBefore = timers.setIntervalFn.mock.calls.length;
    await handle.pollNow();
    expect(timers.setIntervalFn.mock.calls.length).toBe(callsBefore);
  });
});

describe("startWatcher: onChange が reject する場合", () => {
  it("例外が外に漏れず、sink のログ行に一時パス・保留パスが含まれない", async () => {
    const { fsWatch, listeners } = makeFakeFsWatch([]);
    const onChange = vi.fn().mockRejectedValue(new Error("boom"));
    const timers = makeFakeTimers();
    const { log, lines } = makeSinkLog();
    const handle = startWatcher(
      baseOptions({
        roots: [CLAUDE_ROOT],
        onChange,
        log,
        fsWatch: fsWatch as unknown as WatcherOptions["fsWatch"],
        setTimer: timers.setTimer as unknown as typeof setTimeout,
        clearTimer: timers.clearTimer as unknown as typeof clearTimeout,
        setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
        clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
      }),
    );
    await vi.waitFor(() => expect(fsWatch).toHaveBeenCalledTimes(1));

    const changedPath = path.join(CLAUDE_ROOT, `projects\\dir\\${UUID_A}.jsonl`);
    listeners.get(CLAUDE_ROOT)?.("change", `projects\\dir\\${UUID_A}.jsonl`);
    timers.fireAllTimeouts();

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    // reject が処理されるまで少し待つ（例外が外に漏れて未処理拒否にならないことも確認）。
    await new Promise((resolve) => setTimeout(resolve, 10));

    const joined = lines.join("\n");
    expect(joined).not.toContain(changedPath);
    expect(joined).not.toContain("synthetic");
    expect(joined.length).toBeGreaterThan(0);
    handle.stop();
  });
});
