// T-025 受け入れ条件（useAutoRefresh）:
// 「/api/events を購読し sessions-changed で再取得。SSE が切れたら 10 秒ごとのポーリングに
//   フォールバックし、ヘッダ帯右端に『更新中』/『自動更新: 接続 / ポーリング』を表示」
//
// useAutoRefresh は options.createEventSource / options.intervalMs 以外は差し替えできない
// （load / setLive は既定インスタンス useSessionStore に固定で依存する）。そのため:
// - EventSource はフェイククラス（addEventListener / 静的インスタンス一覧 / close）を注入する
// - load() が実際に何をしたかは apiClient.getSessions / getAccounts を vi.spyOn して回数で検証する
//   （store の内部実装をモックせず、外部から観測できる副作用で確認する）
// - status.live はストアの実際の状態を直接読んで検証する
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../../../../src/client/api/client.js";
import {
  HEARTBEAT_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  useAutoRefresh,
} from "../../../../../src/client/features/refresh/useAutoRefresh.js";
import { useSessionStore } from "../../../../../src/client/store/useSessionStore.js";
import { DEFAULT_FILTERS, DEFAULT_SORT } from "../../../../../src/shared/grouping.js";
import { ok } from "../../../../../src/shared/result.js";

const NOW_ISO = "2026-01-01T00:00:00.000Z";

/** addEventListener / 静的インスタンス一覧 / close を持つフェイク EventSource。 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    // 実際の EventSource は close() 後にイベントを発火しない。フェイクでもその挙動を再現し、
    // 「アンマウント後に発火しても状態が変わらない」ことの検査を意味あるものにする。
    if (this.closed) {
      return;
    }
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }

  close(): void {
    this.closed = true;
  }
}

function createEventSourceFactory(): (url: string) => EventSource {
  return (url: string) => new FakeEventSource(url) as unknown as EventSource;
}

/** 既定インスタンス useSessionStore を初期状態に戻す（他テストからの汚染を防ぐ）。 */
function resetStore(): void {
  useSessionStore.setState({
    sessions: [],
    accounts: [],
    view: "board",
    groupBy: "account",
    filters: DEFAULT_FILTERS,
    sort: DEFAULT_SORT,
    readOnly: true,
    selectedKey: null,
    status: { loading: false, error: null, lastFetchedAt: null, live: false },
  });
}

/** apiClient.getSessions / getAccounts を即時成功で差し替える。load() の呼び出し回数の観測に使う。 */
function stubApi(): { getSessionsSpy: ReturnType<typeof vi.spyOn> } {
  const getSessionsSpy = vi
    .spyOn(apiClient, "getSessions")
    .mockResolvedValue(ok({ sessions: [], generatedAt: NOW_ISO }));
  vi.spyOn(apiClient, "getAccounts").mockResolvedValue(ok({ accounts: [] }));
  return { getSessionsSpy };
}

beforeEach(() => {
  resetStore();
  FakeEventSource.instances = [];
});

