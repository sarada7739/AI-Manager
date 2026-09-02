import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../../../src/server/config";
import { createLogger, type Logger } from "../../../src/server/log";
import type {
  ClaudeSessionFile,
  LocateClaudeResult,
} from "../../../src/server/sources/claude/locator";
import type {
  ReadRunningMetaResult,
  RunningMeta,
} from "../../../src/server/sources/claude/running";
import { PROC_START_TOLERANCE_TICKS } from "../../../src/server/sources/claude/running";
import type {
  CodexSessionFile,
  LocateCodexResult,
} from "../../../src/server/sources/codex/locator";
import type { ProcessInfo, ProcessListResult } from "../../../src/server/sources/process/list";
import {
  HEAD_BYTES,
  LAST_MESSAGE_MAX_CHARS,
  TAIL_BYTES,
  TITLE_MAX_CHARS,
  UNTITLED,
} from "../../../src/server/store/build-summary";
import { SessionIndex, type SessionIndexDeps } from "../../../src/server/store/index";
import { err, ok, type Result } from "../../../src/shared/result";

// T-012: SessionIndex（セッション索引とアカウント合成）の受け入れ条件を検証する。
// 実際の PowerShell は起動しない（listProcesses は必ずフェイク）。フィクスチャは合成データのみ
// （UUID は "00000000-0000-4000-8000-00000000000N" 形式、cwd は "C:/synthetic/..." 形式）。
// os.homedir() には依存しない。

// ---------------------------------------------------------------------------
// 共通ヘルパ
// ---------------------------------------------------------------------------

const ROOT_CLAUDE = path.join("C:", "synthetic", ".claude");
const ROOT_CODEX = path.join("C:", "synthetic", ".codex");
const HOME_DIR = path.join("C:", "synthetic", "home");

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    roots: [ROOT_CLAUDE, ROOT_CODEX],
    activeWindowMinutes: 5,
    pollIntervalSec: 10,
    port: 4317,
    accounts: {},
    ...overrides,
  };
}

function makeLogger(config: AppConfig): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const log = createLogger({
    roots: config.roots,
    homeDir: HOME_DIR,
    sink: (line) => {
      lines.push(line);
    },
  });
  return { log, lines };
}

function claudeFile(
  overrides: Pick<ClaudeSessionFile, "id" | "jsonlPath" | "projectDir"> &
    Partial<ClaudeSessionFile>,
): ClaudeSessionFile {
  return {
    sizeBytes: 500,
    mtime: 0,
    hasCustomTitleFile: false,
    released: false,
    subagentCount: 0,
    ...overrides,
  };
}

function codexFile(
  overrides: Pick<CodexSessionFile, "id" | "jsonlPath"> & Partial<CodexSessionFile>,
): CodexSessionFile {
  return {
    sizeBytes: 500,
    mtime: 0,
    ...overrides,
  };
}

function locateClaudeResult(
  sessions: ClaudeSessionFile[],
  warnings: string[] = [],
): LocateClaudeResult {
  return { sessions, warnings };
}
function emptyClaudeResult(warnings: string[] = []): LocateClaudeResult {
  return { sessions: [], warnings };
}
function locateCodexResult(
  sessions: CodexSessionFile[],
  warnings: string[] = [],
): LocateCodexResult {
  return { sessions, warnings };
}
function emptyCodexResult(warnings: string[] = []): LocateCodexResult {
  return { sessions: [], warnings };
}
function runningMetaResult(metas: RunningMeta[], warnings: string[] = []): ReadRunningMetaResult {
  return { metas, warnings };
}
function emptyRunningMetaResult(warnings: string[] = []): ReadRunningMetaResult {
  return { metas: [], warnings };
}

function makeRunningMeta(
  overrides: Pick<RunningMeta, "pid" | "sessionId"> & Partial<RunningMeta>,
): RunningMeta {
  return {
    cwd: "C:/synthetic/project",
    startedAt: 0,
    procStart: 0,
    entrypoint: "claude-desktop",
    version: "1.0.0",
    ...overrides,
  };
}

function makeProcess(overrides: Pick<ProcessInfo, "pid"> & Partial<ProcessInfo>): ProcessInfo {
  return {
    name: "claude.exe",
    creationFileTime: null,
    commandLine: null,
    ...overrides,
  };
}

function processesAvailable(processes: ProcessInfo[] = []): ProcessListResult {
  return { available: true, processes, fetchedAt: 0 };
}
function processesUnavailable(
  reason = "プロセス一覧を取得できませんでした（テスト用フェイク）。",
): ProcessListResult {
  return { available: false, reason };
}

/** filePath ごとの行配列を返す readHeadLines / readTailLines のフェイクを作る。 */
function makeLineReaders(opts: {
  head?: Record<string, string[]>;
  tail?: Record<string, string[]>;
  headErrPaths?: string[];
  tailErrPaths?: string[];
}) {
  const headErrSet = new Set(opts.headErrPaths ?? []);
  const tailErrSet = new Set(opts.tailErrPaths ?? []);
  const readHeadLines = vi.fn(
    async (filePath: string, _maxBytes: number): Promise<Result<string[]>> => {
      if (headErrSet.has(filePath)) {
        return err({
          code: "file_unreadable",
          message: "読み取れません（テスト用フェイク）",
          hint: "権限を確認してください",
        });
      }
      return ok(opts.head?.[filePath] ?? []);
    },
  );
  const readTailLines = vi.fn(
    async (filePath: string, _maxBytes: number): Promise<Result<string[]>> => {
      if (tailErrSet.has(filePath)) {
        return err({
          code: "file_unreadable",
          message: "読み取れません（テスト用フェイク）",
          hint: "権限を確認してください",
        });
      }
      return ok(opts.tail?.[filePath] ?? []);
    },
  );
  return { readHeadLines, readTailLines };
}

