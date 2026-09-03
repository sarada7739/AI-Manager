// T-031: POST /api/sessions/:tool/:id/message（送信 API, ADR-0009）の統合テスト。
// createApp(deps) にフェイクの index（getMessagingTarget を含む）と sendClaudeMessage を渡し、
// 実パイプ・実ファイルには一切触れずに検証順（分岐）を確認する。
// フィクスチャは合成データのみ。合成トークンは使わない（この経路はトークン自体を扱わない）。

import { describe, expect, it, vi } from "vitest";
import type { AppDeps } from "../../src/server/app";
import { createApp } from "../../src/server/app";
import type { AppConfig } from "../../src/server/config";
import { createLogger } from "../../src/server/log";
import type {
  MessagingTarget,
  SendMessageError,
  SendMessageSuccess,
} from "../../src/server/sources/claude/messaging";
import type { EventHub } from "../../src/server/store/events";
import { createEventHub } from "../../src/server/store/events";
import type { RebuildResult } from "../../src/server/store/index";
import type { Result } from "../../src/shared/result";
import { ok } from "../../src/shared/result";
import type { Account, SessionSummary, ToolKind } from "../../src/shared/types";

/** テストの見通しをよくするための型付きヘルパ。`err`/`ok` の E 型引数の明示だけを目的にする。 */
function sendOk(sentAt: string): Result<SendMessageSuccess, SendMessageError> {
  return { ok: true, value: { sentAt } };
}
function sendErr(
  code: SendMessageError["code"],
  message: string,
): Result<SendMessageSuccess, SendMessageError> {
  return { ok: false, error: { code, message } };
}

const HOME_DIR = "C:\\synthetic\\home";
const ID_RUNNING = "00000000-0000-4000-8000-000000000101";
const ID_NOT_RUNNING = "00000000-0000-4000-8000-000000000102";
const ID_UNKNOWN = "00000000-0000-4000-8000-000000000199";
const ID_OTHER_RUNNING = "00000000-0000-4000-8000-000000000103";

/** 未解決のまま返せる Promise を作る（同時送信・送信中の 429 を検証するため）。 */
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolveFn: (value: T) => void = () => {
    throw new Error("resolve が未初期化です");
  };
  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve;
  });
  return { promise, resolve: resolveFn };
}

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
    key: `claude:${ID_RUNNING}`,
    tool: "claude",
    id: ID_RUNNING,
    title: "合成セッション",
    lastMessage: "こんにちは",
    lastRole: "assistant",
    cwd: "C:\\synthetic\\project",
    branch: null,
    model: "claude-x",
    entrypoint: "cli",
    accountKey: "claude:cli",
    state: "running",
    stateReason: "process",
    pid: 4242,
    startedAt: "2026-01-01T00:00:00.000Z",
    firstAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    logSizeBytes: 100,
    subagentCount: 0,
    released: false,
    ...overrides,
  };
}

const TARGET: MessagingTarget = {
  root: `${HOME_DIR}\\.claude`,
  pid: 4242,
  socketPath: "\\\\.\\pipe\\LOCAL\\cc-msg-0123abcd",
};

const TARGET_OTHER: MessagingTarget = {
  root: `${HOME_DIR}\\.claude`,
  pid: 5555,
  socketPath: "\\\\.\\pipe\\LOCAL\\cc-msg-99999999",
};

/** フェイク index。`sessions` の key → SessionSummary、`targets` の key → MessagingTarget（あれば running とみなす）。 */
function makeFakeIndex(options?: {
  sessions?: SessionSummary[];
  targets?: Record<string, MessagingTarget>;
}): AppDeps["index"] {
  const sessions = options?.sessions ?? [];
  const targets = options?.targets ?? {};
  const byKey = new Map(sessions.map((session) => [session.key, session]));
  const accounts: Account[] = [];

  return {
    getAll: () => sessions,
    get: (key: string) => byKey.get(key),
    getSource: () => undefined,
    getAccounts: () => accounts,
    getWarnings: () => [],
    isProcessInfoAvailable: () => true,
    getMessagingTarget: (key: string) => targets[key],
  };
}

