// T-025 受け入れ条件（LiveStatus）:
// 「ヘッダ帯右端に『更新中』/『自動更新: 接続 / ポーリング』を表示」
// DESIGN.md §6.9「更新中はヘッダ帯右端にテキストだけ出す」に対応する。
//
// T-032 受け入れ条件（DESIGN.md §6.11 / ADR-0009）:
// 「送信結果（投函 / 失敗 / 送信中）を LiveStatus に出す。idle に戻ると自動更新の表示に戻る」
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveStatus } from "../../../../../src/client/features/refresh/LiveStatus.js";
import liveStatusStyles from "../../../../../src/client/features/refresh/LiveStatus.module.css";
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
    send: { state: "idle", message: "", at: null },
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

  it("send.state が sending のとき『送信中…』が role=status のまま表示される", () => {
    useSessionStore.setState({
      sessions: [makeSession()],
      status: { loading: false, error: null, lastFetchedAt: null, live: true },
      send: { state: "sending", message: "", at: null },
    });
    render(<LiveStatus />);
    expect(screen.getByRole("status")).toHaveTextContent("送信中…");
    // 送信中は自動更新の表示より優先される。
    expect(screen.queryByText("自動更新: 接続")).not.toBeInTheDocument();
  });

  it("send.state が sent のとき『送信: 投函しました』が表示される", () => {
    useSessionStore.setState({
      sessions: [makeSession()],
      status: { loading: false, error: null, lastFetchedAt: null, live: true },
      send: { state: "sent", message: "投函しました", at: Date.now() },
    });
    render(<LiveStatus />);
    expect(screen.getByRole("status")).toHaveTextContent("送信: 投函しました");
  });

  it("send.state が error のとき▲を含む失敗表示が role=status のまま出る", () => {
    useSessionStore.setState({
      sessions: [makeSession()],
      status: { loading: false, error: null, lastFetchedAt: null, live: true },
      send: {
        state: "error",
        message: "送信に失敗しました。 時間をおいて再試行してください。",
        at: Date.now(),
      },
    });
    render(<LiveStatus />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("▲");
    expect(status.textContent).toContain("送信に失敗しました。");
  });

  it("send.state が idle に戻ると自動更新の表示に戻る", () => {
    useSessionStore.setState({
      sessions: [makeSession()],
      status: { loading: false, error: null, lastFetchedAt: null, live: true },
      send: { state: "idle", message: "", at: null },
    });
    render(<LiveStatus />);
    expect(screen.getByText("自動更新: 接続")).toBeInTheDocument();
    expect(screen.queryByText(/送信/)).not.toBeInTheDocument();
  });

  // reviewer BLOCKING 対応: 送信結果（sending / sent / error）は DESIGN.md §6.11 の
  // --text-sm 指定に合わせるため styles.send クラスを付ける（自動更新表示の --text-xs とは別クラス）。
  it.each<["sending" | "sent" | "error"]>([["sending"], ["sent"], ["error"]])(
    "send.state が %s のとき styles.send クラスが付く",
    (state) => {
      useSessionStore.setState({
        sessions: [makeSession()],
        status: { loading: false, error: null, lastFetchedAt: null, live: true },
        send: { state, message: "失敗しました。 再試行してください。", at: Date.now() },
      });
      render(<LiveStatus />);
      const status = screen.getByRole("status");
      expect(liveStatusStyles.send).toBeTruthy();
      expect(status.className.split(" ")).toContain(liveStatusStyles.send);
    },
  );

  it("send.state が idle（自動更新表示）のときは styles.send クラスが付かない", () => {
    useSessionStore.setState({
      sessions: [makeSession()],
      status: { loading: false, error: null, lastFetchedAt: null, live: true },
      send: { state: "idle", message: "", at: null },
    });
    render(<LiveStatus />);
    const status = screen.getByRole("status");
    expect(status.className.split(" ")).not.toContain(liveStatusStyles.send);
  });
});