function line(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

// ===========================================================================
// 1. 基本構造
// ===========================================================================

describe("SessionIndex: 基本構造", () => {
  it("rebuild / refreshFiles / getAll / get / getAccounts / getWarnings / isProcessInfoAvailable を持つ", async () => {
    const config = baseConfig({ roots: [] });
    const { log } = makeLogger(config);
    const deps: SessionIndexDeps = {
      listProcesses: vi.fn(async () => processesAvailable([])),
    };
    const index = new SessionIndex(config, log, deps);

    expect(typeof index.rebuild).toBe("function");
    expect(typeof index.refreshFiles).toBe("function");
    expect(typeof index.getAll).toBe("function");
    expect(typeof index.get).toBe("function");
    expect(typeof index.getAccounts).toBe("function");
    expect(typeof index.getWarnings).toBe("function");
    expect(typeof index.isProcessInfoAvailable).toBe("function");

    const result = await index.rebuild();
    expect(result.scanned).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(typeof result.durationMs).toBe("number");
    expect(index.getAll()).toEqual([]);
    expect(index.getAccounts()).toEqual([]);
    expect(index.get("claude:nope")).toBeUndefined();
  });
});

// ===========================================================================
// 2. 正常系: フィールドの組み立て（Claude Desktop / Claude CLI / Codex）
// ===========================================================================

describe("SessionIndex.rebuild: 正常系フィールド組み立て", () => {
  const ID_DESKTOP = "00000000-0000-4000-8000-000000000001";
  const ID_CLI = "00000000-0000-4000-8000-000000000002";
  const ID_CODEX = "00000000-0000-4000-8000-000000000003";

  const PROJECT_DIR_A = path.join(ROOT_CLAUDE, "projects", "dir-a");
  const PROJECT_DIR_B = path.join(ROOT_CLAUDE, "projects", "dir-b");
  const JSONL_DESKTOP = path.join(PROJECT_DIR_A, `${ID_DESKTOP}.jsonl`);
  const JSONL_CLI = path.join(PROJECT_DIR_B, `${ID_CLI}.jsonl`);
  const CODEX_DAY_DIR = path.join(ROOT_CODEX, "sessions", "2026", "01", "15");
  const JSONL_CODEX = path.join(CODEX_DAY_DIR, `rollout-2026-01-15-${ID_CODEX}.jsonl`);

  const NOW_MS = Date.parse("2026-01-15T12:00:00.000Z");
  const DESKTOP_MTIME = NOW_MS - 2_000;
  const CLI_MTIME = NOW_MS - 60 * 60 * 1000; // 1 時間前 → idle
  const CODEX_MTIME = NOW_MS - 30_000;
  const DESKTOP_STARTED_AT = NOW_MS - 60_000;
  const PROC_START = 1_000_000_000;

  let index: SessionIndex;
  let lines: string[];

  beforeAll(async () => {
    const config = baseConfig();
    const logger = makeLogger(config);
    lines = logger.lines;

    const desktopMeta = makeRunningMeta({
      pid: 4242,
      sessionId: ID_DESKTOP,
      cwd: "C:/synthetic/project-a",
      startedAt: DESKTOP_STARTED_AT,
      procStart: PROC_START,
      entrypoint: "claude-desktop",
    });
    const claudeProcess = makeProcess({
      pid: 4242,
      name: "claude.exe",
      creationFileTime: PROC_START,
    });
    const codexProcess = makeProcess({
      pid: 5555,
      name: "codex.exe",
      creationFileTime: 2_000_000_000,
      commandLine: `codex --resume ${ID_CODEX}`,
    });

    const readers = makeLineReaders({
      head: {
        [JSONL_DESKTOP]: [
          line({
            type: "bridge-session",
            ownerAccountUuid: ID_DESKTOP,
            timestamp: "2026-01-15T11:00:00.000Z",
          }),
          line({
            type: "user",
            timestamp: "2026-01-15T11:00:01.000Z",
            cwd: "C:/synthetic/project-a",
            version: "1.2.3",
            gitBranch: "HEAD",
            entrypoint: "claude-desktop",
            message: { content: "Fix parser bug" },
          }),
          line({
            type: "assistant",
            timestamp: "2026-01-15T11:00:02.000Z",
            message: {
              model: "claude-sonnet-5",
              content: [{ type: "text", text: "Done, token sk-ant-abc123def456ghi789 redacted" }],
            },
          }),
        ],
        [JSONL_CLI]: [
          line({
            type: "user",
            timestamp: "2026-01-15T10:00:00.000Z",
            cwd: "C:/synthetic/project-b",
            version: "1.0.0",
            gitBranch: "main",
            entrypoint: "cli",
            message: { content: "Plain CLI session" },
          }),
        ],
        [JSONL_CODEX]: [
          line({
            timestamp: "2026-01-15T11:59:00.000Z",
            type: "session_meta",
            payload: {
              cwd: "C:/synthetic/codex-project",
              originator: "codex_cli_rs",
              cli_version: "0.9.0",
              model_provider: "openai",
              git: { branch: "HEAD" },
            },
          }),
          line({
            timestamp: "2026-01-15T11:59:30.000Z",
            type: "turn_context",
            payload: { model: "o4-mini" },
          }),
          line({
            timestamp: "2026-01-15T11:59:45.000Z",
            type: "event_msg",
            payload: { type: "user_message", message: "Investigate CI failure" },
          }),
          line({
            timestamp: "2026-01-15T11:59:50.000Z",
            type: "event_msg",
            payload: {
              type: "task_complete",
              last_agent_message: "Fixed the CI failure, contact me at leaker@example.com",
            },
          }),
        ],
      },
    });

    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async (root: string) =>
        root === ROOT_CLAUDE
          ? locateClaudeResult([
              claudeFile({
                id: ID_DESKTOP,
                jsonlPath: JSONL_DESKTOP,
                projectDir: PROJECT_DIR_A,
                mtime: DESKTOP_MTIME,
                released: true,
                subagentCount: 2,
              }),
              claudeFile({
                id: ID_CLI,
                jsonlPath: JSONL_CLI,
                projectDir: PROJECT_DIR_B,
                mtime: CLI_MTIME,
              }),
            ])
          : emptyClaudeResult(),
      ),
      locateCodexSessions: vi.fn(async (root: string) =>
        root === ROOT_CODEX
          ? locateCodexResult([
              codexFile({ id: ID_CODEX, jsonlPath: JSONL_CODEX, mtime: CODEX_MTIME }),
            ])
          : emptyCodexResult(),
      ),
      readRunningMeta: vi.fn(async (root: string) =>
        root === ROOT_CLAUDE ? runningMetaResult([desktopMeta]) : emptyRunningMetaResult(),
      ),
      listProcesses: vi.fn(async () => processesAvailable([claudeProcess, codexProcess])),
      now: () => NOW_MS,
      ...readers,
    };

    index = new SessionIndex(config, logger.log, deps);
    await index.rebuild();
  });

  it("Claude Desktop セッション: 全フィールドが期待どおり組み立てられる（running・bridge-session の accountKey）", () => {
    const summary = index.get(`claude:${ID_DESKTOP}`);
    expect(summary).toEqual({
      key: `claude:${ID_DESKTOP}`,
      tool: "claude",
      id: ID_DESKTOP,
      title: "Fix parser bug",
      lastMessage: "Done, token sk-a•••• redacted",
      lastRole: "assistant",
      cwd: "C:/synthetic/project-a",
      branch: null,
      model: "claude-sonnet-5",
      entrypoint: "claude-desktop",
      accountKey: `claude:${ID_DESKTOP}`,
      state: "running",
      stateReason: "process",
      pid: 4242,
      startedAt: new Date(DESKTOP_STARTED_AT).toISOString(),
      firstAt: "2026-01-15T11:00:00.000Z",
      updatedAt: new Date(DESKTOP_MTIME).toISOString(),
      logSizeBytes: 500,
      subagentCount: 2,
      released: true,
    });
  });

  it("Claude CLI セッション: 全フィールドが期待どおり組み立てられる（accountKey は claude:cli、稼働メタなしで idle）", () => {
    const summary = index.get(`claude:${ID_CLI}`);
    expect(summary).toEqual({
      key: `claude:${ID_CLI}`,
      tool: "claude",
      id: ID_CLI,
      title: "Plain CLI session",
      lastMessage: "Plain CLI session",
      lastRole: "user",
      cwd: "C:/synthetic/project-b",
      branch: "main",
      model: null,
      entrypoint: "cli",
      accountKey: "claude:cli",
      state: "idle",
      stateReason: "none",
      pid: null,
      startedAt: null,
      firstAt: "2026-01-15T10:00:00.000Z",
      updatedAt: new Date(CLI_MTIME).toISOString(),
      logSizeBytes: 500,
      subagentCount: 0,
      released: false,
    });
  });

  it("Codex セッション: 全フィールドが期待どおり組み立てられる（コマンドラインに threadId を含み running）", () => {
    const summary = index.get(`codex:${ID_CODEX}`);
    expect(summary).toBeDefined();
    if (summary === undefined) return;
    expect(summary.key).toBe(`codex:${ID_CODEX}`);
    expect(summary.tool).toBe("codex");
    expect(summary.id).toBe(ID_CODEX);
    expect(summary.title).toBe("Investigate CI failure");
    expect(summary.lastMessage).toBe("Fixed the CI failure, contact me at ***@***");
    expect(summary.lastRole).toBe("assistant");
    expect(summary.cwd).toBe("C:/synthetic/codex-project");
    expect(summary.branch).toBeNull();
    expect(summary.model).toBe("o4-mini");
    expect(summary.entrypoint).toBe("codex-tui");
    expect(summary.accountKey).toBe("codex:openai");
    expect(summary.state).toBe("running");
    expect(summary.stateReason).toBe("process");
    expect(summary.pid).toBe(5555);
    expect(summary.startedAt).not.toBeNull();
    expect(summary.firstAt).toBe("2026-01-15T11:59:00.000Z");
    expect(summary.updatedAt).toBe(new Date(CODEX_MTIME).toISOString());
    expect(summary.logSizeBytes).toBe(500);
    expect(summary.subagentCount).toBe(0);
    expect(summary.released).toBe(false);
  });

  it("getAll() は updatedAt 降順（desktop → codex → cli）で返す", () => {
    expect(index.getAll().map((s) => s.key)).toEqual([
      `claude:${ID_DESKTOP}`,
      `codex:${ID_CODEX}`,
      `claude:${ID_CLI}`,
    ]);
  });

  it("getAccounts(): tool（claude→codex）→ label 順で、既定名（Claude CLI / Claude Desktop 1 / Codex）を採番する", () => {
    const accounts = index.getAccounts();
    expect(accounts.map((a) => a.key)).toEqual([
      "claude:cli",
      `claude:${ID_DESKTOP}`,
      "codex:openai",
    ]);
    expect(accounts.map((a) => a.label)).toEqual(["Claude CLI", "Claude Desktop 1", "Codex"]);
    for (const account of accounts) {
      expect(account.label).not.toContain(ID_DESKTOP);
    }
  });

  it("isProcessInfoAvailable() は listProcesses が available:true のとき true を返す", () => {
    expect(index.isProcessInfoAvailable()).toBe(true);
  });

  it("警告・ログ行に一時セッションの実パス・UUID・本文が含まれない", () => {
    expect(index.getWarnings().join(" ")).not.toContain(ID_DESKTOP);
    for (const l of lines) {
      expect(l).not.toContain(JSONL_DESKTOP);
      expect(l).not.toContain(ID_DESKTOP);
      expect(l).not.toContain("Fix parser bug");
      expect(l).not.toContain("sk-ant-");
    }
  });
});

// ===========================================================================
// 3. title の決定順
// ===========================================================================

