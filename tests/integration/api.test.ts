// T-013 Hono API（sessions / accounts / health）の統合テスト。
// `createApp(deps)` にフェイクの index（SessionIndex の実物は使わない）と
// `createLogger({ sink })` を渡し、`app.request()` で実 HTTP を立てずに検証する。
// フィクスチャは合成データのみ（os.homedir() には依存しない）。

import { describe, expect, it, vi } from "vitest";
import type { AppDeps } from "../../src/server/app";
import { createApp } from "../../src/server/app";
import type { AppConfig } from "../../src/server/config";
import { createLogger } from "../../src/server/log";
import type { EventHub } from "../../src/server/store/events";
import { createEventHub } from "../../src/server/store/events";
import type { RebuildResult } from "../../src/server/store/index";
import type { Result } from "../../src/shared/result";
import { err, ok } from "../../src/shared/result";
import type { Account, RecentMessage, SessionSummary, ToolKind } from "../../src/shared/types";

// T-015 第 1 段階レビュー対応: AppDeps に hub / refresh が必須で追加される見込みのため、
// 既存の createApp 呼び出しにもフェイクの hub / refresh を渡すようにする（既存のアサーションは変えない）。
// 実装（app.ts への配線）はまだ反映されていない可能性があるため、GET /api/events・POST /api/refresh の
// 新規テストは現時点で 404 になる場合がある（実装側の配線待ち）。

const HOME_DIR = "C:\\synthetic\\home";

function makeConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    roots: [`${HOME_DIR}\\.claude`, `${HOME_DIR}\\.codex`],
    activeWindowMinutes: 5,
    pollIntervalSec: 10,
    port: 4317,
    accounts: {},
    ...overrides,
  };
}

function makeSession(overrides?: Partial<SessionSummary>): SessionSummary {
  return {
    key: "claude:00000000-0000-4000-8000-000000000001",
    tool: "claude",
    id: "00000000-0000-4000-8000-000000000001",
    title: "合成セッション",
    lastMessage: "こんにちは",
    lastRole: "assistant",
    cwd: "C:\\synthetic\\project",
    branch: null,
    model: "claude-x",
    entrypoint: "cli",
    accountKey: "claude:cli",
    state: "idle",
    stateReason: "mtime",
    pid: null,
    startedAt: null,
    firstAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    logSizeBytes: 100,
    subagentCount: 0,
    released: false,
    ...overrides,
  };
}

function makeAccount(overrides?: Partial<Account>): Account {
  return {
    key: "claude:cli",
    label: "Claude CLI",
    tool: "claude",
    running: false,
    runningCount: 0,
    sessionCount: 1,
    startedAt: null,
    ...overrides,
  };
}

/** フェイク index。`getAll` は `throwOnGetAll` が true のとき例外を投げる（500 系のテスト用）。 */
function makeFakeIndex(options?: {
  sessions?: SessionSummary[];
  accounts?: Account[];
  warnings?: string[];
  processInfoAvailable?: boolean;
  throwOnGetAll?: boolean;
  /** key → jsonlPath/tool。`getSource` の戻り値を差し替える（T-014）。 */
  sources?: Record<string, { tool: ToolKind; jsonlPath: string }>;
}): AppDeps["index"] {
  const sessions = options?.sessions ?? [];
  const accounts = options?.accounts ?? [];
  const warnings = options?.warnings ?? [];
  const processInfoAvailable = options?.processInfoAvailable ?? false;
  const sources = options?.sources ?? {};
  const byKey = new Map(sessions.map((session) => [session.key, session]));

  return {
    getAll: () => {
      if (options?.throwOnGetAll) {
        throw new Error(
          "実際のセンシティブな例外メッセージ: C:\\synthetic\\home\\.claude\\secret.jsonl",
        );
      }
      return sessions;
    },
    get: (key: string) => byKey.get(key),
    getSource: (key: string) => sources[key],
    getAccounts: () => accounts,
    getWarnings: () => warnings,
    isProcessInfoAvailable: () => processInfoAvailable,
  };
}

