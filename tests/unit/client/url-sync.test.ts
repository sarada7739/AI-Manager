import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../src/client/api/client";
import {
  buildSearch,
  parseUrlState,
  startUrlSync,
  type UrlState,
} from "../../../src/client/store/url-sync";
import { createSessionStore } from "../../../src/client/store/useSessionStore";
import { DEFAULT_FILTERS } from "../../../src/shared/grouping";

// T-019 受け入れ条件:
// 「store/url-sync.ts が view, groupBy, filters を URL クエリと双方向同期する
//   （初期化時に URL → ストア、変更時にストア → history.replaceState）」を検証する。
// React を使わず、window を差し替えて（jsdom も使わず）ロジックだけを検証する。

const DEFAULTS: UrlState = {
  view: "board",
  groupBy: "account",
  filters: DEFAULT_FILTERS,
};

/** api を呼ばないダミー ApiClient（url-sync は api を呼ばない）。 */
function makeUnusedApi(): ApiClient {
  const notCalled = () => {
    throw new Error("url-sync はテスト内で api を呼び出さない前提");
  };
  return {
    getSessions: notCalled,
    getAccounts: notCalled,
    getSession: notCalled,
    getHealth: notCalled,
    postRefresh: notCalled,
  } as unknown as ApiClient;
}

describe("parseUrlState", () => {
  it("全項目が指定されたクエリを正しく解釈する", () => {
    const result = parseUrlState(
      "?view=list&groupBy=state&tool=codex&account=a1&folder=C%3A%2Fx&since=7&running=1&q=hello",
      DEFAULTS,
    );
    expect(result).toEqual({
      view: "list",
      groupBy: "state",
      filters: {
        tool: "codex",
        accountKey: "a1",
        folder: "C:/x",
        sinceDays: 7,
        runningOnly: true,
        query: "hello",
      },
    });
  });

  it("view=grid のような不正な view は defaults.view にフォールバックする", () => {
    const result = parseUrlState("?view=grid", DEFAULTS);
    expect(result.view).toBe(DEFAULTS.view);
  });

  it("since=-1 は defaults.sinceDays にフォールバックする", () => {
    const result = parseUrlState("?since=-1", DEFAULTS);
    expect(result.filters.sinceDays).toBe(DEFAULTS.filters.sinceDays);
  });

  it("since=abc（非数値）は defaults.sinceDays にフォールバックする", () => {
    const result = parseUrlState("?since=abc", DEFAULTS);
    expect(result.filters.sinceDays).toBe(DEFAULTS.filters.sinceDays);
  });

  it("tool=gpt のような不正な tool は defaults.filters.tool にフォールバックする", () => {
    const result = parseUrlState("?tool=gpt", DEFAULTS);
    expect(result.filters.tool).toBe(DEFAULTS.filters.tool);
  });

  it("folder= （空文字）は null（絞り込みなし）になる", () => {
    const result = parseUrlState("?folder=", DEFAULTS);
    expect(result.filters.folder).toBeNull();
  });

  it("account= （空文字）は null（絞り込みなし）になる", () => {
    const result = parseUrlState("?account=", DEFAULTS);
    expect(result.filters.accountKey).toBeNull();
  });

  it("since=all は null（すべて）になる", () => {
    const result = parseUrlState("?since=all", DEFAULTS);
    expect(result.filters.sinceDays).toBeNull();
  });

  it("クエリが空なら defaults がそのまま返る", () => {
    const result = parseUrlState("", DEFAULTS);
    expect(result).toEqual(DEFAULTS);
  });

  it("running=1 は true になる（レビュー反映: 明示的な 0/1 表現）", () => {
    const result = parseUrlState("?running=1", DEFAULTS);
    expect(result.filters.runningOnly).toBe(true);
  });

  it("running=0 は defaults に関わらず false になる（レビュー反映: 明示的な 0/1 表現）", () => {
    const defaultsRunningTrue: UrlState = {
      ...DEFAULTS,
      filters: { ...DEFAULTS.filters, runningOnly: true },
    };
    const result = parseUrlState("?running=0", defaultsRunningTrue);
    expect(result.filters.runningOnly).toBe(false);
  });
});