describe("SessionIndex.rebuild: title の決定", () => {
  async function buildSingle(opts: {
    id: string;
    headLines: string[];
    hasCustomTitleFile?: boolean;
    customTitleLines?: string[];
  }): Promise<string> {
    const projectDir = path.join(ROOT_CLAUDE, "projects", "dir-a");
    const jsonlPath = path.join(projectDir, `${opts.id}.jsonl`);
    const customTitlePath = path.join(projectDir, opts.id, "custom-title.json");
    const config = baseConfig({ roots: [ROOT_CLAUDE] });
    const { log } = makeLogger(config);

    const head: Record<string, string[]> = { [jsonlPath]: opts.headLines };
    if (opts.customTitleLines !== undefined) {
      head[customTitlePath] = opts.customTitleLines;
    }
    const readers = makeLineReaders({ head });

    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async () =>
        locateClaudeResult([
          claudeFile({
            id: opts.id,
            jsonlPath,
            projectDir,
            hasCustomTitleFile: opts.hasCustomTitleFile ?? false,
          }),
        ]),
      ),
      locateCodexSessions: vi.fn(async () => emptyCodexResult()),
      readRunningMeta: vi.fn(async () => emptyRunningMetaResult()),
      listProcesses: vi.fn(async () => processesAvailable([])),
      now: () => Date.parse("2026-01-15T12:00:00.000Z"),
      ...readers,
    };

    const index = new SessionIndex(config, log, deps);
    await index.rebuild();
    const summary = index.get(`claude:${opts.id}`);
    expect(summary).toBeDefined();
    return summary?.title ?? "";
  }

  it('title 候補が無い（本文なし） → "(無題)"', async () => {
    const title = await buildSingle({
      id: "00000000-0000-4000-8000-000000000010",
      headLines: [],
    });
    expect(title).toBe(UNTITLED);
  });

  it('<command-name> で始まる user 本文はタイトルにならず "(無題)"（システム注入タグの除外）', async () => {
    const title = await buildSingle({
      id: "00000000-0000-4000-8000-000000000011",
      headLines: [
        line({
          type: "user",
          timestamp: "2026-01-15T11:00:00.000Z",
          message: { content: "<command-name>build</command-name>\nDo the thing" },
        }),
      ],
    });
    expect(title).toBe(UNTITLED);
  });

  it("custom-title.json が最優先される（JSONL 側にも title 候補があっても custom-title を採用）", async () => {
    const title = await buildSingle({
      id: "00000000-0000-4000-8000-000000000012",
      hasCustomTitleFile: true,
      customTitleLines: [JSON.stringify({ customTitle: "カスタムタイトル" })],
      headLines: [
        line({
          type: "user",
          timestamp: "2026-01-15T11:00:00.000Z",
          message: { content: "JSONL 側のタイトル候補" },
        }),
      ],
    });
    expect(title).toBe("カスタムタイトル");
  });

  it("title 中の sk-ant-... がマスクされる", async () => {
    const title = await buildSingle({
      id: "00000000-0000-4000-8000-000000000013",
      headLines: [
        line({
          type: "user",
          timestamp: "2026-01-15T11:00:00.000Z",
          message: { content: "key sk-ant-zzzzzzzzzzzzzzzzzzzzzzzzzz here" },
        }),
      ],
    });
    expect(title).toContain("••••");
    expect(title).not.toContain("sk-ant-zzzzzzzzzzzzzzzzzzzzzzzzzz");
  });

  it(`121 文字以上の title は ${TITLE_MAX_CHARS} 文字に切られ、末尾が「…」になる`, async () => {
    const longTitle = "あ".repeat(TITLE_MAX_CHARS + 20);
    const title = await buildSingle({
      id: "00000000-0000-4000-8000-000000000014",
      headLines: [
        line({
          type: "user",
          timestamp: "2026-01-15T11:00:00.000Z",
          message: { content: longTitle },
        }),
      ],
    });
    expect(title.length).toBe(TITLE_MAX_CHARS);
    expect(title.endsWith("…")).toBe(true);
  });
});

// ===========================================================================
// 4. lastMessage のマスクと切り詰め
// ===========================================================================

describe("SessionIndex.rebuild: lastMessage のマスクと切り詰め", () => {
  it(`201 文字以上の lastMessage が ${LAST_MESSAGE_MAX_CHARS} 文字以内に切られ、末尾が「…」になる`, async () => {
    const id = "00000000-0000-4000-8000-000000000020";
    const projectDir = path.join(ROOT_CLAUDE, "projects", "dir-a");
    const jsonlPath = path.join(projectDir, `${id}.jsonl`);
    const config = baseConfig({ roots: [ROOT_CLAUDE] });
    const { log } = makeLogger(config);
    const longMessage = "x".repeat(LAST_MESSAGE_MAX_CHARS + 50);

    const readers = makeLineReaders({
      head: {
        [jsonlPath]: [
          line({
            type: "user",
            timestamp: "2026-01-15T11:00:00.000Z",
            message: { content: longMessage },
          }),
        ],
      },
    });

    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async () =>
        locateClaudeResult([claudeFile({ id, jsonlPath, projectDir })]),
      ),
      locateCodexSessions: vi.fn(async () => emptyCodexResult()),
      readRunningMeta: vi.fn(async () => emptyRunningMetaResult()),
      listProcesses: vi.fn(async () => processesAvailable([])),
      now: () => Date.parse("2026-01-15T12:00:00.000Z"),
      ...readers,
    };

    const index = new SessionIndex(config, log, deps);
    await index.rebuild();
    const summary = index.get(`claude:${id}`);
    expect(summary?.lastMessage.length).toBe(LAST_MESSAGE_MAX_CHARS);
    expect(summary?.lastMessage.endsWith("…")).toBe(true);
  });
});

// ===========================================================================
// 5. 稼働状態判定
// ===========================================================================

