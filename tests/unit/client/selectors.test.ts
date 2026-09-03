import { describe, expect, it } from "vitest";
import type { ApiClient } from "../../../src/client/api/client";
import {
  selectCounts,
  selectFilteredSessions,
  selectFolderOptions,
  selectGroups,
  selectRunningClaudeSessions,
  selectSelectedSession,
  selectSortedSessions,
} from "../../../src/client/store/selectors";
import { createSessionStore } from "../../../src/client/store/useSessionStore";
import { applyFilters, DEFAULT_FILTERS } from "../../../src/shared/grouping";
import type { Account, SessionSummary } from "../../../src/shared/types";

// T-019 受け入れ条件:
// 「派生データ（絞り込み後・グループ後）はセレクタ関数として提供し、ストアに保存しない」を検証する。
// ストアは実 api を使わない（selectors はストアの状態だけを読む純粋関数のため、api は呼ばれない）。

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = 1_700_000_000_000;
const NOW_ISO = new Date(NOW_MS).toISOString();

function isoAtDaysAgo(days: number): string {
  return new Date(NOW_MS - days * DAY_MS).toISOString();
}

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    key: "claude:00000000-0000-4000-8000-000000000001",
    tool: "claude",
    id: "00000000-0000-4000-8000-000000000001",
    title: "合成タイトル",
    lastMessage: "合成メッセージ",
    lastRole: "assistant",
    cwd: "C:/synthetic/alpha",
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

/** api を呼ばないダミー ApiClient（selectors は状態のみ読むため未使用のはず）。 */
function makeUnusedApi(): ApiClient {
  const notCalled = () => {
    throw new Error("selectors はテスト内で api を呼び出さない前提");
  };
  return {
    getSessions: notCalled,
    getAccounts: notCalled,
    getSession: notCalled,
    getHealth: notCalled,
    postRefresh: notCalled,
  } as unknown as ApiClient;
}

const SESSIONS: SessionSummary[] = [
  makeSession({
    key: "a",
    tool: "claude",
    accountKey: "claude:cli",
    cwd: "C:/synthetic/alpha",
    state: "running",
    updatedAt: isoAtDaysAgo(1),
  }),
  makeSession({
    key: "b",
    tool: "codex",
    accountKey: "codex:cli",
    cwd: "C:/synthetic/beta",
    state: "idle",
    updatedAt: isoAtDaysAgo(5),
  }),
  makeSession({
    key: "c",
    tool: "claude",
    accountKey: "claude:cli",
    cwd: "C:/synthetic/alpha",
    state: "error",
    updatedAt: isoAtDaysAgo(20),
  }),
  makeSession({
    key: "d",
    tool: "codex",
    accountKey: "codex:cli",
    cwd: "C:/synthetic/gamma",
    state: "active",
    updatedAt: isoAtDaysAgo(2),
  }),
];

const ACCOUNTS: Account[] = [
  makeAccount({ key: "claude:cli", label: "Claude CLI" }),
  makeAccount({ key: "codex:cli", label: "Codex CLI" }),
];

describe("selectFilteredSessions", () => {
  it("applyFilters と同じ結果を返す（nowMs 固定）", () => {
    const store = createSessionStore({ api: makeUnusedApi() });
    store.setState({ sessions: SESSIONS, filters: { ...DEFAULT_FILTERS, sinceDays: 14 } });
    const state = store.getState();

    const expected = applyFilters(SESSIONS, state.filters, NOW_MS);
    expect(selectFilteredSessions(state, NOW_MS)).toEqual(expected);
  });

  it("nowMs を固定すると sinceDays の境界が動かない（15日前は落ちる）", () => {
    const store = createSessionStore({ api: makeUnusedApi() });
    store.setState({ sessions: SESSIONS, filters: { ...DEFAULT_FILTERS, sinceDays: 14 } });
    const result = selectFilteredSessions(store.getState(), NOW_MS);
    expect(result.map((s) => s.key)).not.toContain("c"); // 20日前
    expect(result.map((s) => s.key)).toEqual(expect.arrayContaining(["a", "d"]));
  });
});

describe("selectGroups", () => {
  it("groupBy に応じて列が変わる（tool 軸は claude/codex の固定 2 列）", () => {
    const store = createSessionStore({ api: makeUnusedApi() });
    store.setState({
      sessions: SESSIONS,
      accounts: ACCOUNTS,
      filters: { ...DEFAULT_FILTERS, sinceDays: null },
      groupBy: "tool",
    });
    const groups = selectGroups(store.getState(), NOW_MS);
    expect(groups.map((g) => g.key)).toEqual(["claude", "codex"]);
  });

  it("groupBy を account に変えると account 軸の列になる", () => {
    const store = createSessionStore({ api: makeUnusedApi() });
    store.setState({
      sessions: SESSIONS,
      accounts: ACCOUNTS,
      filters: { ...DEFAULT_FILTERS, sinceDays: null },
      groupBy: "account",
    });
    const groups = selectGroups(store.getState(), NOW_MS);
    expect(groups.map((g) => g.key)).toEqual(["claude:cli", "codex:cli"]);
  });
});