describe("buildSearch", () => {
  it("defaults と同じ値のキーは省略する", () => {
    const state: UrlState = {
      view: "list",
      groupBy: DEFAULTS.groupBy,
      filters: { ...DEFAULTS.filters, tool: "codex" },
    };
    const search = buildSearch(state, DEFAULTS);
    expect(search).toContain("view=list");
    expect(search).toContain("tool=codex");
    expect(search).not.toContain("groupBy=");
    expect(search).not.toContain("since=");
  });

  it("全項目が既定値なら空文字を返す", () => {
    expect(buildSearch(DEFAULTS, DEFAULTS)).toBe("");
  });

  it("folder / accountKey が null の絞り込み解除は明示的に空文字パラメータとして出る", () => {
    const defaultsWithFolder: UrlState = {
      ...DEFAULTS,
      filters: { ...DEFAULTS.filters, folder: "C:/x", accountKey: "a1" },
    };
    const state: UrlState = {
      ...DEFAULTS,
      filters: { ...DEFAULTS.filters, folder: null, accountKey: null },
    };
    const search = buildSearch(state, defaultsWithFolder);
    expect(search).toContain("folder=");
    expect(search).toContain("account=");
  });

  it("defaults.filters.runningOnly が true のとき、runningOnly: false は running=0 として出力され往復する（レビュー反映）", () => {
    const defaultsRunningTrue: UrlState = {
      ...DEFAULTS,
      filters: { ...DEFAULTS.filters, runningOnly: true },
    };
    const state: UrlState = {
      ...defaultsRunningTrue,
      filters: { ...defaultsRunningTrue.filters, runningOnly: false },
    };
    const search = buildSearch(state, defaultsRunningTrue);
    expect(search).toContain("running=0");
    const roundTripped = parseUrlState(search, defaultsRunningTrue);
    expect(roundTripped.filters.runningOnly).toBe(false);
  });

  it("runningOnly: true は running=1 として出力される", () => {
    const state: UrlState = { ...DEFAULTS, filters: { ...DEFAULTS.filters, runningOnly: true } };
    const search = buildSearch(state, DEFAULTS);
    expect(search).toContain("running=1");
  });
});

describe("parseUrlState / buildSearch: 往復", () => {
  it("parse(build(x)) が x と等しくなる", () => {
    const x: UrlState = {
      view: "list",
      groupBy: "folder",
      filters: {
        tool: "claude",
        accountKey: "claude:cli",
        folder: "C:/synthetic/work",
        sinceDays: 30,
        runningOnly: true,
        query: "検索語",
      },
    };
    const search = buildSearch(x, DEFAULTS);
    const roundTripped = parseUrlState(search, DEFAULTS);
    expect(roundTripped).toEqual(x);
  });

  it("since: null（すべて）の往復も維持される", () => {
    const x: UrlState = {
      ...DEFAULTS,
      filters: { ...DEFAULTS.filters, sinceDays: null },
    };
    const search = buildSearch(x, DEFAULTS);
    const roundTripped = parseUrlState(search, DEFAULTS);
    expect(roundTripped.filters.sinceDays).toBeNull();
  });
});

/** フェイク window の型。startUrlSync が使う location / history の部分だけを持つ。 */
interface FakeWindow {
  location: { search: string; href: string; pathname: string; hash: string };
  history: { replaceState: (state: unknown, title: string, url: string | URL) => void };
}

/**
 * location.search を history.replaceState 呼び出しに応じて実際に書き換えるフェイク window を作る。
 * `hash` を持たせないと url-sync.ts の `${win.location.hash}` 連結が "undefined" という文字列に
 * なり、URL が同一かどうかの比較が常に不一致になってしまう（実 Window.location.hash は必ず string）。
 */