describe("SessionIndex.rebuild: 稼働状態判定", () => {
  const NOW_MS = Date.parse("2026-01-15T12:00:00.000Z");

  async function buildClaudeState(opts: {
    id: string;
    mtime: number;
    meta?: RunningMeta;
    processes?: ProcessInfo[];
    processesResult?: ProcessListResult;
    activeWindowMinutes?: number;
  }) {
    const projectDir = path.join(ROOT_CLAUDE, "projects", "dir-a");
    const jsonlPath = path.join(projectDir, `${opts.id}.jsonl`);
    const config = baseConfig({
      roots: [ROOT_CLAUDE],
      activeWindowMinutes: opts.activeWindowMinutes ?? 5,
    });
    const { log } = makeLogger(config);
    const readers = makeLineReaders({
      head: {
        [jsonlPath]: [
          line({
            type: "user",
            timestamp: "2026-01-15T11:00:00.000Z",
            message: { content: "hello" },
          }),
        ],
      },
    });

    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async () =>
        locateClaudeResult([claudeFile({ id: opts.id, jsonlPath, projectDir, mtime: opts.mtime })]),
      ),
      locateCodexSessions: vi.fn(async () => emptyCodexResult()),
      readRunningMeta: vi.fn(async () =>
        opts.meta !== undefined ? runningMetaResult([opts.meta]) : emptyRunningMetaResult(),
      ),
      listProcesses: vi.fn(
        async () => opts.processesResult ?? processesAvailable(opts.processes ?? []),
      ),
      now: () => NOW_MS,
      ...readers,
    };

    const index = new SessionIndex(config, log, deps);
    await index.rebuild();
    return { index, summary: index.get(`claude:${opts.id}`) };
  }

  it("プロセスメタあり + pid 一致 + procStart 一致 → running / process", async () => {
    const id = "00000000-0000-4000-8000-000000000030";
    const { summary } = await buildClaudeState({
      id,
      mtime: NOW_MS,
      meta: makeRunningMeta({
        pid: 4242,
        sessionId: id,
        startedAt: NOW_MS - 1000,
        procStart: 1_000_000_000,
      }),
      processes: [makeProcess({ pid: 4242, creationFileTime: 1_000_000_000 })],
    });
    expect(summary?.state).toBe("running");
    expect(summary?.stateReason).toBe("process");
    expect(summary?.pid).toBe(4242);
    expect(summary?.startedAt).toBe(new Date(NOW_MS - 1000).toISOString());
  });

  it(`procStart が 2 秒（許容差 ${PROC_START_TOLERANCE_TICKS} ticks 超）ずれていると running でない`, async () => {
    const id = "00000000-0000-4000-8000-000000000031";
    const { summary } = await buildClaudeState({
      id,
      mtime: NOW_MS - 60_000, // 1 分前 → active
      meta: makeRunningMeta({
        pid: 4242,
        sessionId: id,
        startedAt: NOW_MS - 1000,
        procStart: 1_000_000_000,
      }),
      processes: [
        makeProcess({
          pid: 4242,
          creationFileTime: 1_000_000_000 + PROC_START_TOLERANCE_TICKS * 2,
        }),
      ],
    });
    expect(summary?.state).not.toBe("running");
    expect(summary?.state).toBe("active");
    expect(summary?.stateReason).toBe("mtime");
    expect(summary?.pid).toBeNull();
    expect(summary?.startedAt).toBeNull();
  });

  it("listProcesses が available:false → stateReason: no-process-info（state は mtime 由来）", async () => {
    const id = "00000000-0000-4000-8000-000000000032";
    const { summary, index } = await buildClaudeState({
      id,
      mtime: NOW_MS - 60_000, // 1 分前
      processesResult: processesUnavailable(),
    });
    expect(summary?.state).toBe("active");
    expect(summary?.stateReason).toBe("no-process-info");
    expect(summary?.pid).toBeNull();
    expect(index.isProcessInfoAvailable()).toBe(false);
  });

  it("mtime が 1 分前 → active / mtime", async () => {
    const id = "00000000-0000-4000-8000-000000000033";
    const { summary } = await buildClaudeState({
      id,
      mtime: NOW_MS - 60_000,
      processes: [],
    });
    expect(summary?.state).toBe("active");
    expect(summary?.stateReason).toBe("mtime");
  });

  it("mtime が 1 時間前 → idle / none", async () => {
    const id = "00000000-0000-4000-8000-000000000034";
    const { summary } = await buildClaudeState({
      id,
      mtime: NOW_MS - 60 * 60 * 1000,
      processes: [],
    });
    expect(summary?.state).toBe("idle");
    expect(summary?.stateReason).toBe("none");
  });

  it("Codex: コマンドラインに threadId を含むプロセスがあれば running", async () => {
    const codexId = "00000000-0000-4000-8000-000000000035";
    const jsonlPath = path.join(
      ROOT_CODEX,
      "sessions",
      "2026",
      "01",
      "15",
      `rollout-x-${codexId}.jsonl`,
    );
    const config = baseConfig({ roots: [ROOT_CODEX] });
    const { log } = makeLogger(config);
    const readers = makeLineReaders({
      head: {
        [jsonlPath]: [
          line({
            timestamp: "2026-01-15T11:00:00.000Z",
            type: "session_meta",
            payload: { model_provider: "openai" },
          }),
        ],
      },
    });
    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async () => emptyClaudeResult()),
      locateCodexSessions: vi.fn(async () =>
        locateCodexResult([codexFile({ id: codexId, jsonlPath, mtime: NOW_MS - 60 * 60 * 1000 })]),
      ),
      readRunningMeta: vi.fn(async () => emptyRunningMetaResult()),
      listProcesses: vi.fn(async () =>
        processesAvailable([
          makeProcess({
            pid: 9001,
            name: "codex.exe",
            commandLine: `codex --resume ${codexId}`,
          }),
        ]),
      ),
      now: () => NOW_MS,
      ...readers,
    };
    const index = new SessionIndex(config, log, deps);
    await index.rebuild();
    const summary = index.get(`codex:${codexId}`);
    expect(summary?.state).toBe("running");
    expect(summary?.stateReason).toBe("process");
    expect(summary?.pid).toBe(9001);
  });

  it("Codex: threadId を含むプロセスが無ければ idle（mtime 次第）", async () => {
    const codexId = "00000000-0000-4000-8000-000000000036";
    const jsonlPath = path.join(
      ROOT_CODEX,
      "sessions",
      "2026",
      "01",
      "15",
      `rollout-x-${codexId}.jsonl`,
    );
    const config = baseConfig({ roots: [ROOT_CODEX] });
    const { log } = makeLogger(config);
    const readers = makeLineReaders({
      head: {
        [jsonlPath]: [
          line({
            timestamp: "2026-01-15T11:00:00.000Z",
            type: "session_meta",
            payload: { model_provider: "openai" },
          }),
        ],
      },
    });
    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async () => emptyClaudeResult()),
      locateCodexSessions: vi.fn(async () =>
        locateCodexResult([codexFile({ id: codexId, jsonlPath, mtime: NOW_MS - 60 * 60 * 1000 })]),
      ),
      readRunningMeta: vi.fn(async () => emptyRunningMetaResult()),
      listProcesses: vi.fn(async () =>
        processesAvailable([
          makeProcess({ pid: 9002, name: "codex.exe", commandLine: "codex --resume other-id" }),
        ]),
      ),
      now: () => NOW_MS,
      ...readers,
    };
    const index = new SessionIndex(config, log, deps);
    await index.rebuild();
    const summary = index.get(`codex:${codexId}`);
    expect(summary?.state).toBe("idle");
    expect(summary?.stateReason).toBe("none");
    expect(summary?.pid).toBeNull();
  });
});

// ===========================================================================
// 6. アカウント合成
// ===========================================================================

describe("SessionIndex.getAccounts: アカウント合成", () => {
  async function buildIndex(opts: {
    claude?: { file: ClaudeSessionFile; meta?: RunningMeta; headLines: string[] }[];
    codex?: { file: CodexSessionFile; headLines: string[] }[];
    processes?: ProcessInfo[];
    accountsConfig?: Record<string, string>;
  }): Promise<SessionIndex> {
    const config = baseConfig({
      roots: [ROOT_CLAUDE, ROOT_CODEX],
      accounts: opts.accountsConfig ?? {},
    });
    const { log } = makeLogger(config);
    const head: Record<string, string[]> = {};
    for (const c of opts.claude ?? []) {
      head[c.file.jsonlPath] = c.headLines;
    }
    for (const c of opts.codex ?? []) {
      head[c.file.jsonlPath] = c.headLines;
    }
    const readers = makeLineReaders({ head });
    const metas = (opts.claude ?? []).flatMap((c) => (c.meta !== undefined ? [c.meta] : []));

    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async (root: string) =>
        root === ROOT_CLAUDE
          ? locateClaudeResult((opts.claude ?? []).map((c) => c.file))
          : emptyClaudeResult(),
      ),
      locateCodexSessions: vi.fn(async (root: string) =>
        root === ROOT_CODEX
          ? locateCodexResult((opts.codex ?? []).map((c) => c.file))
          : emptyCodexResult(),
      ),
      readRunningMeta: vi.fn(async (root: string) =>
        root === ROOT_CLAUDE ? runningMetaResult(metas) : emptyRunningMetaResult(),
      ),
      listProcesses: vi.fn(async () => processesAvailable(opts.processes ?? [])),
      now: () => Date.parse("2026-01-15T12:00:00.000Z"),
      ...readers,
    };

    const index = new SessionIndex(config, log, deps);
    await index.rebuild();
    return index;
  }

  it("config.accounts の表示名で Account.label が上書きされる", async () => {
    const id = "00000000-0000-4000-8000-000000000040";
    const projectDir = path.join(ROOT_CLAUDE, "projects", "dir-a");
    const jsonlPath = path.join(projectDir, `${id}.jsonl`);
    const index = await buildIndex({
      claude: [
        {
          file: claudeFile({ id, jsonlPath, projectDir }),
          headLines: [
            line({
              type: "user",
              timestamp: "2026-01-15T11:00:00.000Z",
              message: { content: "hi" },
            }),
          ],
        },
      ],
      accountsConfig: { "claude:cli": "個人用アカウント" },
    });
    const accounts = index.getAccounts();
    const account = accounts.find((a) => a.key === "claude:cli");
    expect(account?.label).toBe("個人用アカウント");
  });

  it("複数の Claude Desktop（uuid 付き）は firstAt の早い順に Claude Desktop 1 / 2 と採番される", async () => {
    const idA = "00000000-0000-4000-8000-000000000041";
    const idB = "00000000-0000-4000-8000-000000000042";
    const uuidA = "00000000-0000-4000-8000-0000000000a1";
    const uuidB = "00000000-0000-4000-8000-0000000000b1";
    const projectDir = path.join(ROOT_CLAUDE, "projects", "dir-a");
    const jsonlA = path.join(projectDir, `${idA}.jsonl`);
    const jsonlB = path.join(projectDir, `${idB}.jsonl`);

    // 挿入順序をわざと firstAt と逆にする（B を先に置く）。ラベル採番は挿入順でなく firstAt 順であることを確認する。
    const index = await buildIndex({
      claude: [
        {
          file: claudeFile({ id: idB, jsonlPath: jsonlB, projectDir }),
          headLines: [
            line({
              type: "bridge-session",
              ownerAccountUuid: uuidB,
              timestamp: "2026-01-15T11:30:00.000Z",
            }),
            line({
              type: "user",
              timestamp: "2026-01-15T11:30:01.000Z",
              message: { content: "second" },
            }),
          ],
        },
        {
          file: claudeFile({ id: idA, jsonlPath: jsonlA, projectDir }),
          headLines: [
            line({
              type: "bridge-session",
              ownerAccountUuid: uuidA,
              timestamp: "2026-01-15T10:00:00.000Z",
            }),
            line({
              type: "user",
              timestamp: "2026-01-15T10:00:01.000Z",
              message: { content: "first" },
            }),
          ],
        },
      ],
    });
    const accounts = index.getAccounts();
    const accountA = accounts.find((a) => a.key === `claude:${uuidA}`);
    const accountB = accounts.find((a) => a.key === `claude:${uuidB}`);
    expect(accountA?.label).toBe("Claude Desktop 1");
    expect(accountB?.label).toBe("Claude Desktop 2");
  });

  it("Codex の model_provider が 2 種類以上あるとき Codex (provider) 形式になる", async () => {
    const idOpenai = "00000000-0000-4000-8000-000000000043";
    const idAnthropic = "00000000-0000-4000-8000-000000000044";
    const dayDir = path.join(ROOT_CODEX, "sessions", "2026", "01", "15");
    const jsonlOpenai = path.join(dayDir, `rollout-a-${idOpenai}.jsonl`);
    const jsonlAnthropic = path.join(dayDir, `rollout-b-${idAnthropic}.jsonl`);

    const index = await buildIndex({
      codex: [
        {
          file: codexFile({ id: idOpenai, jsonlPath: jsonlOpenai }),
          headLines: [
            line({
              timestamp: "2026-01-15T11:00:00.000Z",
              type: "session_meta",
              payload: { model_provider: "openai" },
            }),
          ],
        },
        {
          file: codexFile({ id: idAnthropic, jsonlPath: jsonlAnthropic }),
          headLines: [
            line({
              timestamp: "2026-01-15T11:00:00.000Z",
              type: "session_meta",
              payload: { model_provider: "anthropic" },
            }),
          ],
        },
      ],
    });
    const accounts = index.getAccounts();
    expect(accounts.map((a) => a.label).sort()).toEqual(["Codex (anthropic)", "Codex (openai)"]);
  });

  it("running / runningCount / sessionCount / startedAt（最古の running）が正しく集計される", async () => {
    const idRunning1 = "00000000-0000-4000-8000-000000000045";
    const idRunning2 = "00000000-0000-4000-8000-000000000046";
    const idIdle = "00000000-0000-4000-8000-000000000047";
    const projectDir = path.join(ROOT_CLAUDE, "projects", "dir-a");
    const jsonl1 = path.join(projectDir, `${idRunning1}.jsonl`);
    const jsonl2 = path.join(projectDir, `${idRunning2}.jsonl`);
    const jsonl3 = path.join(projectDir, `${idIdle}.jsonl`);
    const NOW = Date.parse("2026-01-15T12:00:00.000Z");

    const meta1 = makeRunningMeta({
      pid: 1001,
      sessionId: idRunning1,
      startedAt: NOW - 100_000, // より新しい
      procStart: 1_000_000_000,
    });
    const meta2 = makeRunningMeta({
      pid: 1002,
      sessionId: idRunning2,
      startedAt: NOW - 500_000, // より古い → account.startedAt はこちら
      procStart: 2_000_000_000,
    });

    const index = await buildIndex({
      claude: [
        {
          file: claudeFile({ id: idRunning1, jsonlPath: jsonl1, projectDir }),
          meta: meta1,
          headLines: [
            line({
              type: "user",
              timestamp: "2026-01-15T11:00:00.000Z",
              message: { content: "a" },
            }),
          ],
        },
        {
          file: claudeFile({ id: idRunning2, jsonlPath: jsonl2, projectDir }),
          meta: meta2,
          headLines: [
            line({
              type: "user",
              timestamp: "2026-01-15T11:00:00.000Z",
              message: { content: "b" },
            }),
          ],
        },
        {
          file: claudeFile({
            id: idIdle,
            jsonlPath: jsonl3,
            projectDir,
            mtime: NOW - 60 * 60 * 1000,
          }),
          headLines: [
            line({
              type: "user",
              timestamp: "2026-01-15T11:00:00.000Z",
              message: { content: "c" },
            }),
          ],
        },
      ],
      processes: [
        makeProcess({ pid: 1001, creationFileTime: 1_000_000_000 }),
        makeProcess({ pid: 1002, creationFileTime: 2_000_000_000 }),
      ],
    });

    const account = index.getAccounts().find((a) => a.key === "claude:cli");
    expect(account?.sessionCount).toBe(3);
    expect(account?.runningCount).toBe(2);
    expect(account?.running).toBe(true);
    expect(account?.startedAt).toBe(new Date(NOW - 500_000).toISOString());
  });
});