const SYNTHETIC_SESSION_ID = "00000000-0000-4000-8000-000000000001";
const SYNTHETIC_JSONL_PATH = "C:\\synthetic\\secret.jsonl";

/** readClaudeDetail / readCodexDetail のフェイク。呼び出し引数を記録する。 */
function makeFakeReadDetail(
  result: Result<{ recentMessages: RecentMessage[]; parseWarnings: string[] }>,
): {
  fn: (
    jsonlPath: string,
  ) => Promise<Result<{ recentMessages: RecentMessage[]; parseWarnings: string[] }>>;
  calls: string[];
} {
  const calls: string[] = [];
  const fn = async (jsonlPath: string) => {
    calls.push(jsonlPath);
    return result;
  };
  return { fn, calls };
}

/**
 * T-015 第 1 段階レビュー対応で `AppDeps` に必須追加される見込みのフィールド。
 * 実装（app.ts）がまだ追加していない間も、拡張した型の変数として組み立ててから
 * `AppDeps` へ渡すことで（フレッシュなオブジェクトリテラルではないため）
 * 過剰プロパティチェックに引っかからないようにする。
 */
interface AppDepsWithEvents extends AppDeps {
  hub: EventHub;
  refresh: () => Promise<RebuildResult>;
}

function makeDeps(
  overrides?: Partial<AppDeps> & { hub?: EventHub; refresh?: () => Promise<RebuildResult> },
): AppDepsWithEvents {
  const { sink } = makeSinkCollector();
  const log = createLogger({ roots: [`${HOME_DIR}\\.claude`], homeDir: HOME_DIR, sink });
  const hub = overrides?.hub ?? createEventHub({ log });
  const refresh =
    overrides?.refresh ??
    vi.fn(async (): Promise<RebuildResult> => ({ scanned: 0, durationMs: 0, warnings: [] }));
  // `AppDeps.readClaudeDetail` / `readCodexDetail` は必須のため、既定の無害なフェイクを渡す
  // （詳細取得を検証しないテストがこの経路を触ることはないが、型を満たすために必要）。
  const { fn: defaultReadClaudeDetail } = makeFakeReadDetail(
    ok({ recentMessages: [], parseWarnings: [] }),
  );
  const { fn: defaultReadCodexDetail } = makeFakeReadDetail(
    ok({ recentMessages: [], parseWarnings: [] }),
  );
  return {
    index: makeFakeIndex(),
    config: makeConfig(),
    log,
    homeDir: HOME_DIR,
    version: "9.9.9",
    hub,
    refresh,
    readClaudeDetail: defaultReadClaudeDetail,
    readCodexDetail: defaultReadCodexDetail,
    ...overrides,
  };
}

