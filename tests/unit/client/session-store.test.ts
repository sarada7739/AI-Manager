import { describe, expect, it, vi } from "vitest";
import type {
  AccountsResponse,
  ApiClient,
  ApiErrorBody,
  MessageResponse,
  RefreshResponse,
  SessionsResponse,
} from "../../../src/client/api/client";
import { createSessionStore } from "../../../src/client/store/useSessionStore";
import { DEFAULT_FILTERS, DEFAULT_SORT } from "../../../src/shared/grouping";
import { err, ok, type Result } from "../../../src/shared/result";
import type { Account, SessionSummary } from "../../../src/shared/types";

// T-019 受け入れ条件:
// 「store/useSessionStore.ts が ARCHITECTURE.md §6 の状態と load(), refresh(), setView, setGroupBy,
//   setFilter, setSort, select, setReadOnly を持つ。readOnly の既定は true」
// 「fetch 失敗時は status.error に ApiError を入れ、既存データは保持する」
// 実サーバ・実 fetch は使わない。フェイク api を注入する。合成データのみ。
//
// T-032 受け入れ条件（sendMessage、DESIGN.md §6.11 / ADR-0009）:
// 「readOnly が true では fetch を呼ばない」「sending → sent（message『投函しました』）→
//   setTimer の 10 秒後に idle」「失敗時 error で message に API の message と hint を含む」
// 「key の形式不正（claude: 以外 / codex: では成立するが id 不正時など）では error」

const NOW_ISO = "2026-01-01T00:00:00.000Z";

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    key: "claude:00000000-0000-4000-8000-000000000001",
    tool: "claude",
    id: "00000000-0000-4000-8000-000000000001",
    title: "合成タイトル",
    lastMessage: "合成メッセージ",
    lastRole: "assistant",
    cwd: "C:/synthetic/work",
    branch: "main",
    model: "synthetic-model",
    entrypoint: "cli",
    accountKey: "claude:cli",
    state: "idle",
    stateReason: "none",
    pid: null,
    startedAt: null,
    firstAt: NOW_ISO,
    updatedAt: NOW_ISO,
    logSizeBytes: 100,
    subagentCount: 0,
    released: false,
    ...overrides,
  };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    key: "claude:cli",
    label: "合成アカウント",
    tool: "claude",
    running: false,
    runningCount: 0,
    sessionCount: 0,
    startedAt: null,
    ...overrides,
  };
}

function apiError(code = "http_500"): ApiErrorBody {
  return { code, message: "エラーが発生しました。", hint: "更新してください。" };
}

/** テスト側で解決タイミングを制御できる Promise を作る（非 null アサーションを避けるための箱渡し）。 */
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  const box: { resolve?: (value: T) => void } = {};
  const promise = new Promise<T>((res) => {
    box.resolve = res;
  });
  return {
    promise,
    resolve: (value: T) => {
      box.resolve?.(value);
    },
  };
}

