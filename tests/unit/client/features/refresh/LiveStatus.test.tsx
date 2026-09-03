// T-025 受け入れ条件（LiveStatus）:
// 「ヘッダ帯右端に『更新中』/『自動更新: 接続 / ポーリング』を表示」
// DESIGN.md §6.9「更新中はヘッダ帯右端にテキストだけ出す」に対応する。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveStatus } from "../../../../../src/client/features/refresh/LiveStatus.js";
import { useSessionStore } from "../../../../../src/client/store/useSessionStore.js";
import { DEFAULT_FILTERS, DEFAULT_SORT } from "../../../../../src/shared/grouping.js";
import type { SessionSummary } from "../../../../../src/shared/types.js";

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

beforeEach(resetStore);
afterEach(() => {
  cleanup();
  resetStore();
});

describe("LiveStatus", () => {
  it("role=status を持つ", () => {
    render(<LiveStatus />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("status.loading && sessions.length > 0 のとき『更新中』が表示される", () => {
    useSessionStore.setState({
      sessions: [makeSession()],
      status: { loading: true, error: null, lastFetchedAt: null, live: true },
    });
    render(<LiveStatus />);
    expect(screen.getByText("更新中")).toBeInTheDocument();
  });

  it("再読込中でなく live=true のとき『自動更新: 接続』が表示される", () => {
    useSessionStore.setState({
      sessions: [makeSession()],
      status: { loading: false, error: null, lastFetchedAt: null, live: true },
    });
    render(<LiveStatus />);
    expect(screen.getByText("自動更新: 接続")).toBeInTheDocument();
  });

  it("live=false のとき『自動更新: ポーリング』が表示される", () => {
    useSessionStore.setState({
      sessions: [makeSession()],
      status: { loading: false, error: null, lastFetchedAt: null, live: false },
    });
    render(<LiveStatus />);
    expect(screen.getByText("自動更新: ポーリング")).toBeInTheDocument();
  });

  it("loading でも sessions が 0 件なら『更新中』にならず live に応じた表示になる", () => {
    useSessionStore.setState({
      sessions: [],
      status: { loading: true, error: null, lastFetchedAt: null, live: false },
    });
    render(<LiveStatus />);
    expect(screen.queryByText("更新中")).not.toBeInTheDocument();
    expect(screen.getByText("自動更新: ポーリング")).toBeInTheDocument();
  });
});