function makeSinkCollector(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

describe("GET /api/sessions", () => {
  it("フェイク index が 2 件返す場合、200 で sessions が同一内容・generatedAt が now の ISO になる", async () => {
    const sessionA = makeSession({ key: "claude:a", id: "a" });
    const sessionB = makeSession({ key: "claude:b", id: "b", tool: "codex" });
    const now = () => new Date("2026-02-01T12:00:00.000Z");
    const app = createApp(
      makeDeps({ index: makeFakeIndex({ sessions: [sessionA, sessionB] }), now }),
    );

    const res = await app.request("/api/sessions");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([sessionA, sessionB]);
    expect(body.generatedAt).toBe("2026-02-01T12:00:00.000Z");
  });

  it("フェイク index が 0 件返す場合、sessions は空配列になる", async () => {
    const app = createApp(makeDeps({ index: makeFakeIndex({ sessions: [] }) }));

    const res = await app.request("/api/sessions");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
  });

  it("getAll() の要素が加工されずそのまま返る（フェイクが返したオブジェクトと toEqual）", async () => {
    const session = makeSession({
      key: "claude:c",
      id: "c",
      title: "加工されないはずのタイトル",
      lastMessage: "加工されないはずの本文",
    });
    const app = createApp(makeDeps({ index: makeFakeIndex({ sessions: [session] }) }));

    const res = await app.request("/api/sessions");
    const body = await res.json();

    expect(body.sessions[0]).toEqual(session);
  });
});

describe("GET /api/sessions/:tool/:id", () => {
  it("索引にあるとき 200 で SessionDetail の形（summary の全フィールド + recentMessages + parseWarnings、summary は加工されない）になる", async () => {
    const session = makeSession({
      key: `claude:${SYNTHETIC_SESSION_ID}`,
      id: SYNTHETIC_SESSION_ID,
      title: "加工されないはずのタイトル",
    });
    const recentMessages: RecentMessage[] = [
      { role: "user", at: "2026-01-01T00:00:00.000Z", text: "こんにちは" },
    ];
    const { fn: readClaudeDetail } = makeFakeReadDetail(ok({ recentMessages, parseWarnings: [] }));
    const app = createApp(
      makeDeps({
        index: makeFakeIndex({
          sessions: [session],
          sources: {
            [`claude:${SYNTHETIC_SESSION_ID}`]: { tool: "claude", jsonlPath: SYNTHETIC_JSONL_PATH },
          },
        }),
        readClaudeDetail,
      }),
    );

    const res = await app.request(`/api/sessions/claude/${SYNTHETIC_SESSION_ID}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ...session, recentMessages, parseWarnings: [] });
  });

  it("tool='gpt' は 400 で error.code が 'invalid_id'", async () => {
    const app = createApp(makeDeps());

    const res = await app.request(`/api/sessions/gpt/${SYNTHETIC_SESSION_ID}`);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_id");
  });

  it("id='not-a-uuid' は 400 で error.code が 'invalid_id'", async () => {
    const app = createApp(makeDeps());

    const res = await app.request("/api/sessions/claude/not-a-uuid");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_id");
  });

  it("大文字 UUID は小文字化した key で index.get / getSource が呼ばれ 200 になる", async () => {
    const session = makeSession({
      key: `claude:${SYNTHETIC_SESSION_ID}`,
      id: SYNTHETIC_SESSION_ID,
    });
    const { fn: readClaudeDetail } = makeFakeReadDetail(
      ok({ recentMessages: [], parseWarnings: [] }),
    );
    const app = createApp(
      makeDeps({
        index: makeFakeIndex({
          sessions: [session],
          sources: {
            [`claude:${SYNTHETIC_SESSION_ID}`]: { tool: "claude", jsonlPath: SYNTHETIC_JSONL_PATH },
          },
        }),
        readClaudeDetail,
      }),
    );

    const res = await app.request(`/api/sessions/claude/${SYNTHETIC_SESSION_ID.toUpperCase()}`);

    expect(res.status).toBe(200);
  });

  it("索引に無い id は 404 で error.code が 'not_found'、readClaudeDetail は呼ばれない", async () => {
    const { fn: readClaudeDetail, calls } = makeFakeReadDetail(
      ok({ recentMessages: [], parseWarnings: [] }),
    );
    const app = createApp(makeDeps({ index: makeFakeIndex({ sessions: [] }), readClaudeDetail }));

    const res = await app.request(`/api/sessions/claude/${SYNTHETIC_SESSION_ID}`);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(calls).toEqual([]);
  });

  it("getSource の jsonlPath がそのまま readClaudeDetail に渡る（パラメータから組み立てていない）", async () => {
    const session = makeSession({
      key: `claude:${SYNTHETIC_SESSION_ID}`,
      id: SYNTHETIC_SESSION_ID,
    });
    const { fn: readClaudeDetail, calls } = makeFakeReadDetail(
      ok({ recentMessages: [], parseWarnings: [] }),
    );
    const app = createApp(
      makeDeps({
        index: makeFakeIndex({
          sessions: [session],
          sources: {
            [`claude:${SYNTHETIC_SESSION_ID}`]: { tool: "claude", jsonlPath: SYNTHETIC_JSONL_PATH },
          },
        }),
        readClaudeDetail,
      }),
    );

    await app.request(`/api/sessions/claude/${SYNTHETIC_SESSION_ID}`);

    expect(calls).toEqual([SYNTHETIC_JSONL_PATH]);
  });

  it("codex の場合は readCodexDetail が呼ばれる（readClaudeDetail は呼ばれない）", async () => {
    const session = makeSession({
      key: `codex:${SYNTHETIC_SESSION_ID}`,
      id: SYNTHETIC_SESSION_ID,
      tool: "codex",
    });
    const { fn: readClaudeDetail, calls: claudeCalls } = makeFakeReadDetail(
      ok({ recentMessages: [], parseWarnings: [] }),
    );
    const { fn: readCodexDetail, calls: codexCalls } = makeFakeReadDetail(
      ok({ recentMessages: [], parseWarnings: [] }),
    );
    const app = createApp(
      makeDeps({
        index: makeFakeIndex({
          sessions: [session],
          sources: {
            [`codex:${SYNTHETIC_SESSION_ID}`]: { tool: "codex", jsonlPath: SYNTHETIC_JSONL_PATH },
          },
        }),
        readClaudeDetail,
        readCodexDetail,
      }),
    );

    const res = await app.request(`/api/sessions/codex/${SYNTHETIC_SESSION_ID}`);

    expect(res.status).toBe(200);
    expect(codexCalls).toEqual([SYNTHETIC_JSONL_PATH]);
    expect(claudeCalls).toEqual([]);
  });

  it("readClaudeDetail が err（実パスを含むメッセージ）を返すとき、500 で応答本文とログにそのパスが含まれない", async () => {
    const session = makeSession({
      key: `claude:${SYNTHETIC_SESSION_ID}`,
      id: SYNTHETIC_SESSION_ID,
    });
    const { fn: readClaudeDetail } = makeFakeReadDetail(
      err({
        code: "file_unreadable",
        message: `ファイルを読み取れませんでした: ${SYNTHETIC_JSONL_PATH}`,
        hint: "ファイルが存在し、読み取り権限があるか確認してください。",
      }),
    );
    const { lines, sink } = makeSinkCollector();
    const log = createLogger({ roots: [`${HOME_DIR}\\.claude`], homeDir: HOME_DIR, sink });
    const app = createApp(
      makeDeps({
        index: makeFakeIndex({
          sessions: [session],
          sources: {
            [`claude:${SYNTHETIC_SESSION_ID}`]: { tool: "claude", jsonlPath: SYNTHETIC_JSONL_PATH },
          },
        }),
        readClaudeDetail,
        log,
      }),
    );

    const res = await app.request(`/api/sessions/claude/${SYNTHETIC_SESSION_ID}`);

    expect(res.status).toBe(500);
    const body = await res.json();
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain(SYNTHETIC_JSONL_PATH);
    expect(lines.join("\n")).not.toContain(SYNTHETIC_JSONL_PATH);
  });

  it("Cache-Control: no-store が付く", async () => {
    const session = makeSession({
      key: `claude:${SYNTHETIC_SESSION_ID}`,
      id: SYNTHETIC_SESSION_ID,
    });
    const { fn: readClaudeDetail } = makeFakeReadDetail(
      ok({ recentMessages: [], parseWarnings: [] }),
    );
    const app = createApp(
      makeDeps({
        index: makeFakeIndex({
          sessions: [session],
          sources: {
            [`claude:${SYNTHETIC_SESSION_ID}`]: { tool: "claude", jsonlPath: SYNTHETIC_JSONL_PATH },
          },
        }),
        readClaudeDetail,
      }),
    );

    const res = await app.request(`/api/sessions/claude/${SYNTHETIC_SESSION_ID}`);

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/accounts", () => {
  it("フェイク index が 2 件返す場合、200 で accounts が同一内容になる", async () => {
    const accountA = makeAccount({ key: "claude:cli" });
    const accountB = makeAccount({ key: "codex:openai", tool: "codex", label: "Codex" });
    const app = createApp(makeDeps({ index: makeFakeIndex({ accounts: [accountA, accountB] }) }));

    const res = await app.request("/api/accounts");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toEqual([accountA, accountB]);
  });

  it("フェイク index が 0 件返す場合、accounts は空配列になる", async () => {
    const app = createApp(makeDeps({ index: makeFakeIndex({ accounts: [] }) }));

    const res = await app.request("/api/accounts");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toEqual([]);
  });
});

describe("GET /api/health", () => {
  it("ok: true, version が deps の値、warnings がフェイクの値になる", async () => {
    const app = createApp(
      makeDeps({ version: "1.2.3", index: makeFakeIndex({ warnings: ["警告A", "警告B"] }) }),
    );

    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe("1.2.3");
    expect(body.warnings).toEqual(["警告A", "警告B"]);
  });

  it("watcher は省略時 'poll' になる", async () => {
    const app = createApp(makeDeps());

    const res = await app.request("/api/health");
    const body = await res.json();

    expect(body.watcher).toBe("poll");
  });

  it("watcher は指定時その値になる（'fs'）", async () => {
    const app = createApp(makeDeps({ watcherMode: () => "fs" }));

    const res = await app.request("/api/health");
    const body = await res.json();

    expect(body.watcher).toBe("fs");
  });

  it("watcher は指定時その値になる（'both'）", async () => {
    const app = createApp(makeDeps({ watcherMode: () => "both" }));

    const res = await app.request("/api/health");
    const body = await res.json();

    expect(body.watcher).toBe("both");
  });

  it("processInfo は index.isProcessInfoAvailable() が true のとき true になる", async () => {
    const app = createApp(makeDeps({ index: makeFakeIndex({ processInfoAvailable: true }) }));

    const res = await app.request("/api/health");
    const body = await res.json();

    expect(body.processInfo).toBe(true);
  });

  it("processInfo は index.isProcessInfoAvailable() が false のとき false になる", async () => {
    const app = createApp(makeDeps({ index: makeFakeIndex({ processInfoAvailable: false }) }));

    const res = await app.request("/api/health");
    const body = await res.json();

    expect(body.processInfo).toBe(false);
  });

  describe("roots の ~ 置換", () => {
    it("homeDir 配下の root（`\\` 区切り）は先頭が `~` に置換される（実装は出力区切りを `/` に統一する）", async () => {
      const app = createApp(
        makeDeps({
          config: makeConfig({ roots: [`${HOME_DIR}\\.claude`] }),
          homeDir: HOME_DIR,
        }),
      );

      const res = await app.request("/api/health");
      const body = await res.json();

      expect(body.roots).toEqual(["~/.claude"]);
    });

    it("homeDir 配下の root（`/` 区切り）も置換される", async () => {
      const app = createApp(
        makeDeps({
          config: makeConfig({ roots: [`${HOME_DIR.replace(/\\/g, "/")}/.claude`] }),
          homeDir: HOME_DIR,
        }),
      );

      const res = await app.request("/api/health");
      const body = await res.json();

      expect(body.roots).toEqual(["~/.claude"]);
    });

    it("大文字小文字が違っても homeDir 配下と判定され、残りのセグメントは元の表記を保って置換される", async () => {
      const app = createApp(
        makeDeps({
          config: makeConfig({ roots: [`${HOME_DIR.toUpperCase()}\\.CLAUDE`] }),
          homeDir: HOME_DIR,
        }),
      );

      const res = await app.request("/api/health");
      const body = await res.json();

      expect(body.roots).toEqual(["~/.CLAUDE"]);
    });

    it("homeDir 外の root はそのまま返る", async () => {
      const outsideRoot = "D:\\shared\\.claude-external";
      const app = createApp(
        makeDeps({
          config: makeConfig({ roots: [outsideRoot] }),
          homeDir: HOME_DIR,
        }),
      );

      const res = await app.request("/api/health");
      const body = await res.json();

      expect(body.roots).toEqual([outsideRoot]);
    });
  });
});

describe("エラー形", () => {
  it("未定義の /api/nope は 404 で error.code が 'not_found'、message / hint が空でない", async () => {
    const app = createApp(makeDeps());

    const res = await app.request("/api/nope");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.hint.length).toBeGreaterThan(0);
  });

  it("フェイク index の getAll が throw すると 500 で error.code が 'internal'、hint が DEFAULT_ERROR_HINT、sink に throw したメッセージが含まれない", async () => {
    const { lines, sink } = makeSinkCollector();
    const log = createLogger({ roots: [`${HOME_DIR}\\.claude`], homeDir: HOME_DIR, sink });
    const app = createApp(makeDeps({ index: makeFakeIndex({ throwOnGetAll: true }), log }));

    const res = await app.request("/api/sessions");

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal");
    expect(body.error.hint).toBe("時間をおいて「更新」を押してください。");
    const joined = lines.join("\n");
    expect(joined).not.toContain("実際のセンシティブな例外メッセージ");
    expect(joined).not.toContain("secret.jsonl");
  });
});

describe("ヘッダ", () => {
  it("Cache-Control: no-store が 200 応答に付く", async () => {
    const app = createApp(makeDeps());

    const res = await app.request("/api/sessions");

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("Cache-Control: no-store が 404 応答に付く", async () => {
    const app = createApp(makeDeps());

    const res = await app.request("/api/nope");

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("Cache-Control: no-store が 500 応答に付く", async () => {
    const app = createApp(makeDeps({ index: makeFakeIndex({ throwOnGetAll: true }) }));

    const res = await app.request("/api/sessions");

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("CORS", () => {
  it("origin: http://localhost:5173 は access-control-allow-origin にエコーされる", async () => {
    const app = createApp(makeDeps());

    const res = await app.request("/api/sessions", {
      headers: { origin: "http://localhost:5173" },
    });

    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("origin: http://127.0.0.1:4317 は access-control-allow-origin にエコーされる", async () => {
    const app = createApp(makeDeps());

    const res = await app.request("/api/sessions", {
      headers: { origin: "http://127.0.0.1:4317" },
    });

    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4317");
  });

  it.each([
    ["http://localhost.evil.com"],
    ["https://localhost:5173"],
    ["http://evil.com"],
    ["http://localhost:5173/path"],
  ])("origin: %s はヘッダが付かない", async (origin) => {
    const app = createApp(makeDeps());

    const res = await app.request("/api/sessions", { headers: { origin } });

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("OPTIONS プリフライトは許可 origin で 204 系を返す", async () => {
    const app = createApp(makeDeps());

    const res = await app.request("/api/sessions", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
      },
    });

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});

// T-015 第 1 段階レビュー対応: AppDeps.hub / refresh の配線（createApp 経由での到達）。
// app.ts が /api/events, /api/refresh をまだマウントしていない場合、これらは 404 になる
// （実装側の配線待ち。その場合は「落ちた」と報告する）。
describe("GET /api/events / POST /api/refresh（createApp 経由）", () => {
  it("GET /api/events は 200 で content-type が text/event-stream を含む", async () => {
    const app = createApp(makeDeps());

    const controller = new AbortController();
    const res = await app.request("/api/events", { signal: controller.signal });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    await res.body?.getReader().cancel();
    controller.abort();
  });

  it("POST /api/refresh は refresh() の結果を反映して 200 で { ok: true, scanned, durationMs } を返す", async () => {
    const refresh = vi.fn(
      async (): Promise<RebuildResult> => ({ scanned: 9, durationMs: 5, warnings: [] }),
    );
    const app = createApp(makeDeps({ refresh }));

    const res = await app.request("/api/refresh", { method: "POST" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, scanned: 9, durationMs: 5 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
