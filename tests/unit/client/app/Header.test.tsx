// T-020 受け入れ条件:
// 「ヘッダ帯に『AI-Manager』、現在時刻（HH:mm 現在、1 分ごと更新）、
//   『Claude N / Codex N 件』、[ボード][リスト] セグメント、[更新] ghost ボタン」
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "../../../../src/client/app/Header.js";
import { useSessionStore } from "../../../../src/client/store/useSessionStore.js";
import { DEFAULT_FILTERS, DEFAULT_SORT } from "../../../../src/shared/grouping.js";
import type { SessionSummary } from "../../../../src/shared/types.js";

const NOW_ISO = "2026-01-01T00:00:00.000Z";

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

beforeEach(resetStore);
afterEach(() => {
  cleanup();
  resetStore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Header", () => {
  it("『AI-Manager』というタイトル（h1）が表示される", () => {
    render(<Header now={new Date(2026, 8, 3, 9, 5)} />);
    expect(screen.getByRole("heading", { level: 1, name: "AI-Manager" })).toBeInTheDocument();
  });

  it("now を固定すると『09:05 現在』が表示される（new Date(2026, 8, 3, 9, 5)）", () => {
    render(<Header now={new Date(2026, 8, 3, 9, 5)} />);
    expect(screen.getByText("09:05 現在")).toBeInTheDocument();
  });

  it("合成 3 件（claude 2, codex 1, うち running 1）で『Claude 2 / Codex 1 件』が表示される", () => {
    useSessionStore.setState({
      sessions: [
        makeSession({ key: "claude:1", tool: "claude", state: "running" }),
        makeSession({ key: "claude:2", tool: "claude", state: "idle" }),
        makeSession({ key: "codex:1", tool: "codex", id: "1", state: "idle" }),
      ],
    });
    const { container } = render(<Header now={new Date(2026, 8, 3, 9, 5)} />);
    // 「Claude 2 / Codex 1 件」は複数のテキストノード + ネストした <span> に分かれて描画されるため
    // （区切りの「/」は CSS の padding で表現し、テキストノードとしては挟まない）、
    // getByText の完全一致では拾えない。件数を表示する要素の textContent をまとめて検証する。
    const countsEl = Array.from(container.querySelectorAll("span")).find((el) =>
      el.textContent?.includes("件"),
    );
    expect(countsEl).toBeDefined();
    const normalized = countsEl?.textContent?.replace(/\s+/g, " ").trim();
    expect(normalized).toContain("Claude");
    expect(normalized).toContain("2");
    expect(normalized).toContain("Codex");
    expect(normalized).toContain("1");
    expect(normalized).toContain("件");
  });

  it("表示切替グループの aria-pressed が view に応じて切り替わり、クリックで view が変わる", () => {
    render(<Header now={new Date(2026, 8, 3, 9, 5)} />);
    const boardButton = screen.getByRole("button", { name: "ボード" });
    const listButton = screen.getByRole("button", { name: "リスト" });

    expect(boardButton).toHaveAttribute("aria-pressed", "true");
    expect(listButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(listButton);

    expect(useSessionStore.getState().view).toBe("list");
    expect(listButton).toHaveAttribute("aria-pressed", "true");
    expect(boardButton).toHaveAttribute("aria-pressed", "false");
  });

  it("表示切替は role=group で aria-label『表示』を持つ", () => {
    render(<Header now={new Date(2026, 8, 3, 9, 5)} />);
    expect(screen.getByRole("group", { name: "表示" })).toBeInTheDocument();
  });

  it("『更新』ボタン（RefreshButton）が表示される", () => {
    render(<Header now={new Date(2026, 8, 3, 9, 5)} />);
    expect(screen.getByRole("button", { name: "更新" })).toBeInTheDocument();
  });

  // T-025: 「更新中」の表示は LiveStatus（tests/unit/client/features/refresh/LiveStatus.test.tsx）
  // に移った。Header 自身はもう表示しない（extra スロットで差し込まれるだけ）。
  it("status.loading && sessions.length > 0 でも Header 自身は『更新中』を表示しない（LiveStatus に移譲した）", () => {
    useSessionStore.setState({
      sessions: [makeSession()],
      status: { loading: true, error: null, lastFetchedAt: null, live: false },
    });
    render(<Header now={new Date(2026, 8, 3, 9, 5)} />);
    expect(screen.queryByText("更新中")).not.toBeInTheDocument();
  });

  it("extra prop で渡した要素が右端（更新ボタンの後）に描画される", () => {
    render(
      <Header
        now={new Date(2026, 8, 3, 9, 5)}
        extra={<span data-testid="extra-slot">自動更新: 接続</span>}
      />,
    );
    const extraEl = screen.getByTestId("extra-slot");
    const refreshButton = screen.getByRole("button", { name: "更新" });
    expect(
      refreshButton.compareDocumentPosition(extraEl) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("extra を渡さない場合は何も追加描画されない（クラッシュしない）", () => {
    expect(() => render(<Header now={new Date(2026, 8, 3, 9, 5)} />)).not.toThrow();
  });

  it("now を渡さない場合、1 分ごとに表示が更新される（次の分の 0 秒で切り替わる）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 9, 5, 30));

    render(<Header />);
    expect(screen.getByText("09:05 現在")).toBeInTheDocument();

    // 次の分の 0 秒（30 秒後）まで進める。
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByText("09:06 現在")).toBeInTheDocument();
  });
});