interface FakeApi {
  api: ApiClient;
  getSessions: ReturnType<typeof vi.fn>;
  getAccounts: ReturnType<typeof vi.fn>;
  postRefresh: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

/** 既定で全成功するフェイク ApiClient を作る。各関数は個別に mockResolvedValueOnce 等で上書きできる。 */
function makeFakeApi(): FakeApi {
  const getSessions = vi.fn(
    async (): Promise<Result<SessionsResponse, ApiErrorBody>> =>
      ok({ sessions: [], generatedAt: NOW_ISO }),
  );
  const getAccounts = vi.fn(
    async (): Promise<Result<AccountsResponse, ApiErrorBody>> => ok({ accounts: [] }),
  );
  const getSession = vi.fn();
  const getHealth = vi.fn();
  const postRefresh = vi.fn(
    async (): Promise<Result<RefreshResponse, ApiErrorBody>> =>
      ok({ ok: true, scanned: 0, durationMs: 0 }),
  );
  const postMessage = vi.fn(
    async (): Promise<Result<MessageResponse, ApiErrorBody>> =>
      ok({ ok: true, sentAt: NOW_ISO, note: "" }),
  );
  return {
    api: {
      getSessions,
      getAccounts,
      getSession,
      getHealth,
      postRefresh,
      postMessage,
    } as unknown as ApiClient,
    getSessions,
    getAccounts,
    postRefresh,
    postMessage,
  };
}

/** setTimer の呼び出しを記録し、手動で発火できるフェイクタイマーを作る。 */
function makeFakeTimer(): {
  setTimer: (callback: () => void, ms: number) => void;
  calls: Array<{ callback: () => void; ms: number }>;
  fireAll(): void;
} {
  const calls: Array<{ callback: () => void; ms: number }> = [];
  return {
    setTimer: (callback, ms) => {
      calls.push({ callback, ms });
    },
    calls,
    fireAll(): void {
      for (const call of calls) {
        call.callback();
      }
    },
  };
}

const RUNNING_CLAUDE_KEY = "claude:00000000-0000-4000-8000-000000000001";
const RUNNING_CLAUDE_ID = "00000000-0000-4000-8000-000000000001";

describe("createSessionStore: 既定値", () => {
  it("readOnly の既定値は true である", () => {
    const { api } = makeFakeApi();
    const store = createSessionStore({ api });
    expect(store.getState().readOnly).toBe(true);
  });

  it("view の既定値は board である", () => {
    const { api } = makeFakeApi();
    const store = createSessionStore({ api });
    expect(store.getState().view).toBe("board");
  });

  it("filters の既定値は DEFAULT_FILTERS と等しい", () => {
    const { api } = makeFakeApi();
    const store = createSessionStore({ api });
    expect(store.getState().filters).toEqual(DEFAULT_FILTERS);
  });

  it("groupBy / sort / selectedKey / status も既定値どおり", () => {
    const { api } = makeFakeApi();
    const store = createSessionStore({ api });
    const state = store.getState();
    expect(state.groupBy).toBe("account");
    expect(state.sort).toEqual(DEFAULT_SORT);
    expect(state.selectedKey).toBeNull();
    expect(state.status).toEqual({ loading: false, error: null, lastFetchedAt: null, live: false });
    expect(state.sessions).toEqual([]);
    expect(state.accounts).toEqual([]);
  });
});

describe("createSessionStore: load()", () => {
  it("成功時に sessions / accounts / lastFetchedAt（now 注入）を反映し error は null", async () => {
    const { api, getSessions, getAccounts } = makeFakeApi();
    const session = makeSession();
    const account = makeAccount();
    getSessions.mockResolvedValueOnce(ok({ sessions: [session], generatedAt: NOW_ISO }));
    getAccounts.mockResolvedValueOnce(ok({ accounts: [account] }));
    const fixedNow = new Date("2026-02-02T00:00:00.000Z");
    const store = createSessionStore({ api, now: () => fixedNow });

    await store.getState().load();

    const state = store.getState();
    expect(state.sessions).toEqual([session]);
    expect(state.accounts).toEqual([account]);
    expect(state.status.lastFetchedAt).toBe(fixedNow.toISOString());
    expect(state.status.error).toBeNull();
  });

  it("load 中は loading: true、終了後は false になる", async () => {
    const { api, getSessions } = makeFakeApi();
    const deferred = createDeferred<Result<SessionsResponse, ApiErrorBody>>();
    getSessions.mockReturnValueOnce(deferred.promise);
    const store = createSessionStore({ api });

    const loadPromise = store.getState().load();
    expect(store.getState().status.loading).toBe(true);

    deferred.resolve(ok({ sessions: [], generatedAt: NOW_ISO }));
    await loadPromise;

    expect(store.getState().status.loading).toBe(false);
  });

  it("sessions 失敗・accounts 成功なら既存データを保持し、error に sessions のエラーが入る", async () => {
    const { api, getSessions, getAccounts } = makeFakeApi();
    const existingSession = makeSession({ key: "claude:existing" });
    const existingAccount = makeAccount({ key: "claude:existing-account" });
    // 1 回目: 成功させて既存データを作る
    getSessions.mockResolvedValueOnce(ok({ sessions: [existingSession], generatedAt: NOW_ISO }));
    getAccounts.mockResolvedValueOnce(ok({ accounts: [existingAccount] }));
    const store = createSessionStore({ api });
    await store.getState().load();

    // 2 回目: sessions だけ失敗させる
    const sessionsError = apiError("network");
    getSessions.mockResolvedValueOnce(err(sessionsError));
    getAccounts.mockResolvedValueOnce(
      ok({ accounts: [makeAccount({ key: "claude:new-account" })] }),
    );
    await store.getState().load();

    const state = store.getState();
    expect(state.sessions).toEqual([existingSession]);
    expect(state.accounts).toEqual([existingAccount]);
    expect(state.status.error).toEqual(sessionsError);
  });

  it("同時に 2 回 load を呼んでも fetch は各 1 回だけ実行される", async () => {
    const { api, getSessions, getAccounts } = makeFakeApi();
    const store = createSessionStore({ api });

    const first = store.getState().load();
    const second = store.getState().load();
    await Promise.all([first, second]);

    expect(getSessions).toHaveBeenCalledTimes(1);
    expect(getAccounts).toHaveBeenCalledTimes(1);
  });

  it("load 失敗の後に成功すると status.error が null に戻る（レビュー反映の回帰確認）", async () => {
    const { api, getSessions } = makeFakeApi();
    const store = createSessionStore({ api });

    getSessions.mockResolvedValueOnce(err(apiError("network")));
    await store.getState().load();
    expect(store.getState().status.error).not.toBeNull();

    getSessions.mockResolvedValueOnce(ok({ sessions: [], generatedAt: NOW_ISO }));
    await store.getState().load();
    expect(store.getState().status.error).toBeNull();
  });
});

describe("createSessionStore: refresh()", () => {
  it("postRefresh → getSessions/getAccounts の順で呼ばれる", async () => {
    const { api, getSessions, getAccounts, postRefresh } = makeFakeApi();
    const store = createSessionStore({ api });

    await store.getState().refresh();

    const postRefreshOrder = postRefresh.mock.invocationCallOrder[0] ?? Number.NaN;
    const getSessionsOrder = getSessions.mock.invocationCallOrder[0] ?? Number.NaN;
    const getAccountsOrder = getAccounts.mock.invocationCallOrder[0] ?? Number.NaN;
    expect(Number.isNaN(postRefreshOrder)).toBe(false);
    expect(Number.isNaN(getSessionsOrder)).toBe(false);
    expect(Number.isNaN(getAccountsOrder)).toBe(false);
    expect(postRefreshOrder).toBeLessThan(getSessionsOrder);
    expect(postRefreshOrder).toBeLessThan(getAccountsOrder);
  });

  it('postRefresh の失敗は、その後の load が成功しても status.error に残る（code は "refresh_failed" に正規化される。新仕様）', async () => {
    const { api, postRefresh } = makeFakeApi();
    const refreshError = apiError("http_500");
    postRefresh.mockResolvedValueOnce(err(refreshError));
    const store = createSessionStore({ api });

    await store.getState().refresh();

    expect(store.getState().status.error).not.toBeNull();
    expect(store.getState().status.error?.code).toBe("refresh_failed");
  });

  it('postRefresh 失敗 + load 成功なら status.error.code が "refresh_failed" になる（新仕様）', async () => {
    const { api, postRefresh } = makeFakeApi();
    postRefresh.mockResolvedValueOnce(err(apiError("http_500")));
    const store = createSessionStore({ api });

    await store.getState().refresh();

    expect(store.getState().status.error?.code).toBe("refresh_failed");
  });

  it("postRefresh 失敗 + load 失敗なら load 側のエラーが status.error になる（load 優先、新仕様）", async () => {
    const { api, postRefresh, getSessions } = makeFakeApi();
    postRefresh.mockResolvedValueOnce(err(apiError("http_500")));
    const loadError = apiError("network");
    getSessions.mockResolvedValueOnce(err(loadError));
    const store = createSessionStore({ api });

    await store.getState().refresh();

    expect(store.getState().status.error).toEqual(loadError);
  });

  it("進行中の load がある状態で refresh を呼ぶと getSessions が合計 2 回呼ばれる（進行中 + 新規、新仕様）", async () => {
    const { api, getSessions } = makeFakeApi();
    const store = createSessionStore({ api });

    const deferred = createDeferred<Result<SessionsResponse, ApiErrorBody>>();
    getSessions.mockReturnValueOnce(deferred.promise);
    const firstLoad = store.getState().load();

    const refreshPromise = store.getState().refresh();

    deferred.resolve(ok({ sessions: [], generatedAt: NOW_ISO }));
    await firstLoad;
    await refreshPromise;

    expect(getSessions).toHaveBeenCalledTimes(2);
  });
});

describe("createSessionStore: setter 群", () => {
  it("setView が view を更新する", () => {
    const { api } = makeFakeApi();
    const store = createSessionStore({ api });
    store.getState().setView("list");
    expect(store.getState().view).toBe("list");
  });

  it("setGroupBy が groupBy を更新する", () => {
    const { api } = makeFakeApi();
    const store = createSessionStore({ api });
    store.getState().setGroupBy("folder");
    expect(store.getState().groupBy).toBe("folder");
  });

  it("setFilter は既存 filters に patch をマージする", () => {
    const { api } = makeFakeApi();
    const store = createSessionStore({ api });
    store.getState().setFilter({ tool: "codex" });
    expect(store.getState().filters).toEqual({ ...DEFAULT_FILTERS, tool: "codex" });
    store.getState().setFilter({ query: "abc" });
    expect(store.getState().filters).toEqual({ ...DEFAULT_FILTERS, tool: "codex", query: "abc" });
  });

  it("setSort が sort を更新する", () => {
    const { api } = makeFakeApi();
    const store = createSessionStore({ api });
    store.getState().setSort({ key: "title", dir: "asc" });
    expect(store.getState().sort).toEqual({ key: "title", dir: "asc" });
  });

  it("select が selectedKey を更新する", () => {
    const { api } = makeFakeApi();
    const store = createSessionStore({ api });
    store.getState().select("claude:00000000-0000-4000-8000-000000000001");
    expect(store.getState().selectedKey).toBe("claude:00000000-0000-4000-8000-000000000001");
  });

  it("select(null) で選択を解除できる", () => {
    const { api } = makeFakeApi();
    const store = createSessionStore({ api });
    store.getState().select("some-key");
    store.getState().select(null);
    expect(store.getState().selectedKey).toBeNull();
  });

  it("setReadOnly が readOnly を更新する", () => {
    const { api } = makeFakeApi();
    const store = createSessionStore({ api });
    store.getState().setReadOnly(false);
    expect(store.getState().readOnly).toBe(false);
  });

  it("setLive が status.live を更新する", () => {
    const { api } = makeFakeApi();
    const store = createSessionStore({ api });
    store.getState().setLive(true);
    expect(store.getState().status.live).toBe(true);
  });

  it("resetFilters が filters を DEFAULT_FILTERS に戻す", () => {
    const { api } = makeFakeApi();
    const store = createSessionStore({ api });
    store.getState().setFilter({ tool: "codex", query: "abc" });
    store.getState().resetFilters();
    expect(store.getState().filters).toEqual(DEFAULT_FILTERS);
  });
});

describe("createSessionStore: sendMessage（T-032 / ADR-0009）", () => {
  it("readOnly が true のとき fetch（postMessage）を呼ばない", async () => {
    const { api, postMessage } = makeFakeApi();
    const { setTimer } = makeFakeTimer();
    const store = createSessionStore({ api, setTimer });
    expect(store.getState().readOnly).toBe(true);

    await store.getState().sendMessage(RUNNING_CLAUDE_KEY, "本文");

    expect(postMessage).not.toHaveBeenCalled();
    expect(store.getState().send.state).toBe("idle");
  });

  it("readOnly が false で成功時、sending を経て sent（message『投函しました』）になる", async () => {
    const { api, postMessage } = makeFakeApi();
    const deferred = (() => {
      const box: { resolve?: (value: Result<MessageResponse, ApiErrorBody>) => void } = {};
      const promise = new Promise<Result<MessageResponse, ApiErrorBody>>((res) => {
        box.resolve = res;
      });
      return {
        promise,
        resolve: (value: Result<MessageResponse, ApiErrorBody>) => box.resolve?.(value),
      };
    })();
    postMessage.mockReturnValueOnce(deferred.promise);
    const { setTimer } = makeFakeTimer();
    const store = createSessionStore({
      api,
      setTimer,
      now: () => new Date("2026-03-01T00:00:00.000Z"),
    });
    store.getState().setReadOnly(false);

    const sendPromise = store.getState().sendMessage(RUNNING_CLAUDE_KEY, "本文");
    expect(store.getState().send.state).toBe("sending");

    deferred.resolve(ok({ ok: true, sentAt: NOW_ISO, note: "" }));
    await sendPromise;

    expect(postMessage).toHaveBeenCalledWith("claude", RUNNING_CLAUDE_ID, "本文");
    expect(store.getState().send.state).toBe("sent");
    expect(store.getState().send.message).toBe("投函しました");
    expect(store.getState().send.at).toBe(new Date("2026-03-01T00:00:00.000Z").getTime());
  });

  it("成功後、setTimer に登録されたコールバックを 10 秒後として発火すると send が idle に戻る", async () => {
    const { api } = makeFakeApi();
    const timer = makeFakeTimer();
    const store = createSessionStore({ api, setTimer: timer.setTimer });
    store.getState().setReadOnly(false);

    await store.getState().sendMessage(RUNNING_CLAUDE_KEY, "本文");
    expect(store.getState().send.state).toBe("sent");
    expect(timer.calls).toHaveLength(1);
    expect(timer.calls[0]?.ms).toBe(10_000);

    timer.fireAll();

    expect(store.getState().send).toEqual({ state: "idle", message: "", at: null });
  });

  it("失敗時は error になり、message に API の message と hint を含む", async () => {
    const { api, postMessage } = makeFakeApi();
    postMessage.mockResolvedValueOnce(
      err({
        code: "http_500",
        message: "送信に失敗しました。",
        hint: "時間をおいて再試行してください。",
      }),
    );
    const timer = makeFakeTimer();
    const store = createSessionStore({ api, setTimer: timer.setTimer });
    store.getState().setReadOnly(false);

    await store.getState().sendMessage(RUNNING_CLAUDE_KEY, "本文");

    expect(store.getState().send.state).toBe("error");
    expect(store.getState().send.message).toContain("送信に失敗しました。");
    expect(store.getState().send.message).toContain("時間をおいて再試行してください。");
  });

  it("失敗時も setTimer 経由で 10 秒後に idle に戻る", async () => {
    const { api, postMessage } = makeFakeApi();
    postMessage.mockResolvedValueOnce(
      err({ code: "http_500", message: "失敗しました。", hint: "再試行してください。" }),
    );
    const timer = makeFakeTimer();
    const store = createSessionStore({ api, setTimer: timer.setTimer });
    store.getState().setReadOnly(false);

    await store.getState().sendMessage(RUNNING_CLAUDE_KEY, "本文");
    expect(store.getState().send.state).toBe("error");

    timer.fireAll();

    expect(store.getState().send.state).toBe("idle");
  });

  it("key にコロンが無い（形式不正）のとき、送信前提の受け入れ条件どおり send.state が error になることを検証する", async () => {
    const { api, postMessage } = makeFakeApi();
    const timer = makeFakeTimer();
    const store = createSessionStore({ api, setTimer: timer.setTimer });
    store.getState().setReadOnly(false);

    await store.getState().sendMessage("not-a-valid-key", "本文");

    expect(postMessage).not.toHaveBeenCalled();
    expect(store.getState().send.state).toBe("error");
  });

  it("key の tool が claude/codex 以外（形式不正）のとき、受け入れ条件どおり send.state が error になることを検証する", async () => {
    const { api, postMessage } = makeFakeApi();
    const timer = makeFakeTimer();
    const store = createSessionStore({ api, setTimer: timer.setTimer });
    store.getState().setReadOnly(false);

    await store.getState().sendMessage("openai:00000000-0000-4000-8000-000000000001", "本文");

    expect(postMessage).not.toHaveBeenCalled();
    expect(store.getState().send.state).toBe("error");
  });

  it("key が codex: 形式のとき、messaging は claude 専用のため受け入れ条件どおり send.state が error になることを検証する", async () => {
    const { api, postMessage } = makeFakeApi();
    const timer = makeFakeTimer();
    const store = createSessionStore({ api, setTimer: timer.setTimer });
    store.getState().setReadOnly(false);

    await store.getState().sendMessage("codex:00000000-0000-4000-8000-000000000009", "本文");

    expect(postMessage).not.toHaveBeenCalled();
    expect(store.getState().send.state).toBe("error");
  });
});