function makeSinkCollector(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

function makeDeps(
  overrides?: Partial<AppDeps> & { hub?: EventHub; refresh?: () => Promise<RebuildResult> },
): AppDeps {
  const { sink } = makeSinkCollector();
  const log = createLogger({ roots: [`${HOME_DIR}\\.claude`], homeDir: HOME_DIR, sink });
  const hub = overrides?.hub ?? createEventHub({ log });
  const refresh =
    overrides?.refresh ??
    vi.fn(async (): Promise<RebuildResult> => ({ scanned: 0, durationMs: 0, warnings: [] }));

  return {
    index: makeFakeIndex({
      sessions: [makeSession()],
      targets: { [`claude:${ID_RUNNING}`]: TARGET },
    }),
    config: makeConfig(),
    log,
    homeDir: HOME_DIR,
    version: "9.9.9",
    hub,
    refresh,
    readClaudeDetail: async () => ok({ recentMessages: [], parseWarnings: [] }),
    readCodexDetail: async () => ok({ recentMessages: [], parseWarnings: [] }),
    sendClaudeMessage: vi.fn(async () => sendOk("2026-01-01T00:00:00.000Z")),
    ...overrides,
  };
}

async function postMessage(
  app: ReturnType<typeof createApp>,
  tool: string,
  id: string,
  body: unknown,
) {
  return app.request(`/api/sessions/${tool}/${id}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/sessions/:tool/:id/message: 検証順の各分岐", () => {
  it("tool='codex' は 400 かつ error.code='unsupported_tool'（id 形式チェックより先）", async () => {
    const app = createApp(makeDeps());

    const res = await postMessage(app, "codex", "not-a-uuid-but-irrelevant", { text: "hi" });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unsupported_tool");
  });

  it("tool='claude' で id が UUID 形式でない場合は 400 かつ error.code='invalid_id'", async () => {
    const app = createApp(makeDeps());

    const res = await postMessage(app, "claude", "not-a-uuid", { text: "hi" });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_id");
  });

  it("tool='gpt'（claude でも codex でもない）は 400 かつ error.code='invalid_id'", async () => {
    const app = createApp(makeDeps());

    const res = await postMessage(app, "gpt", ID_RUNNING, { text: "hi" });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_id");
  });

  it("本文が JSON でない場合は 400 かつ error.code='invalid_body'", async () => {
    const app = createApp(makeDeps());

    const res = await postMessage(app, "claude", ID_RUNNING, "{ not valid json ,,,");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_body");
  });

  it("text フィールドが無い場合は 400 かつ error.code='invalid_body'", async () => {
    const app = createApp(makeDeps());

    const res = await postMessage(app, "claude", ID_RUNNING, { other: "field" });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_body");
  });

  it("text が文字列でない場合は 400 かつ error.code='invalid_body'", async () => {
    const app = createApp(makeDeps());

    const res = await postMessage(app, "claude", ID_RUNNING, { text: 12345 });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_body");
  });

  it("trim 後 0 文字（空白のみ）は 400 かつ error.code='invalid_text'（境界値）", async () => {
    const app = createApp(makeDeps());

    const res = await postMessage(app, "claude", ID_RUNNING, { text: "   " });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_text");
  });

  it("trim 後 1 文字はちょうど許容される（invalid_text にはならず、後続の索引チェックへ進む）", async () => {
    const app = createApp(makeDeps({ index: makeFakeIndex({ sessions: [] }) }));

    const res = await postMessage(app, "claude", ID_RUNNING, { text: " a " });

    const body = await res.json();
    // 索引に無いため 404 になる（invalid_text ではない = 1 文字は通ったことの確認）。
    expect(body.error.code).not.toBe("invalid_text");
    expect(res.status).toBe(404);
  });

  it("trim 後 4000 文字はちょうど許容される（境界値）", async () => {
    const app = createApp(makeDeps({ index: makeFakeIndex({ sessions: [] }) }));

    const res = await postMessage(app, "claude", ID_RUNNING, { text: "a".repeat(4000) });

    const body = await res.json();
    expect(body.error.code).not.toBe("invalid_text");
    expect(res.status).toBe(404);
  });

  it("trim 後 4001 文字は 400 かつ error.code='invalid_text'（境界値）", async () => {
    const app = createApp(makeDeps());

    const res = await postMessage(app, "claude", ID_RUNNING, { text: "a".repeat(4001) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_text");
  });

  it("前後の空白は trim され、trim 後の文字数で判定される（前後空白付きの 1 文字は通る）", async () => {
    const app = createApp(makeDeps({ index: makeFakeIndex({ sessions: [] }) }));

    const res = await postMessage(app, "claude", ID_RUNNING, { text: "  \n a \t " });

    const body = await res.json();
    expect(body.error.code).not.toBe("invalid_text");
    expect(res.status).toBe(404);
  });

  it("索引に無い ID は 404", async () => {
    const app = createApp(makeDeps({ index: makeFakeIndex({ sessions: [] }) }));

    const res = await postMessage(app, "claude", ID_UNKNOWN, { text: "hi" });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("索引にあるが稼働中でない（getMessagingTarget が undefined）場合は 409 かつ error.code='not_running'", async () => {
    const app = createApp(
      makeDeps({
        index: makeFakeIndex({
          sessions: [
            makeSession({ key: `claude:${ID_NOT_RUNNING}`, id: ID_NOT_RUNNING, state: "idle" }),
          ],
          targets: {},
        }),
      }),
    );

    const res = await postMessage(app, "claude", ID_NOT_RUNNING, { text: "hi" });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("not_running");
  });
});

describe("POST /api/sessions/:tool/:id/message: レート制限（10 秒）の境界", () => {
  it("同一セッションへ 9,999ms 後の再送は 429 かつ error.code='rate_limited'", async () => {
    let currentMs = Date.parse("2026-01-15T12:00:00.000Z");
    const now = () => new Date(currentMs);
    const app = createApp(makeDeps({ now }));

    const first = await postMessage(app, "claude", ID_RUNNING, { text: "1 回目" });
    expect(first.status).toBe(200);

    currentMs += 9_999;
    const second = await postMessage(app, "claude", ID_RUNNING, { text: "2 回目（別内容）" });

    expect(second.status).toBe(429);
    const body = await second.json();
    expect(body.error.code).toBe("rate_limited");
  });

  it("同一セッションへ 10,000ms 後の再送は通る（境界値ちょうど）", async () => {
    let currentMs = Date.parse("2026-01-15T12:00:00.000Z");
    const now = () => new Date(currentMs);
    const app = createApp(makeDeps({ now }));

    const first = await postMessage(app, "claude", ID_RUNNING, { text: "1 回目" });
    expect(first.status).toBe(200);

    currentMs += 10_000;
    const second = await postMessage(app, "claude", ID_RUNNING, { text: "2 回目（別内容）" });

    expect(second.status).toBe(200);
  });
});

describe("POST /api/sessions/:tool/:id/message: 同一本文の連投拒否（duplicate_text）", () => {
  it("直前と trim 後に完全一致する本文は 400 かつ error.code='duplicate_text'（レート制限は通過済みとする）", async () => {
    let currentMs = Date.parse("2026-01-15T12:00:00.000Z");
    const now = () => new Date(currentMs);
    const app = createApp(makeDeps({ now }));

    const first = await postMessage(app, "claude", ID_RUNNING, { text: "同じ内容" });
    expect(first.status).toBe(200);

    currentMs += 10_000; // レート制限は回避する
    const second = await postMessage(app, "claude", ID_RUNNING, { text: "同じ内容" });

    expect(second.status).toBe(400);
    const body = await second.json();
    expect(body.error.code).toBe("duplicate_text");
  });

  it("前後の空白だけが違う本文は trim 後に同一とみなされ duplicate_text になる", async () => {
    let currentMs = Date.parse("2026-01-15T12:00:00.000Z");
    const now = () => new Date(currentMs);
    const app = createApp(makeDeps({ now }));

    const first = await postMessage(app, "claude", ID_RUNNING, { text: "同じ内容" });
    expect(first.status).toBe(200);

    currentMs += 10_000;
    const second = await postMessage(app, "claude", ID_RUNNING, { text: "  同じ内容  " });

    expect(second.status).toBe(400);
    const body = await second.json();
    expect(body.error.code).toBe("duplicate_text");
  });

  it("1 文字だけ違う本文は duplicate_text にならず通る", async () => {
    let currentMs = Date.parse("2026-01-15T12:00:00.000Z");
    const now = () => new Date(currentMs);
    const app = createApp(makeDeps({ now }));

    const first = await postMessage(app, "claude", ID_RUNNING, { text: "内容A" });
    expect(first.status).toBe(200);

    currentMs += 10_000;
    const second = await postMessage(app, "claude", ID_RUNNING, { text: "内容B" });

    expect(second.status).toBe(200);
  });
});

describe("POST /api/sessions/:tool/:id/message: 送信失敗（502）と code ごとの hint", () => {
  const cases: SendMessageError["code"][] = [
    "key_not_found",
    "key_invalid",
    "pipe_unreachable",
    "send_failed",
  ];

  it.each(cases)(
    "sendClaudeMessage が %s を返すと 502 になり、error.code に同じ値が入る",
    async (code) => {
      const sendClaudeMessage = vi.fn(async () => sendErr(code, "送信失敗（テスト用フェイク）"));
      const app = createApp(makeDeps({ sendClaudeMessage }));

      const res = await postMessage(app, "claude", ID_RUNNING, { text: "本文" });

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error.code).toBe(code);
    },
  );

  it("502 の hint は失敗コードごとに異なる文言になる", async () => {
    async function hintFor(code: SendMessageError["code"]): Promise<string> {
      const sendClaudeMessage = vi.fn(async () => sendErr(code, "テスト用フェイク"));
      const app = createApp(makeDeps({ sendClaudeMessage }));
      const res = await postMessage(app, "claude", ID_RUNNING, { text: "本文" });
      const body = await res.json();
      return body.error.hint as string;
    }

    const hintKeyNotFound = await hintFor("key_not_found");
    const hintPipeUnreachable = await hintFor("pipe_unreachable");
    const hintSendFailed = await hintFor("send_failed");

    expect(hintKeyNotFound).not.toBe(hintPipeUnreachable);
    expect(hintPipeUnreachable).not.toBe(hintSendFailed);
    expect(hintKeyNotFound).not.toBe(hintSendFailed);
  });

  it("502 応答の message は固定文言で、送信失敗時の詳細（内部エラー文言）を含まない", async () => {
    const sendClaudeMessage = vi.fn(async () =>
      sendErr("send_failed", "実装内部の詳細メッセージ（漏れてはいけない）"),
    );
    const app = createApp(makeDeps({ sendClaudeMessage }));

    const res = await postMessage(app, "claude", ID_RUNNING, { text: "本文" });

    const body = await res.json();
    expect(body.error.message).not.toContain("実装内部の詳細メッセージ");
  });
});

describe("POST /api/sessions/:tool/:id/message: 成功時（200）", () => {
  it("成功時は 200 で { ok: true, sentAt, note } を返し、note に crossSessionInbound を含む", async () => {
    const sendClaudeMessage = vi.fn(async () => sendOk("2026-03-01T00:00:00.000Z"));
    const app = createApp(makeDeps({ sendClaudeMessage }));

    const res = await postMessage(app, "claude", ID_RUNNING, { text: "本文" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sentAt).toBe("2026-03-01T00:00:00.000Z");
    expect(body.note).toContain("crossSessionInbound");
  });

  it("sendClaudeMessage に渡される target は index.getMessagingTarget の戻り値そのもの、text は trim 済み", async () => {
    const sendClaudeMessage = vi.fn(async (_target: MessagingTarget, _text: string) =>
      sendOk("2026-03-01T00:00:00.000Z"),
    );
    const app = createApp(makeDeps({ sendClaudeMessage }));

    await postMessage(app, "claude", ID_RUNNING, { text: "  前後に空白のある本文  " });

    expect(sendClaudeMessage).toHaveBeenCalledTimes(1);
    const call = sendClaudeMessage.mock.calls[0];
    if (call === undefined) {
      throw new Error("sendClaudeMessage が呼ばれていません");
    }
    const [calledTarget, calledText] = call;
    expect(calledTarget).toEqual(TARGET);
    expect(calledText).toBe("前後に空白のある本文");
  });

  it("応答ヘッダに Cache-Control: no-store が付く", async () => {
    const app = createApp(makeDeps());

    const res = await postMessage(app, "claude", ID_RUNNING, { text: "本文" });

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("送信失敗（502）の応答にも Cache-Control: no-store が付く", async () => {
    const sendClaudeMessage = vi.fn(async () => sendErr("send_failed", "テスト用フェイク"));
    const app = createApp(makeDeps({ sendClaudeMessage }));

    const res = await postMessage(app, "claude", ID_RUNNING, { text: "本文" });

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
// 回帰: index がクラスインスタンス（メソッドが this に依存する）でも 500 にならない
// ---------------------------------------------------------------------------

/**
 * `SessionIndex` と同じく「クラスのメソッドがインスタンスの private フィールドに `this` で
 * アクセスする」形のフェイク。以前の `src/server/app.ts` は
 * `index: { get: deps.index.get, getMessagingTarget: deps.index.getMessagingTarget }` のように
 * メソッドだけを取り出してオブジェクトへ詰め替えて渡していたため、呼び出し時に `this` が失われ、
 * 実機で 500 になっていた（クロージャ関数だけのフェイク index ではこの不具合を検出できない）。
 * このクラスを使い、`createApp` に渡した index がオブジェクトごと（メソッドを取り出さずに）
 * ルートへ配線されていることを確認する。
 */
class ThisBoundIndex {
  private readonly sessionsByKey: Map<string, SessionSummary>;
  private readonly targetsByKey: Record<string, MessagingTarget>;

  constructor(sessions: SessionSummary[], targets: Record<string, MessagingTarget>) {
    this.sessionsByKey = new Map(sessions.map((session) => [session.key, session]));
    this.targetsByKey = targets;
  }

  getAll(): SessionSummary[] {
    return [...this.sessionsByKey.values()];
  }

  get(key: string): SessionSummary | undefined {
    return this.sessionsByKey.get(key);
  }

  getSource(key: string): { tool: ToolKind; jsonlPath: string } | undefined {
    const session = this.sessionsByKey.get(key);
    if (session === undefined) {
      return undefined;
    }
    return { tool: session.tool, jsonlPath: `C:\\synthetic\\${session.id}.jsonl` };
  }

  getAccounts(): Account[] {
    return [];
  }

  getWarnings(): string[] {
    return [];
  }

  isProcessInfoAvailable(): boolean {
    return true;
  }

  getMessagingTarget(key: string): MessagingTarget | undefined {
    // private フィールド（this.targetsByKey）へのアクセスなので、メソッドだけを取り出して
    // 呼ぶと（`{ getMessagingTarget: instance.getMessagingTarget }` のように）`this` が失われ、
    // ここで例外になる（実機で発生した 500 の原因そのもの）。
    return this.targetsByKey[key];
  }
}

describe("回帰: index がクラスインスタンス（this 依存）でも POST/GET が 500 にならない", () => {
  it("POST /api/sessions/claude/:id/message は 500 にならず 200 を返す（実機バグの回帰）", async () => {
    const index = new ThisBoundIndex([makeSession()], { [`claude:${ID_RUNNING}`]: TARGET });
    const app = createApp(makeDeps({ index }));

    const res = await postMessage(app, "claude", ID_RUNNING, { text: "本文" });

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("稼働中でないセッションでも 500 にならず 409 を返す（実機バグの回帰）", async () => {
    const index = new ThisBoundIndex(
      [makeSession({ key: `claude:${ID_NOT_RUNNING}`, id: ID_NOT_RUNNING, state: "idle" })],
      {},
    );
    const app = createApp(makeDeps({ index }));

    const res = await postMessage(app, "claude", ID_NOT_RUNNING, { text: "本文" });

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("not_running");
  });

  it("GET /api/sessions/:tool/:id も同じクラスインスタンスで 500 にならず 200 を返す（他 routes の同種バグの担保）", async () => {
    const index = new ThisBoundIndex([makeSession()], { [`claude:${ID_RUNNING}`]: TARGET });
    const app = createApp(makeDeps({ index }));

    const res = await app.request(`/api/sessions/claude/${ID_RUNNING}`);

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// reviewer Round 1 BLOCKING 修正の固定化: 同時送信・失敗時の記録・残り秒数・key の大文字小文字
// ---------------------------------------------------------------------------

describe("POST /api/sessions/:tool/:id/message: 同時送信は 1 本目だけ通り、2 本目は「送信中」の 429（reviewer Round 1 修正の固定化）", () => {
  it("1 本目が完了する前に 2 本目を送ると、1 本目は 200、2 本目は 429（hint に「送信中」）、sendClaudeMessage は 1 回だけ呼ばれる", async () => {
    const deferred = createDeferred<Result<SendMessageSuccess, SendMessageError>>();
    let calledResolve: () => void = () => {};
    const called = new Promise<void>((resolve) => {
      calledResolve = resolve;
    });
    const sendClaudeMessage = vi.fn(async () => {
      calledResolve();
      return deferred.promise;
    });
    const app = createApp(makeDeps({ sendClaudeMessage }));

    const firstPromise = postMessage(app, "claude", ID_RUNNING, { text: "1 本目" });
    // sendClaudeMessage が実際に呼ばれる（= inFlight が予約された）時点まで待つ。
    await called;

    const secondRes = await postMessage(app, "claude", ID_RUNNING, { text: "2 本目" });
    expect(secondRes.status).toBe(429);
    const secondBody = await secondRes.json();
    expect(secondBody.error.code).toBe("rate_limited");
    expect(secondBody.error.hint).toContain("送信中");

    deferred.resolve(sendOk("2026-01-01T00:00:00.000Z"));
    const firstRes = await firstPromise;
    expect(firstRes.status).toBe(200);

    expect(sendClaudeMessage).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/sessions/:tool/:id/message: 送信失敗でも記録は残る（reviewer Round 1 修正の固定化）", () => {
  it("送信失敗（502）の直後でも 10 秒の枠は残り（別本文は rate_limited）、10 秒経過後は同一本文でも送り直せる", async () => {
    let currentMs = Date.parse("2026-01-15T12:00:00.000Z");
    const now = () => new Date(currentMs);
    const sendClaudeMessage = vi.fn(async () => sendErr("send_failed", "テスト用フェイク"));
    const app = createApp(makeDeps({ now, sendClaudeMessage }));

    const first = await postMessage(app, "claude", ID_RUNNING, { text: "本文A" });
    expect(first.status).toBe(502);

    // 10 秒以内に別本文を送ると、失敗した直前の送信も直近送信として数えられ rate_limited になる。
    currentMs += 5_000;
    const withinWindowDifferentText = await postMessage(app, "claude", ID_RUNNING, {
      text: "本文B",
    });
    expect(withinWindowDifferentText.status).toBe(429);
    const withinBody = await withinWindowDifferentText.json();
    expect(withinBody.error.code).toBe("rate_limited");

    // 合計 10,000ms 経過後、失敗した本文（本文A）と同じ内容を送り直せる
    // （失敗した送信の本文は同一本文の拒否に使わない。502 の hint「もう一度送ってください」と
    // 挙動を一致させる。reviewer Round 2 BLOCKING の反映）。
    currentMs += 5_000;
    const sameTextAfterWindow = await postMessage(app, "claude", ID_RUNNING, { text: "本文A" });
    // このフェイクは常に失敗するので応答は再び 502 だが、duplicate_text で弾かれず送信処理まで到達する。
    expect(sameTextAfterWindow.status).toBe(502);
    const sameBody = await sameTextAfterWindow.json();
    expect(sameBody.error.code).toBe("send_failed");
    expect(sendClaudeMessage).toHaveBeenCalledTimes(2);
  });

  it("502 の hint は「もう一度送ってください」で、10 秒後に同じ本文を送り直すと実際に通る（文言と挙動の一致）", async () => {
    let currentMs = Date.parse("2026-01-15T12:00:00.000Z");
    const now = () => new Date(currentMs);
    const sendClaudeMessage = vi
      .fn<
        (
          target: MessagingTarget,
          text: string,
        ) => Promise<Result<SendMessageSuccess, SendMessageError>>
      >()
      .mockResolvedValueOnce(sendErr("send_failed", "テスト用フェイク"))
      .mockResolvedValueOnce(sendOk("2026-01-15T12:00:10.000Z"));
    const app = createApp(makeDeps({ now, sendClaudeMessage }));

    const failed = await postMessage(app, "claude", ID_RUNNING, { text: "同じ本文" });
    expect(failed.status).toBe(502);
    const failedBody = await failed.json();
    expect(failedBody.error.hint).toContain("もう一度送ってください");

    currentMs += 10_000;
    const retried = await postMessage(app, "claude", ID_RUNNING, { text: "同じ本文" });
    expect(retried.status).toBe(200);
    expect(sendClaudeMessage).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/sessions/:tool/:id/message: 429 の hint に残り秒数が入る（reviewer Round 1 修正の固定化）", () => {
  it("経過 3,000ms なら hint に「あと 7 秒」が入る", async () => {
    let currentMs = Date.parse("2026-01-15T12:00:00.000Z");
    const now = () => new Date(currentMs);
    const app = createApp(makeDeps({ now }));

    const first = await postMessage(app, "claude", ID_RUNNING, { text: "1 回目" });
    expect(first.status).toBe(200);

    currentMs += 3_000;
    const second = await postMessage(app, "claude", ID_RUNNING, { text: "2 回目" });

    expect(second.status).toBe(429);
    const body = await second.json();
    expect(body.error.hint).toContain("あと 7 秒");
  });
});

describe("POST /api/sessions/:tool/:id/message: pruneRateLimits による記録の掃除（保持期間 10 分）", () => {
  it("10 分経過した記録は掃除され、同一本文でも通る。10 秒経過しただけでは別セッションへの送信が挟まっても duplicate_text のまま", async () => {
    // 保持期間は key によらず一定（10 分）。同一本文の拒否が続く長さが、他セッションへの送信の
    // 有無に左右されないことを確認する（reviewer Round 2 NON_BLOCKING の反映）。
    let currentMs = Date.parse("2026-01-15T12:00:00.000Z");
    const now = () => new Date(currentMs);
    const index = makeFakeIndex({
      sessions: [
        makeSession(),
        makeSession({ key: `claude:${ID_OTHER_RUNNING}`, id: ID_OTHER_RUNNING }),
      ],
      targets: {
        [`claude:${ID_RUNNING}`]: TARGET,
        [`claude:${ID_OTHER_RUNNING}`]: TARGET_OTHER,
      },
    });
    const app = createApp(makeDeps({ now, index }));

    const first = await postMessage(app, "claude", ID_RUNNING, { text: "同じ内容" });
    expect(first.status).toBe(200);

    currentMs += 10_000; // 10 秒経過。レート枠は抜けるが、同一本文の記録はまだ保持される

    const otherRes = await postMessage(app, "claude", ID_OTHER_RUNNING, { text: "別セッション宛" });
    expect(otherRes.status).toBe(200);

    // 別セッションへの送信が挟まっても、ID_RUNNING の同一本文は保持期間内なので拒否される。
    const stillDuplicate = await postMessage(app, "claude", ID_RUNNING, { text: "同じ内容" });
    expect(stillDuplicate.status).toBe(400);
    expect((await stillDuplicate.json()).error.code).toBe("duplicate_text");

    currentMs += 10 * 60_000; // 保持期間（10 分）を超える

    // 記録は掃除され、同一本文でも通る。
    const second = await postMessage(app, "claude", ID_RUNNING, { text: "同じ内容" });
    expect(second.status).toBe(200);
  });

  it("（対照）10 秒経過しただけでは同一本文は duplicate_text のまま", async () => {
    let currentMs = Date.parse("2026-01-15T12:00:00.000Z");
    const now = () => new Date(currentMs);
    const app = createApp(makeDeps({ now }));

    const first = await postMessage(app, "claude", ID_RUNNING, { text: "同じ内容" });
    expect(first.status).toBe(200);

    currentMs += 10_000;
    const second = await postMessage(app, "claude", ID_RUNNING, { text: "同じ内容" });

    expect(second.status).toBe(400);
    const body = await second.json();
    expect(body.error.code).toBe("duplicate_text");
  });
});

describe("POST /api/sessions/:tool/:id/message: id の大文字小文字違いは同じレート枠として扱われる（reviewer Round 1 修正の固定化）", () => {
  it("大文字化した id への再送は、同じセッションへの再送として rate_limited になる", async () => {
    let currentMs = Date.parse("2026-01-15T12:00:00.000Z");
    const now = () => new Date(currentMs);
    const app = createApp(makeDeps({ now }));

    const first = await postMessage(app, "claude", ID_RUNNING, { text: "1 回目" });
    expect(first.status).toBe(200);

    currentMs += 1_000; // 10 秒以内
    const upperId = ID_RUNNING.toUpperCase();
    const second = await postMessage(app, "claude", upperId, { text: "2 回目（大文字 ID）" });

    expect(second.status).toBe(429);
    const body = await second.json();
    expect(body.error.code).toBe("rate_limited");
  });
});