// ===========================================================================
// 7. 重複セッション（同じ id が複数 root に出た場合）
// ===========================================================================

describe("SessionIndex.rebuild: 重複セッションは mtime の新しい方を採用する", () => {
  it("配列の先頭（処理順で先）でも mtime が新しければ、後から処理された古い方に上書きされない", async () => {
    const DUP_ID = "00000000-0000-4000-8000-000000000050";
    const ROOT_A = path.join("C:", "synthetic", "accountA", ".claude");
    const ROOT_B = path.join("C:", "synthetic", "accountB", ".claude");
    const projectDirA = path.join(ROOT_A, "projects", "dir-a");
    const projectDirB = path.join(ROOT_B, "projects", "dir-a");
    const jsonlA = path.join(projectDirA, `${DUP_ID}.jsonl`);
    const jsonlB = path.join(projectDirB, `${DUP_ID}.jsonl`);
    const NOW = Date.parse("2026-01-15T12:00:00.000Z");
    const NEWER_MTIME = NOW - 1_000; // root A（先に処理される）: 新しい
    const OLDER_MTIME = NOW - 100_000; // root B（後に処理される）: 古い

    const config = baseConfig({ roots: [ROOT_A, ROOT_B] });
    const { log } = makeLogger(config);
    const readers = makeLineReaders({
      head: {
        [jsonlA]: [
          line({
            type: "user",
            timestamp: "2026-01-15T11:00:00.000Z",
            message: { content: "root A の内容（新しい）" },
          }),
        ],
        [jsonlB]: [
          line({
            type: "user",
            timestamp: "2026-01-15T11:00:00.000Z",
            message: { content: "root B の内容（古い）" },
          }),
        ],
      },
    });

    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async (root: string) => {
        if (root === ROOT_A) {
          return locateClaudeResult([
            claudeFile({
              id: DUP_ID,
              jsonlPath: jsonlA,
              projectDir: projectDirA,
              mtime: NEWER_MTIME,
            }),
          ]);
        }
        if (root === ROOT_B) {
          return locateClaudeResult([
            claudeFile({
              id: DUP_ID,
              jsonlPath: jsonlB,
              projectDir: projectDirB,
              mtime: OLDER_MTIME,
            }),
          ]);
        }
        return emptyClaudeResult();
      }),
      locateCodexSessions: vi.fn(async () => emptyCodexResult()),
      readRunningMeta: vi.fn(async () => emptyRunningMetaResult()),
      listProcesses: vi.fn(async () => processesAvailable([])),
      now: () => NOW,
      ...readers,
    };

    const index = new SessionIndex(config, log, deps);
    const result = await index.rebuild();

    expect(index.getAll().length).toBe(1);
    const summary = index.get(`claude:${DUP_ID}`);
    expect(summary?.title).toBe("root A の内容（新しい）");
    expect(summary?.updatedAt).toBe(new Date(NEWER_MTIME).toISOString());
    // scanned は locator が返したファイル数の合計（重複解消前）としてカウントされる。
    expect(result.scanned).toBe(2);
  });
});

// ===========================================================================
// 8. 読み取り失敗
// ===========================================================================

describe("SessionIndex.rebuild: 読み取り失敗", () => {
  it("readHeadLines が失敗 → state: error、索引から落とさず、lastMessage は固定文言（実パスを含まない）", async () => {
    const id = "00000000-0000-4000-8000-000000000060";
    const projectDir = path.join(ROOT_CLAUDE, "projects", "dir-a");
    const jsonlPath = path.join(projectDir, `${id}.jsonl`);
    const config = baseConfig({ roots: [ROOT_CLAUDE] });
    const { log } = makeLogger(config);
    const readers = makeLineReaders({ headErrPaths: [jsonlPath] });

    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async () =>
        locateClaudeResult([claudeFile({ id, jsonlPath, projectDir, sizeBytes: 500 })]),
      ),
      locateCodexSessions: vi.fn(async () => emptyCodexResult()),
      readRunningMeta: vi.fn(async () => emptyRunningMetaResult()),
      listProcesses: vi.fn(async () => processesAvailable([])),
      now: () => Date.parse("2026-01-15T12:00:00.000Z"),
      ...readers,
    };

    const index = new SessionIndex(config, log, deps);
    await index.rebuild();

    const summary = index.get(`claude:${id}`);
    expect(summary).toBeDefined();
    expect(summary?.state).toBe("error");
    expect(summary?.stateReason).toBe("none");
    expect(summary?.lastMessage.length).toBeGreaterThan(0);
    expect(summary?.lastMessage).not.toContain(jsonlPath);
    expect(index.getAll().length).toBe(1);
  });
});

// ===========================================================================
// 9. head / tail の読み分け（サイズ閾値）
// ===========================================================================