afterEach(() => {
  cleanup();
  resetStore();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useAutoRefresh", () => {
  it("open で status.live が true になり、以後ポーリングは行われない", async () => {
    vi.useFakeTimers();
    const { getSessionsSpy } = stubApi();

    renderHook(() =>
      useAutoRefresh({ createEventSource: createEventSourceFactory(), intervalMs: 1_000 }),
    );
    const [es] = FakeEventSource.instances;

    await act(async () => {
      es?.dispatch("open");
    });
    expect(useSessionStore.getState().status.live).toBe(true);

    getSessionsSpy.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(getSessionsSpy).not.toHaveBeenCalled();
  });

  it("sessions-changed イベントで load が呼ばれる（getSessions が 1 回呼ばれる）", async () => {
    const { getSessionsSpy } = stubApi();

    renderHook(() => useAutoRefresh({ createEventSource: createEventSourceFactory() }));
    const [es] = FakeEventSource.instances;

    await act(async () => {
      es?.dispatch("sessions-changed");
    });

    expect(getSessionsSpy).toHaveBeenCalledTimes(1);
  });

  it("error で live が false になり、intervalMs ごとに load される（フォールバックポーリング）", async () => {
    vi.useFakeTimers();
    const { getSessionsSpy } = stubApi();

    renderHook(() =>
      useAutoRefresh({ createEventSource: createEventSourceFactory(), intervalMs: 2_000 }),
    );
    const [es] = FakeEventSource.instances;

    await act(async () => {
      es?.dispatch("error");
    });
    expect(useSessionStore.getState().status.live).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(getSessionsSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(getSessionsSpy).toHaveBeenCalledTimes(2);
  });

  it("再度 open するとポーリングが止まる", async () => {
    vi.useFakeTimers();
    const { getSessionsSpy } = stubApi();

    renderHook(() =>
      useAutoRefresh({ createEventSource: createEventSourceFactory(), intervalMs: 1_000 }),
    );
    const [es] = FakeEventSource.instances;

    await act(async () => {
      es?.dispatch("error");
    });
    getSessionsSpy.mockClear();

    await act(async () => {
      es?.dispatch("open");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(getSessionsSpy).not.toHaveBeenCalled();
    expect(useSessionStore.getState().status.live).toBe(true);
  });

  it(`heartbeat が ${HEARTBEAT_TIMEOUT_MS}ms 来ないと live が false になりポーリングが始まる`, async () => {
    vi.useFakeTimers();
    const { getSessionsSpy } = stubApi();

    renderHook(() => useAutoRefresh({ createEventSource: createEventSourceFactory() }));
    const [es] = FakeEventSource.instances;

    await act(async () => {
      es?.dispatch("open");
    });
    expect(useSessionStore.getState().status.live).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_TIMEOUT_MS);
    });
    expect(useSessionStore.getState().status.live).toBe(false);

    getSessionsSpy.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(getSessionsSpy).toHaveBeenCalledTimes(1);
  });

  it("heartbeat イベントでタイムアウトがリセットされ、60 秒経っても live のまま", async () => {
    vi.useFakeTimers();
    stubApi();

    renderHook(() => useAutoRefresh({ createEventSource: createEventSourceFactory() }));
    const [es] = FakeEventSource.instances;

    await act(async () => {
      es?.dispatch("open");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_TIMEOUT_MS - 1_000);
    });
    await act(async () => {
      es?.dispatch("heartbeat");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_TIMEOUT_MS - 1_000);
    });

    expect(useSessionStore.getState().status.live).toBe(true);
  });

  it("アンマウントで EventSource.close が呼ばれ、以後タイマーで load されない", async () => {
    vi.useFakeTimers();
    const { getSessionsSpy } = stubApi();

    const { unmount } = renderHook(() =>
      useAutoRefresh({ createEventSource: createEventSourceFactory(), intervalMs: 1_000 }),
    );
    const [es] = FakeEventSource.instances;

    await act(async () => {
      es?.dispatch("error");
    });

    unmount();
    expect(es?.closed).toBe(true);

    getSessionsSpy.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(getSessionsSpy).not.toHaveBeenCalled();
  });

  it("EventSource が未定義の環境ではポーリングのみで動作する（live は false のまま、intervalMs ごとに load）", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", undefined);
    const { getSessionsSpy } = stubApi();

    renderHook(() => useAutoRefresh({ intervalMs: 3_000 }));

    expect(useSessionStore.getState().status.live).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(0);

    getSessionsSpy.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(getSessionsSpy).toHaveBeenCalledTimes(1);
  });

  it("createEventSource が購読 URL '/api/events' で呼ばれる", () => {
    stubApi();
    const factory = vi.fn((url: string) => new FakeEventSource(url) as unknown as EventSource);

    renderHook(() => useAutoRefresh({ createEventSource: factory }));

    expect(factory).toHaveBeenCalledWith("/api/events");
  });

  it("アンマウント後に EventSource がイベントを発火しても status.live は変わらない", async () => {
    vi.useFakeTimers();
    stubApi();

    const { unmount } = renderHook(() =>
      useAutoRefresh({ createEventSource: createEventSourceFactory() }),
    );
    const [es] = FakeEventSource.instances;

    await act(async () => {
      es?.dispatch("open");
    });
    expect(useSessionStore.getState().status.live).toBe(true);

    unmount();
    const liveAtUnmount = useSessionStore.getState().status.live;

    // close() 済みの実際の EventSource は以後イベントを発火しない
    // （フェイクの dispatch も closed なら no-op になるようにしてある）。
    es?.dispatch("error");

    expect(useSessionStore.getState().status.live).toBe(liveAtUnmount);
  });

  it("HEARTBEAT_TIMEOUT_MS は 60_000（60 秒）である", () => {
    expect(HEARTBEAT_TIMEOUT_MS).toBe(60_000);
  });

  // レビュー指摘（BLOCKING）: error 時に setLive(false) + startPolling() するだけでなく、
  // 前回の open/heartbeat で仕込んだ heartbeat タイムアウトの setTimeout も解除しないと、
  // ポーリング用の setInterval と heartbeat 用の setTimeout が二重に走り続けてしまう。
  it("error の後は heartbeat の setTimeout が残らず、ポーリングの setInterval だけが残る", async () => {
    vi.useFakeTimers();
    stubApi();

    renderHook(() =>
      useAutoRefresh({ createEventSource: createEventSourceFactory(), intervalMs: 5_000 }),
    );
    const [es] = FakeEventSource.instances;

    await act(async () => {
      es?.dispatch("open"); // heartbeat 用の setTimeout が 1 つ仕込まれる
    });
    await act(async () => {
      es?.dispatch("error"); // ポーリング用の setInterval が 1 つ始まる。heartbeat の setTimeout は解除されるべき
    });

    expect(vi.getTimerCount()).toBe(1);
  });
});