describe("selectSortedSessions", () => {
  it("sort（既定 updatedAt desc）で絞り込み後のセッションを並べ替える", () => {
    const store = createSessionStore({ api: makeUnusedApi() });
    store.setState({ sessions: SESSIONS, filters: { ...DEFAULT_FILTERS, sinceDays: null } });
    const result = selectSortedSessions(store.getState(), NOW_MS);
    expect(result.map((s) => s.key)).toEqual(["a", "d", "b", "c"]);
  });
});

describe("selectFolderOptions", () => {
  it("絞り込み前の全セッションから選択肢を作る", () => {
    const store = createSessionStore({ api: makeUnusedApi() });
    store.setState({ sessions: SESSIONS, filters: { ...DEFAULT_FILTERS, tool: "claude" } });
    const options = selectFolderOptions(store.getState());
    // tool: "claude" フィルタが効いていても folderOptions は sessions 全体（絞り込み前）から作る
    expect(options.map((o) => o.folder).sort()).toEqual([
      "C:/synthetic/alpha",
      "C:/synthetic/beta",
      "C:/synthetic/gamma",
    ]);
  });
});

describe("selectSelectedSession", () => {
  it("未選択（selectedKey: null）なら null", () => {
    const store = createSessionStore({ api: makeUnusedApi() });
    store.setState({ sessions: SESSIONS, selectedKey: null });
    expect(selectSelectedSession(store.getState())).toBeNull();
  });

  it("存在しない key を選択している場合も null", () => {
    const store = createSessionStore({ api: makeUnusedApi() });
    store.setState({ sessions: SESSIONS, selectedKey: "not-exist" });
    expect(selectSelectedSession(store.getState())).toBeNull();
  });

  it("存在する key を選択していれば該当セッションを返す", () => {
    const store = createSessionStore({ api: makeUnusedApi() });
    store.setState({ sessions: SESSIONS, selectedKey: "b" });
    expect(selectSelectedSession(store.getState())?.key).toBe("b");
  });
});

describe("selectCounts", () => {
  it("total / visible / claude / codex / running を集計する", () => {
    const store = createSessionStore({ api: makeUnusedApi() });
    store.setState({ sessions: SESSIONS, filters: { ...DEFAULT_FILTERS, sinceDays: 14 } });
    const counts = selectCounts(store.getState(), NOW_MS);
    expect(counts.total).toBe(4);
    expect(counts.claude).toBe(2);
    expect(counts.codex).toBe(2);
    expect(counts.running).toBe(1);
    // sinceDays: 14 で "c"（20日前）が除外されるので visible は 3
    expect(counts.visible).toBe(3);
  });
});

describe("selectRunningClaudeSessions（T-032 / ADR-0009）", () => {
  it("running かつ claude のセッションだけを返す（idle の claude・running の codex は除外）", () => {
    const store = createSessionStore({ api: makeUnusedApi() });
    store.setState({ sessions: SESSIONS });
    const result = selectRunningClaudeSessions(store.getState());
    expect(result.map((s) => s.key)).toEqual(["a"]);
  });

  it("running な claude セッションが無ければ空配列を返す", () => {
    const store = createSessionStore({ api: makeUnusedApi() });
    store.setState({
      sessions: SESSIONS.filter((s) => s.key !== "a"),
    });
    const result = selectRunningClaudeSessions(store.getState());
    expect(result).toEqual([]);
  });

  it("sessions が空配列のとき空配列を返す", () => {
    const store = createSessionStore({ api: makeUnusedApi() });
    store.setState({ sessions: [] });
    expect(selectRunningClaudeSessions(store.getState())).toEqual([]);
  });
});

describe("派生データはストアの state に保存しない", () => {
  it("Object.keys(getState()) に groups / filteredSessions 等の派生キーが無い", () => {
    const store = createSessionStore({ api: makeUnusedApi() });
    const keys = Object.keys(store.getState());
    expect(keys).not.toContain("groups");
    expect(keys).not.toContain("filteredSessions");
    expect(keys).not.toContain("sortedSessions");
    expect(keys).not.toContain("counts");
  });
});