describe("SessionIndex.rebuild: head/tail の読み分け", () => {
  async function buildWithSize(sizeBytes: number) {
    const id = "00000000-0000-4000-8000-000000000070";
    const projectDir = path.join(ROOT_CLAUDE, "projects", "dir-a");
    const jsonlPath = path.join(projectDir, `${id}.jsonl`);
    const config = baseConfig({ roots: [ROOT_CLAUDE] });
    const { log } = makeLogger(config);
    const readers = makeLineReaders({
      head: {
        [jsonlPath]: [
          line({ type: "user", timestamp: "2026-01-15T11:00:00.000Z", message: { content: "hi" } }),
        ],
      },
      tail: {
        [jsonlPath]: [
          line({
            type: "assistant",
            timestamp: "2026-01-15T11:00:01.000Z",
            message: { content: "hi", model: "m" },
          }),
        ],
      },
    });

    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async () =>
        locateClaudeResult([claudeFile({ id, jsonlPath, projectDir, sizeBytes })]),
      ),
      locateCodexSessions: vi.fn(async () => emptyCodexResult()),
      readRunningMeta: vi.fn(async () => emptyRunningMetaResult()),
      listProcesses: vi.fn(async () => processesAvailable([])),
      now: () => Date.parse("2026-01-15T12:00:00.000Z"),
      ...readers,
    };

    const index = new SessionIndex(config, log, deps);
    await index.rebuild();
    return readers;
  }

  it(`sizeBytes が ${HEAD_BYTES + TAIL_BYTES}（128 KiB）以下は readHeadLines のみが 1 回呼ばれ、readTailLines は呼ばれない`, async () => {
    const readers = await buildWithSize(HEAD_BYTES + TAIL_BYTES);
    expect(readers.readHeadLines).toHaveBeenCalledTimes(1);
    expect(readers.readHeadLines).toHaveBeenCalledWith(expect.any(String), HEAD_BYTES + TAIL_BYTES);
    expect(readers.readTailLines).not.toHaveBeenCalled();
  });

  it(`sizeBytes が ${HEAD_BYTES + TAIL_BYTES} を超える（130 KiB 相当）と readHeadLines / readTailLines が両方 1 回ずつ呼ばれる`, async () => {
    const readers = await buildWithSize(130 * 1024);
    expect(readers.readHeadLines).toHaveBeenCalledTimes(1);
    expect(readers.readHeadLines).toHaveBeenCalledWith(expect.any(String), HEAD_BYTES);
    expect(readers.readTailLines).toHaveBeenCalledTimes(1);
    expect(readers.readTailLines).toHaveBeenCalledWith(expect.any(String), TAIL_BYTES);
  });
});

// ===========================================================================
// 10. refreshFiles
// ===========================================================================

describe("SessionIndex.refreshFiles", () => {
  const ID_1 = "00000000-0000-4000-8000-000000000080";
  const ID_2 = "00000000-0000-4000-8000-000000000081";
  const PROJECT_DIR = path.join(ROOT_CLAUDE, "projects", "dir-a");
  const JSONL_1 = path.join(PROJECT_DIR, `${ID_1}.jsonl`);
  const JSONL_2 = path.join(PROJECT_DIR, `${ID_2}.jsonl`);
  const NOW = Date.parse("2026-01-15T12:00:00.000Z");

  function setup() {
    const config = baseConfig({ roots: [ROOT_CLAUDE] });
    const { log } = makeLogger(config);
    const headContent: Record<string, string[]> = {
      [JSONL_1]: [
        line({
          type: "user",
          timestamp: "2026-01-15T11:00:00.000Z",
          message: { content: "初期タイトル1" },
        }),
      ],
      [JSONL_2]: [
        line({
          type: "user",
          timestamp: "2026-01-15T11:00:00.000Z",
          message: { content: "初期タイトル2" },
        }),
      ],
    };
    const readers = makeLineReaders({ head: headContent });

    const locateClaudeSessions = vi.fn(async () =>
      locateClaudeResult([
        claudeFile({ id: ID_1, jsonlPath: JSONL_1, projectDir: PROJECT_DIR, mtime: NOW }),
        claudeFile({ id: ID_2, jsonlPath: JSONL_2, projectDir: PROJECT_DIR, mtime: NOW }),
      ]),
    );
    const readRunningMeta = vi.fn(async () => emptyRunningMetaResult());
    const listProcesses = vi.fn(async () => processesAvailable([]));

    const deps: SessionIndexDeps = {
      locateClaudeSessions,
      locateCodexSessions: vi.fn(async () => emptyCodexResult()),
      readRunningMeta,
      listProcesses,
      now: () => NOW,
      ...readers,
    };

    const index = new SessionIndex(config, log, deps);
    return { index, headContent, locateClaudeSessions, readRunningMeta, listProcesses };
  }

  it("既存 jsonl を書き換えて呼ぶと、その 1 件だけが再構築される（他方は変化しない）", async () => {
    const { index, headContent, locateClaudeSessions } = setup();
    await index.rebuild();
    expect(locateClaudeSessions).toHaveBeenCalledTimes(1);

    headContent[JSONL_1] = [
      line({
        type: "user",
        timestamp: "2026-01-15T11:30:00.000Z",
        message: { content: "更新後タイトル1" },
      }),
    ];

    const result = await index.refreshFiles([JSONL_1]);

    expect(locateClaudeSessions).toHaveBeenCalledTimes(2);
    expect(result.scanned).toBe(1);
    expect(index.get(`claude:${ID_1}`)?.title).toBe("更新後タイトル1");
    expect(index.get(`claude:${ID_2}`)?.title).toBe("初期タイトル2");
  });

  it("sessions/ 配下のパスを渡すと、稼働状態だけが再計算される（locateClaudeSessions は増えない）", async () => {
    const { index, locateClaudeSessions, readRunningMeta } = setup();
    await index.rebuild();
    expect(locateClaudeSessions).toHaveBeenCalledTimes(1);
    expect(readRunningMeta).toHaveBeenCalledTimes(1);

    const sessionsFilePath = path.join(ROOT_CLAUDE, "sessions", "9999.json");
    await index.refreshFiles([sessionsFilePath]);

    expect(locateClaudeSessions).toHaveBeenCalledTimes(1); // 増えない
    expect(readRunningMeta).toHaveBeenCalledTimes(2); // 状態再計算のために呼ばれる
    // 状態自体は変わらない（メタなしのまま）が例外は起きない
    expect(index.get(`claude:${ID_1}`)?.state).toBeDefined();
  });

  it("索引に無い未知のパスを渡すと rebuild() と同じ結果にフォールバックする", async () => {
    const { index, locateClaudeSessions } = setup();
    await index.rebuild();
    expect(locateClaudeSessions).toHaveBeenCalledTimes(1);

    const unknownPath = path.join("C:", "synthetic", "unknown", "path.jsonl");
    const result = await index.refreshFiles([unknownPath]);

    expect(locateClaudeSessions).toHaveBeenCalledTimes(2); // rebuild が再度走る
    expect(result.scanned).toBe(2);
    expect(index.getAll().length).toBe(2);
  });

  it("空配列を渡すと何も呼ばれず、既存の索引がそのまま返る", async () => {
    const { index, locateClaudeSessions, readRunningMeta, listProcesses } = setup();
    await index.rebuild();
    locateClaudeSessions.mockClear();
    readRunningMeta.mockClear();
    listProcesses.mockClear();

    const result = await index.refreshFiles([]);

    expect(locateClaudeSessions).not.toHaveBeenCalled();
    expect(readRunningMeta).not.toHaveBeenCalled();
    expect(listProcesses).not.toHaveBeenCalled();
    expect(result.scanned).toBe(0);
    expect(index.getAll().length).toBe(2);
  });
});

// ===========================================================================
// 11. 空 root / ディレクトリなし（実ファイル）
// ===========================================================================