function makeFakeWindow(initialSearch: string): {
  win: FakeWindow;
  replaceState: ReturnType<
    typeof vi.fn<(state: unknown, title: string, url: string | URL) => void>
  >;
} {
  const location = {
    search: initialSearch,
    href: `http://localhost/${initialSearch}`,
    pathname: "/",
    hash: "",
  };
  const replaceState = vi.fn((_state: unknown, _title: string, url: string | URL) => {
    const parsed = new URL(url, "http://localhost");
    location.search = parsed.search;
    location.href = `http://localhost${parsed.pathname}${parsed.search}`;
  });
  return { win: { location, history: { replaceState } }, replaceState };
}

describe("startUrlSync", () => {
  it("初期化時に URL の内容がストアへ反映される", () => {
    const { win } = makeFakeWindow("?view=list&groupBy=folder&tool=codex&since=7");
    const store = createSessionStore({ api: makeUnusedApi() });

    startUrlSync(store, win as unknown as Window);

    const state = store.getState();
    expect(state.view).toBe("list");
    expect(state.groupBy).toBe("folder");
    expect(state.filters.tool).toBe("codex");
    expect(state.filters.sinceDays).toBe(7);
  });

  it("setView('list') で history.replaceState が ?view=list を含む URL で呼ばれる", () => {
    const { win, replaceState } = makeFakeWindow("");
    const store = createSessionStore({ api: makeUnusedApi() });
    startUrlSync(store, win as unknown as Window);

    store.getState().setView("list");

    expect(replaceState).toHaveBeenCalledTimes(1);
    const calledUrl = String(replaceState.mock.calls[0]?.[2] ?? "");
    expect(calledUrl).toContain("?view=list");
  });

  it("URL が変わらない状態変化では replaceState を呼ばない", () => {
    const { win, replaceState } = makeFakeWindow("");
    const store = createSessionStore({ api: makeUnusedApi() });
    startUrlSync(store, win as unknown as Window);

    store.getState().setView("list");
    expect(replaceState).toHaveBeenCalledTimes(1);

    // view/groupBy/filters に影響しない変更（selectedKey）は URL を変えないので呼ばれない
    store.getState().select("some-session-key");
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  it("購読解除後は replaceState が呼ばれない", () => {
    const { win, replaceState } = makeFakeWindow("");
    const store = createSessionStore({ api: makeUnusedApi() });
    const stop = startUrlSync(store, win as unknown as Window);

    stop();
    store.getState().setView("list");

    expect(replaceState).not.toHaveBeenCalled();
  });

  // レビュー BLOCKING の回帰テスト:
  // startUrlSync は「既定値」をストアの現在値ではなく固定の初期値定数から取らなければならない。
  // 現在値から取ると、2 回目の startUrlSync 呼び出し時点でストアが既に URL 由来の値
  // （view: "list", tool: "codex"）になっており、それを「既定値」と誤認する。結果、
  // 往復後に setView("list") しても「既定値と同じ」と判定されて URL から view=list が消えてしまう。
  it("startUrlSync を2回呼んでも、往復後に view/tool の指定が URL から消えない（BLOCKING 回帰）", () => {
    const { win, replaceState } = makeFakeWindow("?view=list&tool=codex");
    const store = createSessionStore({ api: makeUnusedApi() });

    const stop1 = startUrlSync(store, win as unknown as Window);
    stop1();

    // 2 回目の呼び出し時点で、ストアは既に view: "list" / filters.tool: "codex" になっている。
    // 既定値を「今のストアの値」から取る実装だとここで defaults が汚染される。
    startUrlSync(store, win as unknown as Window);

    store.getState().setView("board");
    store.getState().setView("list");

    expect(replaceState).toHaveBeenCalled();
    const lastCall = replaceState.mock.calls[replaceState.mock.calls.length - 1];
    const lastUrl = String(lastCall?.[2] ?? "");
    expect(lastUrl).toContain("view=list");
    expect(lastUrl).toContain("tool=codex");
  });
});