describe("SessionIndex: 空 roots / ディレクトリなし（実ファイル）", () => {
  it("roots が空配列 → getAll() 空、getAccounts() 空、例外なし", async () => {
    const config = baseConfig({ roots: [] });
    const { log } = makeLogger(config);
    const deps: SessionIndexDeps = {
      listProcesses: vi.fn(async () => processesAvailable([])),
    };
    const index = new SessionIndex(config, log, deps);
    const result = await index.rebuild();

    expect(result.scanned).toBe(0);
    expect(index.getAll()).toEqual([]);
    expect(index.getAccounts()).toEqual([]);
    expect(index.getWarnings()).toEqual([]);
  });

  it("root は指定されているが projects/ も sessions/ も無い（実ディレクトリ） → 空 + 警告あり + 例外なし", async () => {
    const tmpBase = await mkdtemp(path.join(tmpdir(), "ai-manager-session-index-empty-"));
    try {
      const claudeRoot = path.join(tmpBase, ".claude"); // わざと作らない（存在しない）
      const config = baseConfig({ roots: [claudeRoot] });
      const { log } = makeLogger(config);
      const deps: SessionIndexDeps = {
        // 実物の locateClaudeSessions / readRunningMeta を使う（存在しないディレクトリを安全に処理できることの確認）。
        listProcesses: vi.fn(async () => processesAvailable([])),
      };
      const index = new SessionIndex(config, log, deps);
      const result = await index.rebuild();

      expect(index.getAll()).toEqual([]);
      expect(index.getAccounts()).toEqual([]);
      expect(result.warnings.length).toBeGreaterThan(0);
      for (const w of result.warnings) {
        expect(w).not.toContain(tmpBase);
      }
    } finally {
      await rm(tmpBase, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// 12. ログにパス・タイトル・本文・UUID が出ない（実ファイル）
// ===========================================================================

describe("SessionIndex: ログに実パス・UUID・本文が出ない（実ファイル）", () => {
  it("実際の一時ディレクトリを走査しても、ログ行に実パス・UUID・本文が含まれない", async () => {
    const tmpBase = await mkdtemp(path.join(tmpdir(), "ai-manager-session-index-log-"));
    try {
      const sessionId = "00000000-0000-4000-8000-000000000090";
      const claudeRoot = path.join(tmpBase, ".claude");
      const projectDir = path.join(claudeRoot, "projects", "dir-a");
      const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`);
      await mkdir(projectDir, { recursive: true });
      const jsonlContent = `${line({
        type: "user",
        timestamp: "2026-01-15T11:00:00.000Z",
        cwd: "C:/synthetic/secret-project",
        message: { content: "秘密の本文 sk-ant-verysecrettoken0000000000" },
      })}\n`;
      await writeFile(jsonlPath, jsonlContent);

      const config = baseConfig({ roots: [claudeRoot] });
      const { log, lines } = makeLogger(config);
      const deps: SessionIndexDeps = {
        listProcesses: vi.fn(async () => processesAvailable([])),
      };
      const index = new SessionIndex(config, log, deps);
      await index.rebuild();

      expect(index.getAll().length).toBe(1);
      for (const l of lines) {
        expect(l).not.toContain(tmpBase);
        expect(l).not.toContain(jsonlPath);
        expect(l).not.toContain(sessionId);
        expect(l).not.toContain("秘密の本文");
        expect(l).not.toContain("sk-ant-");
      }
    } finally {
      await rm(tmpBase, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// 13. getAll() のコピー保証
// ===========================================================================

describe("SessionIndex.getAll: 内部配列のコピーであること", () => {
  it("返り値を破壊しても次の getAll() に影響しない", async () => {
    const id = "00000000-0000-4000-8000-000000000099";
    const projectDir = path.join(ROOT_CLAUDE, "projects", "dir-a");
    const jsonlPath = path.join(projectDir, `${id}.jsonl`);
    const config = baseConfig({ roots: [ROOT_CLAUDE] });
    const { log } = makeLogger(config);
    const readers = makeLineReaders({
      head: {
        [jsonlPath]: [
          line({ type: "user", timestamp: "2026-01-15T11:00:00.000Z", message: { content: "hi" } }),
        ],
      },
    });

    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async () =>
        locateClaudeResult([claudeFile({ id, jsonlPath, projectDir })]),
      ),
      locateCodexSessions: vi.fn(async () => emptyCodexResult()),
      readRunningMeta: vi.fn(async () => emptyRunningMetaResult()),
      listProcesses: vi.fn(async () => processesAvailable([])),
      now: () => Date.parse("2026-01-15T12:00:00.000Z"),
      ...readers,
    };

    const index = new SessionIndex(config, log, deps);
    await index.rebuild();

    const first = index.getAll();
    expect(first.length).toBe(1);
    first.pop();
    expect(first.length).toBe(0);

    const second = index.getAll();
    expect(second.length).toBe(1);
  });
});

// ===========================================================================
// 14. レビュー REQUEST_CHANGES 対応（2 回目）
//   - refreshFiles の sessions/ 分岐は state:"error" を上書きしない
//   - refreshFiles は locator から消えたセッションを索引から削除する
//   - upsert は mtime 同値のとき jsonlPath 昇順が勝つ（root の並び順に依存しない）
//   - Codex の running 判定は extractResumeId 優先、フォールバックで commandLine 部分一致
// ===========================================================================

describe("SessionIndex.refreshFiles: sessions/ 分岐は state:error を上書きしない", () => {
  it("読み取り失敗で state:error になったセッションは、sessions/ 配下の refreshFiles を挟んでも error のまま（stateReason も不変）", async () => {
    const id = "00000000-0000-4000-8000-0000000000e1";
    const projectDir = path.join(ROOT_CLAUDE, "projects", "dir-a");
    const jsonlPath = path.join(projectDir, `${id}.jsonl`);
    const config = baseConfig({ roots: [ROOT_CLAUDE] });
    const { log } = makeLogger(config);
    const readers = makeLineReaders({ headErrPaths: [jsonlPath] });

    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async () =>
        locateClaudeResult([claudeFile({ id, jsonlPath, projectDir })]),
      ),
      locateCodexSessions: vi.fn(async () => emptyCodexResult()),
      readRunningMeta: vi.fn(async () => emptyRunningMetaResult()),
      listProcesses: vi.fn(async () => processesAvailable([])),
      now: () => Date.parse("2026-01-15T12:00:00.000Z"),
      ...readers,
    };

    const index = new SessionIndex(config, log, deps);
    await index.rebuild();
    expect(index.get(`claude:${id}`)?.state).toBe("error");
    expect(index.get(`claude:${id}`)?.stateReason).toBe("none");

    // sessions/ 配下のパス（索引中のどの jsonlPath にも一致しない）を渡し、稼働状態だけの
    // 再計算パスに入れる。error セッションはこの再計算の対象から除外され、上書きされないこと。
    const sessionsFilePath = path.join(ROOT_CLAUDE, "sessions", "1234.json");
    await index.refreshFiles([sessionsFilePath]);

    const after = index.get(`claude:${id}`);
    expect(after?.state).toBe("error");
    expect(after?.stateReason).toBe("none");
  });
});

describe("SessionIndex.refreshFiles: locator から消えたセッションは索引から削除される", () => {
  it("既知の jsonlPath を refreshFiles に渡したとき、locator フェイクがそのファイルをもう返さなければ索引から消え getAll() に出ない", async () => {
    const id = "00000000-0000-4000-8000-0000000000e2";
    const projectDir = path.join(ROOT_CLAUDE, "projects", "dir-a");
    const jsonlPath = path.join(projectDir, `${id}.jsonl`);
    const config = baseConfig({ roots: [ROOT_CLAUDE] });
    const { log } = makeLogger(config);
    const readers = makeLineReaders({
      head: {
        [jsonlPath]: [
          line({
            type: "user",
            timestamp: "2026-01-15T11:00:00.000Z",
            message: { content: "存在していた頃のタイトル" },
          }),
        ],
      },
    });

    // 走査のたびに参照する可変リスト。refreshFiles の 2 回目呼び出し前に空にして「削除された」を模擬する。
    let currentFiles: ClaudeSessionFile[] = [claudeFile({ id, jsonlPath, projectDir })];

    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async () => locateClaudeResult(currentFiles)),
      locateCodexSessions: vi.fn(async () => emptyCodexResult()),
      readRunningMeta: vi.fn(async () => emptyRunningMetaResult()),
      listProcesses: vi.fn(async () => processesAvailable([])),
      now: () => Date.parse("2026-01-15T12:00:00.000Z"),
      ...readers,
    };

    const index = new SessionIndex(config, log, deps);
    await index.rebuild();
    expect(index.get(`claude:${id}`)).toBeDefined();
    expect(index.getAll().length).toBe(1);

    currentFiles = []; // ファイル削除を模擬（locator はもう返さない）
    await index.refreshFiles([jsonlPath]);

    expect(index.get(`claude:${id}`)).toBeUndefined();
    expect(index.getAll()).toEqual([]);
    expect(index.getAll().find((s) => s.key === `claude:${id}`)).toBeUndefined();
  });

  it("既知の jsonlPath を渡し、実ファイルを rm すると（実ファイル版）索引から消える", async () => {
    const tmpBase = await mkdtemp(path.join(tmpdir(), "ai-manager-session-index-delete-"));
    try {
      const id = "00000000-0000-4000-8000-0000000000e3";
      const claudeRoot = path.join(tmpBase, ".claude");
      const projectDir = path.join(claudeRoot, "projects", "dir-a");
      const jsonlPath = path.join(projectDir, `${id}.jsonl`);
      await mkdir(projectDir, { recursive: true });
      await writeFile(
        jsonlPath,
        `${line({ type: "user", timestamp: "2026-01-15T11:00:00.000Z", message: { content: "hi" } })}\n`,
      );

      const config = baseConfig({ roots: [claudeRoot] });
      const { log } = makeLogger(config);
      const deps: SessionIndexDeps = {
        listProcesses: vi.fn(async () => processesAvailable([])),
      };
      const index = new SessionIndex(config, log, deps);
      await index.rebuild();
      expect(index.get(`claude:${id}`)).toBeDefined();

      await rm(jsonlPath, { force: true });
      await index.refreshFiles([jsonlPath]);

      expect(index.get(`claude:${id}`)).toBeUndefined();
      expect(index.getAll()).toEqual([]);
    } finally {
      await rm(tmpBase, { recursive: true, force: true });
    }
  });
});

describe("SessionIndex.rebuild: Codex の commandLine に含まれる秘密情報・本文は一切露出しない", () => {
  it("commandLine に sk-ant- 形式の秘密情報と合成プロンプト本文と threadId を含む Codex プロセスがあっても、getAll() の全フィールド・ログ行のどこにも本文・秘密情報が現れない（threadId 一致で running にはなる）", async () => {
    const codexId = "00000000-0000-4000-8000-0000000000e4";
    const dayDir = path.join(ROOT_CODEX, "sessions", "2026", "01", "15");
    const jsonlPath = path.join(dayDir, `rollout-x-${codexId}.jsonl`);
    const config = baseConfig({ roots: [ROOT_CODEX] });
    const { log, lines } = makeLogger(config);

    const secretCommandLine =
      `codex --resume=${codexId} ` +
      '--prompt "合成の秘密プロンプト本文です。トークンは sk-ant-leakedtoken0000000000 です"';

    const readers = makeLineReaders({
      head: {
        [jsonlPath]: [
          line({
            timestamp: "2026-01-15T11:00:00.000Z",
            type: "session_meta",
            payload: { model_provider: "openai" },
          }),
          line({
            timestamp: "2026-01-15T11:00:01.000Z",
            type: "event_msg",
            payload: { type: "user_message", message: "通常のタイトル本文" },
          }),
        ],
      },
    });

    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async () => emptyClaudeResult()),
      locateCodexSessions: vi.fn(async () =>
        locateCodexResult([
          codexFile({ id: codexId, jsonlPath, mtime: Date.parse("2026-01-15T11:59:00.000Z") }),
        ]),
      ),
      readRunningMeta: vi.fn(async () => emptyRunningMetaResult()),
      listProcesses: vi.fn(async () =>
        processesAvailable([
          makeProcess({ pid: 7001, name: "codex.exe", commandLine: secretCommandLine }),
        ]),
      ),
      now: () => Date.parse("2026-01-15T12:00:00.000Z"),
      ...readers,
    };

    const index = new SessionIndex(config, log, deps);
    await index.rebuild();

    const summary = index.get(`codex:${codexId}`);
    expect(summary).toBeDefined();
    expect(summary?.state).toBe("running");
    expect(summary?.pid).toBe(7001);

    const serialized = JSON.stringify(index.getAll());
    expect(serialized).not.toContain("sk-ant-leakedtoken0000000000");
    expect(serialized).not.toContain("合成の秘密プロンプト本文です");
    for (const l of lines) {
      expect(l).not.toContain("sk-ant-leakedtoken0000000000");
      expect(l).not.toContain("合成の秘密プロンプト本文です");
      expect(l).not.toContain(secretCommandLine);
    }
  });
});

describe("SessionIndex.rebuild: Codex running 判定は --resume の値を優先する", () => {
  const TARGET_ID = "00000000-0000-4000-8000-0000000000e5";
  const OTHER_ID = "00000000-0000-4000-8000-0000000000e6";
  const OLD_MTIME = Date.parse("2026-01-15T10:00:00.000Z"); // 1 時間以上前 → running でなければ idle

  async function buildCodexWithProcess(commandLine: string) {
    const dayDir = path.join(ROOT_CODEX, "sessions", "2026", "01", "15");
    const jsonlPath = path.join(dayDir, `rollout-x-${TARGET_ID}.jsonl`);
    const config = baseConfig({ roots: [ROOT_CODEX] });
    const { log } = makeLogger(config);
    const readers = makeLineReaders({
      head: {
        [jsonlPath]: [
          line({
            timestamp: "2026-01-15T09:00:00.000Z",
            type: "session_meta",
            payload: { model_provider: "openai" },
          }),
        ],
      },
    });
    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async () => emptyClaudeResult()),
      locateCodexSessions: vi.fn(async () =>
        locateCodexResult([codexFile({ id: TARGET_ID, jsonlPath, mtime: OLD_MTIME })]),
      ),
      readRunningMeta: vi.fn(async () => emptyRunningMetaResult()),
      listProcesses: vi.fn(async () =>
        processesAvailable([makeProcess({ pid: 8001, name: "codex.exe", commandLine })]),
      ),
      now: () => Date.parse("2026-01-15T12:00:00.000Z"),
      ...readers,
    };
    const index = new SessionIndex(config, log, deps);
    await index.rebuild();
    return index.get(`codex:${TARGET_ID}`);
  }

  it("--resume=<別の threadId> のプロセスは、commandLine の別の場所に対象 threadId を含んでいても running にならない（resume id 優先）", async () => {
    const commandLine = `codex --resume=${OTHER_ID} --note see-also:${TARGET_ID}`;
    const summary = await buildCodexWithProcess(commandLine);
    expect(summary?.state).not.toBe("running");
    expect(summary?.state).toBe("idle");
    expect(summary?.pid).toBeNull();
  });

  it("--resume が無く、本文（コマンドライン）に対象 threadId を含む場合は running になる（フォールバック）", async () => {
    const commandLine = `codex-helper worker for ${TARGET_ID}`;
    const summary = await buildCodexWithProcess(commandLine);
    expect(summary?.state).toBe("running");
    expect(summary?.pid).toBe(8001);
  });
});

describe("SessionIndex.rebuild: 重複解消の tie-break（mtime 同値は jsonlPath 昇順）", () => {
  const DUP_ID = "00000000-0000-4000-8000-0000000000e7";
  const TIE_MTIME = Date.parse("2026-01-15T11:00:00.000Z");

  // ROOT_FIRST の jsonlPath が ROOT_SECOND のものより辞書順で必ず前に来るよう、
  // プロジェクトディレクトリ名自体をそれぞれ "dir-a" / "dir-z" にして差をつける。
  const ROOT_FIRST = path.join("C:", "synthetic", "tie-root-1", ".claude");
  const ROOT_SECOND = path.join("C:", "synthetic", "tie-root-2", ".claude");
  const PROJECT_DIR_FIRST = path.join(ROOT_FIRST, "projects", "dir-a");
  const PROJECT_DIR_SECOND = path.join(ROOT_SECOND, "projects", "dir-z");
  const JSONL_FIRST = path.join(PROJECT_DIR_FIRST, `${DUP_ID}.jsonl`);
  const JSONL_SECOND = path.join(PROJECT_DIR_SECOND, `${DUP_ID}.jsonl`);

  async function buildWithRootOrder(roots: string[]) {
    const config = baseConfig({ roots });
    const { log } = makeLogger(config);
    const readers = makeLineReaders({
      head: {
        [JSONL_FIRST]: [
          line({
            type: "user",
            timestamp: "2026-01-15T10:00:00.000Z",
            message: { content: "jsonlPath が辞書順で先の内容" },
          }),
        ],
        [JSONL_SECOND]: [
          line({
            type: "user",
            timestamp: "2026-01-15T10:00:00.000Z",
            message: { content: "jsonlPath が辞書順で後の内容" },
          }),
        ],
      },
    });
    const deps: SessionIndexDeps = {
      locateClaudeSessions: vi.fn(async (root: string) => {
        if (root === ROOT_FIRST) {
          return locateClaudeResult([
            claudeFile({
              id: DUP_ID,
              jsonlPath: JSONL_FIRST,
              projectDir: PROJECT_DIR_FIRST,
              mtime: TIE_MTIME,
            }),
          ]);
        }
        if (root === ROOT_SECOND) {
          return locateClaudeResult([
            claudeFile({
              id: DUP_ID,
              jsonlPath: JSONL_SECOND,
              projectDir: PROJECT_DIR_SECOND,
              mtime: TIE_MTIME,
            }),
          ]);
        }
        return emptyClaudeResult();
      }),
      locateCodexSessions: vi.fn(async () => emptyCodexResult()),
      readRunningMeta: vi.fn(async () => emptyRunningMetaResult()),
      listProcesses: vi.fn(async () => processesAvailable([])),
      now: () => Date.parse("2026-01-15T12:00:00.000Z"),
      ...readers,
    };
    const index = new SessionIndex(config, log, deps);
    await index.rebuild();
    return index.get(`claude:${DUP_ID}`);
  }

  it("mtime が同値のとき、jsonlPath 昇順で先のファイル（dir-a 側）が採用される", async () => {
    const summary = await buildWithRootOrder([ROOT_FIRST, ROOT_SECOND]);
    expect(summary?.title).toBe("jsonlPath が辞書順で先の内容");
  });

  it("root 配列の並び順を入れ替えても（ROOT_SECOND を先に）結果は変わらない（jsonlPath 昇順のファイルが勝つ）", async () => {
    const summary = await buildWithRootOrder([ROOT_SECOND, ROOT_FIRST]);
    expect(summary?.title).toBe("jsonlPath が辞書順で先の内容");
  });
});
