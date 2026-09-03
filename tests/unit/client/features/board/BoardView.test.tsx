// T-023 受け入れ条件（BoardView。BoardColumn も経由で検証）:
// 「groupSessions の結果を横並びの列で描画。列幅 --column-width、横スクロール可」
// 「各列の縦方向は TanStack Virtual で仮想化（500 件でスクロールが滑らか）」
// 「0 件の列は EmptyState『このグループにセッションはありません』」
// 「← → で列間、↑ ↓ でカード間フォーカス移動、Enter で選択」
//
// 合成データのみ（CLAUDE.md / タスクカードの指定）。UUID は 00000000-0000-4000-8000-00000000000N、
// cwd は C:/synthetic/... を使う。nowMs は固定。
//
// jsdom は要素サイズが既定 0 のため、TanStack Virtual が可視範囲を算出できず行が描画されない
// （tests/unit/client/features/list/ListView.test.tsx と同じ制約）。
// Element.prototype.clientHeight / getBoundingClientRect をテスト全体で 800px 相当に固定して回避する。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardView } from "../../../../../src/client/features/board/BoardView.js";
import { useSessionStore } from "../../../../../src/client/store/useSessionStore.js";
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  groupSessions,
} from "../../../../../src/shared/grouping.js";
import type { Account, SessionSummary } from "../../../../../src/shared/types.js";

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    key: "claude:00000000-0000-4000-8000-000000000001",
    tool: "claude",
    id: "00000000-0000-4000-8000-000000000001",
    title: "合成タイトルA",
    lastMessage: "合成の最終メッセージA",
    lastRole: "assistant",
    cwd: "C:/synthetic/proj",
    branch: null,
    model: "claude-sonnet-5",
    entrypoint: "cli",
    accountKey: "claude:cli",
    state: "idle",
    stateReason: "mtime",
    pid: null,
    startedAt: null,
    firstAt: null,
    updatedAt: "2026-09-03T11:55:00.000Z",
    logSizeBytes: 1024,
    subagentCount: 0,
    released: false,
    ...overrides,
  };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
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

/** アカウント軸で 2 列（claude:cli 4 件 / codex:openai 2 件）になる合成 6 件。 */
const accountCli = makeAccount({ key: "claude:cli", label: "Claude CLI", tool: "claude" });
const accountCodex = makeAccount({ key: "codex:openai", label: "Codex", tool: "codex" });

const s1 = makeSession({
  key: "claude:00000000-0000-4000-8000-000000000001",
  id: "00000000-0000-4000-8000-000000000001",
  accountKey: "claude:cli",
  state: "running",
  title: "タイトル1",
  updatedAt: "2026-09-03T11:59:00.000Z",
});
const s2 = makeSession({
  key: "claude:00000000-0000-4000-8000-000000000002",
  id: "00000000-0000-4000-8000-000000000002",
  accountKey: "claude:cli",
  state: "idle",
  title: "タイトル2",
  updatedAt: "2026-09-03T11:58:00.000Z",
});
const s3 = makeSession({
  key: "claude:00000000-0000-4000-8000-000000000003",
  id: "00000000-0000-4000-8000-000000000003",
  accountKey: "claude:cli",
  state: "active",
  title: "タイトル3",
  updatedAt: "2026-09-03T11:57:00.000Z",
});
const s4 = makeSession({
  key: "claude:00000000-0000-4000-8000-000000000004",
  id: "00000000-0000-4000-8000-000000000004",
  accountKey: "claude:cli",
  state: "idle",
  title: "タイトル4",
  updatedAt: "2026-09-03T11:56:00.000Z",
});
const s5 = makeSession({
  key: "codex:00000000-0000-4000-8000-000000000005",
  id: "00000000-0000-4000-8000-000000000005",
  tool: "codex",
  accountKey: "codex:openai",
  state: "idle",
  title: "タイトル5",
  updatedAt: "2026-09-03T11:55:00.000Z",
});
const s6 = makeSession({
  key: "codex:00000000-0000-4000-8000-000000000006",
  id: "00000000-0000-4000-8000-000000000006",
  tool: "codex",
  accountKey: "codex:openai",
  state: "running",
  title: "タイトル6",
  updatedAt: "2026-09-03T11:54:00.000Z",
});

const sixSessions = [s1, s2, s3, s4, s5, s6];
const twoAccounts = [accountCli, accountCodex];

/**
 * 固定の基準時刻。`BoardView` は内部で `useNowMinute()`（既定 `Date.now`）を呼ぶため、
 * 実時刻のまま実行すると `DEFAULT_FILTERS.sinceDays = 14` の絞り込み基準が実行日ベースになり、
 * 合成データの固定日時（2026-09-03 付近）が実行日によって絞り込みで落ちてしまう
 * （tests/unit/client/features/list/ListView.test.tsx と同じ理由で必要）。
 * `vi.useFakeTimers({ toFake: ["Date"] })` で `Date` だけを固定し、`setTimeout` /
 * `requestAnimationFrame` は実タイマーのまま（rAF モック・waitFor と干渉しないため）にする。
 */
const FIXED_NOW_ISO = "2026-09-03T12:00:00.000Z";

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

function columnKeysInDom(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-column-key]")).map(
    (el) => el.getAttribute("data-column-key") ?? "",
  );
}

describe("BoardView（clientHeight を 800px に固定。実際にカードが描画される設定）", () => {
  // 調査の結果、@tanstack/virtual-core@3.17.8 の observeElementRect / getRect は
  // clientHeight ではなく element.offsetWidth / offsetHeight を読んで可視範囲を計算していた
  // （tests/unit/client/features/list/ListView.test.tsx と同じ調査結果。報告に記載）。
  // そのため clientHeight / getBoundingClientRect に加えて offsetWidth / offsetHeight も固定する
  // （offsetWidth / offsetHeight が実際のカード描画有無を左右する）。
  let originalClientHeight: PropertyDescriptor | undefined;
  let originalGetBoundingClientRect: PropertyDescriptor | undefined;
  let originalOffsetWidth: PropertyDescriptor | undefined;
  let originalOffsetHeight: PropertyDescriptor | undefined;
  let hadResizeObserver = true;

  beforeAll(() => {
    originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "getBoundingClientRect",
    );
    originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        width: 300,
        height: 800,
        top: 0,
        left: 0,
        bottom: 800,
        right: 300,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      }),
    });
    hadResizeObserver =
      typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !== "undefined";
    if (!hadResizeObserver) {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
    }
  });

  afterAll(() => {
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    }
    if (originalOffsetWidth) {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
    }
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
    }
    if (originalGetBoundingClientRect) {
      Object.defineProperty(
        HTMLElement.prototype,
        "getBoundingClientRect",
        originalGetBoundingClientRect,
      );
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect;
    }
    if (!hadResizeObserver) {
      vi.unstubAllGlobals();
    }
  });

  beforeEach(() => {
    resetStore();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FIXED_NOW_ISO));
  });
  afterEach(() => {
    cleanup();
    resetStore();
    vi.useRealTimers();
  });

  it("role=region と aria-label『ボード』を持つ", () => {
    useSessionStore.setState({ sessions: sixSessions, accounts: twoAccounts });
    render(<BoardView />);
    expect(screen.getByRole("region", { name: "ボード" })).toBeInTheDocument();
  });

  it("groupBy=account: 合成 6 件・2 アカウントで、列数と data-column-key の並びが groupSessions の結果と一致する", () => {
    useSessionStore.setState({ sessions: sixSessions, accounts: twoAccounts, groupBy: "account" });
    const { container } = render(<BoardView />);
    const expectedKeys = groupSessions(sixSessions, "account", twoAccounts).map((g) => g.key);
    expect(expectedKeys).toEqual(["claude:cli", "codex:openai"]);
    expect(columnKeysInDom(container)).toEqual(expectedKeys);
  });

  it("groupBy=tool 切替: 列数と data-column-key の並びが groupSessions の結果と一致する", () => {
    useSessionStore.setState({ sessions: sixSessions, accounts: twoAccounts, groupBy: "tool" });
    const { container } = render(<BoardView />);
    const expectedKeys = groupSessions(sixSessions, "tool", twoAccounts).map((g) => g.key);
    expect(expectedKeys).toEqual(["claude", "codex"]);
    expect(columnKeysInDom(container)).toEqual(expectedKeys);
  });

  it("groupBy=state 切替: 列数と data-column-key の並びが groupSessions の結果と一致する", () => {
    useSessionStore.setState({ sessions: sixSessions, accounts: twoAccounts, groupBy: "state" });
    const { container } = render(<BoardView />);
    const expectedKeys = groupSessions(sixSessions, "state", twoAccounts).map((g) => g.key);
    expect(expectedKeys).toEqual(["running", "active", "idle", "error"]);
    expect(columnKeysInDom(container)).toEqual(expectedKeys);
  });

  it("カードクリックで selectedKey がそのセッションの key になる", () => {
    useSessionStore.setState({ sessions: sixSessions, accounts: twoAccounts, groupBy: "account" });
    const { container } = render(<BoardView />);
    const card = container.querySelector(`[data-session-key="${s2.key}"]`) as Element;
    fireEvent.click(card);
    expect(useSessionStore.getState().selectedKey).toBe(s2.key);
  });

  it("groupBy=state で 0 件の列（error）に『このグループにセッションはありません』が表示される", () => {
    useSessionStore.setState({ sessions: sixSessions, accounts: twoAccounts, groupBy: "state" });
    const { container } = render(<BoardView />);
    const errorColumn = container.querySelector('[data-column-key="error"]') as HTMLElement;
    expect(errorColumn).not.toBeNull();
    expect(errorColumn.textContent).toContain("このグループにセッションはありません");
  });

  it("絞り込みで全件 0 件（filters.tool='codex' だが codex 件が無い）になると『条件に合うセッションがありません』『絞り込みを解除してください』が表示される", () => {
    useSessionStore.setState({
      sessions: [s1, s2, s3, s4],
      accounts: [accountCli],
      groupBy: "account",
      filters: { ...DEFAULT_FILTERS, tool: "codex" },
    });
    render(<BoardView />);
    expect(screen.getByText("条件に合うセッションがありません")).toBeInTheDocument();
    expect(screen.getByText("絞り込みを解除してください")).toBeInTheDocument();
  });

  it("500 件（同一列）で描画された article は 500 より大幅に少ない（仮想化されている）", () => {
    const many: SessionSummary[] = Array.from({ length: 500 }, (_, i) =>
      makeSession({
        key: `claude:00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        accountKey: "claude:cli",
        title: `合成タイトル${i}`,
        updatedAt: new Date(Date.parse("2026-09-03T11:00:00.000Z") + i * 1000).toISOString(),
      }),
    );
    useSessionStore.setState({ sessions: many, accounts: [accountCli], groupBy: "tool" });
    const { container } = render(<BoardView />);
    const articleCount = container.querySelectorAll("article").length;
    expect(articleCount).toBeGreaterThan(0);
    // clientHeight 800px・見積り高さ 120px なら可視 7 行程度 + overscan 5 × 2 で 20 行未満に収まる。
    expect(articleCount).toBeLessThan(50);
  });

  describe("キーボード操作（← → で列間、↑ ↓ でカード間、Enter で選択）", () => {
    // レビュー指摘（REQUEST_CHANGES）による仕様変更:
    // 「focusedCard が null のときの最初の矢印キー（4 方向とも）は delta を適用せず、
    //  最初の非空列の先頭カード（index 0）にフォーカスを確定する。2 回目以降に移動」
    // そのため、以下のテストではまず 1 回矢印キーを押して「settle」（s1 に定位置着地）させてから、
    // 実際の移動を検証する。
    let rafSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // 同期的に cb(0) を呼ぶ実装だと、TanStack Virtual 自身が scrollToIndex 内部の
      // 再計算（reconcileScroll）で requestAnimationFrame を再帰的に呼ぶ際に呼び出しスタックが
      // 積み重なり "Maximum call stack size exceeded" になる（jsdom の固定測定値では収束しない
      // ため）。setTimeout(0)（実タイマー）に逃がしてスタックを切ることで再帰を回避しつつ、
      // BoardColumn 側の .focus() 処理は real timer 経由で waitFor が拾えるようにする。
      rafSpy = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((cb: FrameRequestCallback) => {
          setTimeout(() => cb(0), 0);
          return 0;
        });
    });

    afterEach(() => {
      rafSpy.mockRestore();
    });

    function renderBoard() {
      useSessionStore.setState({
        sessions: sixSessions,
        accounts: twoAccounts,
        groupBy: "account",
      });
      render(<BoardView />);
      return screen.getByRole("region", { name: "ボード" });
    }

    /** 最初の矢印キー 1 回で s1（列0 index0）に定位置着地させる。 */
    async function settle(region: HTMLElement): Promise<void> {
      fireEvent.keyDown(region, { key: "ArrowDown" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s1.key);
      });
    }

    it("初回の ↓ は delta を適用せず、最初の非空列の先頭カード（s1）に載る", async () => {
      const region = renderBoard();
      fireEvent.keyDown(region, { key: "ArrowDown" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s1.key);
      });
    });

    it("初回の → でも delta を適用せず、最初の非空列の先頭カードに載る（列 1 に飛ばない）", async () => {
      const region = renderBoard();
      fireEvent.keyDown(region, { key: "ArrowRight" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s1.key);
      });
    });

    it("初回の ← でも delta を適用せず、最初の非空列の先頭カード（s1）に載る", async () => {
      const region = renderBoard();
      fireEvent.keyDown(region, { key: "ArrowLeft" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s1.key);
      });
    });

    it("初回の ↑ でも delta を適用せず、最初の非空列の先頭カード（s1）に載る", async () => {
      const region = renderBoard();
      fireEvent.keyDown(region, { key: "ArrowUp" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s1.key);
      });
    });

    it("settle 後、→ で 2 列目（codex:openai）の先頭カードに移る", async () => {
      const region = renderBoard();
      await settle(region);
      fireEvent.keyDown(region, { key: "ArrowRight" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s5.key);
      });
    });

    it("settle 後、→ の後 ↓ で同じ列の次のカードに移る", async () => {
      const region = renderBoard();
      await settle(region);
      fireEvent.keyDown(region, { key: "ArrowRight" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s5.key);
      });
      fireEvent.keyDown(region, { key: "ArrowDown" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s6.key);
      });
    });

    it("settle 後、→↓ の後 ↑ で 1 つ前のカードに戻る", async () => {
      const region = renderBoard();
      await settle(region);
      fireEvent.keyDown(region, { key: "ArrowRight" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s5.key);
      });
      fireEvent.keyDown(region, { key: "ArrowDown" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s6.key);
      });
      fireEvent.keyDown(region, { key: "ArrowUp" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s5.key);
      });
    });

    it("settle 後、→← で 1 列目（claude:cli）に戻る", async () => {
      const region = renderBoard();
      await settle(region);
      fireEvent.keyDown(region, { key: "ArrowRight" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s5.key);
      });
      fireEvent.keyDown(region, { key: "ArrowLeft" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s1.key);
      });
    });

    it("settle 後、行インデックスが長い列の末尾（index 3）にいるとき、短い列（2 件）へ移ると末尾（index 1）に丸められる", async () => {
      const region = renderBoard();
      // TanStack Virtual の scrollToIndex は内部で requestAnimationFrame を使った再計算を行うため、
      // 連続で fireEvent.keyDown を呼ぶと（rAF を同期実行にモックしている影響で）呼び出しごとの
      // 再帰が積み重なり "Maximum call stack size exceeded" になる。1 回ごとに waitFor で
      // 呼び出しスタックを解消してから次のキー入力を送る。
      await settle(region); // 列0 index0 (s1)
      fireEvent.keyDown(region, { key: "ArrowDown" }); // index1 (s2)
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s2.key);
      });
      fireEvent.keyDown(region, { key: "ArrowDown" }); // index2 (s3)
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s3.key);
      });
      fireEvent.keyDown(region, { key: "ArrowDown" }); // index3 (s4)
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s4.key);
      });

      // 2 列目（codex:openai, 2 件・末尾 index 1）へ移動 → index は 3 ではなく 1 に丸められ、末尾カード s6 になる。
      fireEvent.keyDown(region, { key: "ArrowRight" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s6.key);
      });
    });

    it("settle 後、Enter でフォーカス中のカードが selectedKey になる", async () => {
      const region = renderBoard();
      await settle(region);
      fireEvent.keyDown(region, { key: "ArrowRight" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s5.key);
      });
      fireEvent.keyDown(region, { key: "Enter" });
      expect(useSessionStore.getState().selectedKey).toBe(s5.key);
    });

    // Round 2 レビュー（REQUEST_CHANGES・BLOCKING）: region の tabIndex を
    // 「カードにフォーカス中は -1」にすると、キーボード操作の起点となる region 自体への
    // Tab ストップが 0 個になり、到達性が失われる。region は常に tabIndex="0" に固定する
    // （カードのフォーカスは roving tabindex で個々のカード側が担う）。
    it('region は常に tabIndex="0"（カードにフォーカスがあっても Tab で到達できる）', async () => {
      const region = renderBoard();
      expect(region).toHaveAttribute("tabIndex", "0");

      await settle(region);
      expect(region).toHaveAttribute("tabIndex", "0");
    });

    it('既定の groupBy=state で空の列（error）に → で入った直後も region が tabIndex="0" のまま（Tab で戻れる）', async () => {
      useSessionStore.setState({ sessions: sixSessions, accounts: twoAccounts, groupBy: "state" });
      const { container } = render(<BoardView />);
      const region = screen.getByRole("region", { name: "ボード" });

      // STATE_ORDER = running → active → idle → error（固定 4 列）。
      // 合成 6 件では running(s1,s6) / active(s3) / idle(s2,s4,s5) / error(0 件) になる。
      fireEvent.keyDown(region, { key: "ArrowRight" }); // settle → running 列 index0 (s1)
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s1.key);
      });
      fireEvent.keyDown(region, { key: "ArrowRight" }); // active 列 (s3)
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s3.key);
      });
      fireEvent.keyDown(region, { key: "ArrowRight" }); // idle 列 (s2)
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s2.key);
      });
      fireEvent.keyDown(region, { key: "ArrowRight" }); // error 列（空）に入る

      // error 列には実際のセッションが無いため、Enter を押しても selectedKey は変わらない
      // （= 本当に空列側へフォーカス位置が移っていることの確認）。
      fireEvent.keyDown(region, { key: "Enter" });
      expect(useSessionStore.getState().selectedKey).toBeNull();

      expect(container.querySelector('[data-column-key="error"]')).not.toBeNull();
      expect(region).toHaveAttribute("tabIndex", "0");
    });

    it('カードにフォーカスした後、絞り込みでそのカードが消えても region は tabIndex="0" のままで、↓ で実在するカードにフォーカスが移る', async () => {
      // groupBy: "tool" は claude / codex の固定 2 列（0 件でも列自体は残る）。
      useSessionStore.setState({ sessions: sixSessions, accounts: twoAccounts, groupBy: "tool" });
      render(<BoardView />);
      const region = screen.getByRole("region", { name: "ボード" });

      // settle → claude 列（先頭の非空列）index0 = s1 にフォーカス。
      fireEvent.keyDown(region, { key: "ArrowDown" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s1.key);
      });

      // 絞り込みで s1 を含む claude 全件が消える（tool="codex"）。実際の setFilter アクションを使う。
      useSessionStore.getState().setFilter({ tool: "codex" });

      expect(region).toHaveAttribute("tabIndex", "0");

      // ↓ を送ると、消えた列（claude, 0 件）に留まらず、実在するカード（codex 列）にフォーカスが移る。
      fireEvent.keyDown(region, { key: "ArrowDown" });
      await waitFor(() => {
        const key = document.activeElement?.getAttribute("data-session-key");
        expect(key === s5.key || key === s6.key).toBe(true);
      });
    });

    it("列が 1 つも無い状態（folder グルーピングで 0 件）で ↓ を押しても例外が無く、カードは描画されないまま", async () => {
      // groupBy: "state" / "tool" は 0 件でも固定 4 列 / 2 列を返すため「列が 1 つも無い」状態には
      // ならない（実際に確認した結果、下のテストで別途カバーする）。「列が 0」を再現できるのは
      // 動的に列を作る folder グルーピングのみ（groupByFolder は空配列に対して空配列を返す）。
      useSessionStore.setState({ sessions: [], accounts: [], groupBy: "folder" });
      const { container } = render(<BoardView />);
      const region = screen.getByRole("region", { name: "ボード" });

      expect(columnKeysInDom(container)).toEqual([]);

      expect(() => {
        fireEvent.keyDown(region, { key: "ArrowDown" });
      }).not.toThrow();

      expect(container.querySelectorAll("article").length).toBe(0);
      expect(region).toHaveAttribute("tabIndex", "0");
    });

    it("sessions が 0 件・groupBy=state（列自体は 4 つ残る）で ↓ を押しても例外が無く EmptyState のまま", async () => {
      // sessions.length が 0 のため BoardView の showEmpty（絞り込み解除メッセージ）は出ない設計だが、
      // state グルーピングは 0 件でも running/active/idle/error の 4 列を返すため、各列がそれぞれ
      // 「このグループにセッションはありません」を表示する。
      useSessionStore.setState({ sessions: [], accounts: [], groupBy: "state" });
      const { container } = render(<BoardView />);
      const region = screen.getByRole("region", { name: "ボード" });

      expect(columnKeysInDom(container)).toEqual(["running", "active", "idle", "error"]);
      expect(screen.getAllByText("このグループにセッションはありません")).toHaveLength(4);

      expect(() => {
        fireEvent.keyDown(region, { key: "ArrowDown" });
      }).not.toThrow();

      expect(container.querySelectorAll("article").length).toBe(0);
      expect(screen.getAllByText("このグループにセッションはありません")).toHaveLength(4);
      expect(region).toHaveAttribute("tabIndex", "0");
    });

    it("カードにフォーカスがある状態でセッションデータが更新されても activeElement は移動しない（検索欄相当の外部 input に置いた場合）", async () => {
      function Wrapper() {
        return (
          <>
            <input data-testid="external-search" />
            <BoardView />
          </>
        );
      }
      useSessionStore.setState({
        sessions: sixSessions,
        accounts: twoAccounts,
        groupBy: "account",
      });
      const { container } = render(<Wrapper />);
      const region = screen.getByRole("region", { name: "ボード" });

      // まずカードにフォーカスを移す（focusedCard を確定させる）。
      fireEvent.keyDown(region, { key: "ArrowDown" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", s1.key);
      });

      // 検索欄相当の外部 input にフォーカスを移す。
      const externalInput = container.querySelector(
        '[data-testid="external-search"]',
      ) as HTMLElement;
      externalInput.focus();
      expect(document.activeElement).toBe(externalInput);

      // セッションデータだけが更新されても（ユーザー操作起点ではないため）.focus() は呼ばれず、
      // activeElement は外部 input のままになるはず。
      useSessionStore.setState({
        sessions: sixSessions.map((s) => ({ ...s, lastMessage: `${s.lastMessage} updated` })),
      });

      // 遅延して .focus() が呼ばれるケースも拾えるよう、実タイマーを少し進めてから再確認する。
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(document.activeElement).toBe(externalInput);
    });

    it("絞り込みで列数が減った後も ↓ が動く（moveRow の列インデックスクランプ）", async () => {
      const folderA1 = makeSession({
        key: "claude:00000000-0000-4000-8000-000000000201",
        id: "00000000-0000-4000-8000-000000000201",
        cwd: "C:/synthetic/folderA",
        tool: "claude",
        accountKey: "claude:cli",
        title: "folderA-1",
        updatedAt: "2026-09-03T11:59:00.000Z",
      });
      const folderB1 = makeSession({
        key: "claude:00000000-0000-4000-8000-000000000202",
        id: "00000000-0000-4000-8000-000000000202",
        cwd: "C:/synthetic/folderB",
        tool: "claude",
        accountKey: "claude:cli",
        title: "folderB-1",
        updatedAt: "2026-09-03T11:58:00.000Z",
      });
      const folderC1 = makeSession({
        key: "codex:00000000-0000-4000-8000-000000000203",
        id: "00000000-0000-4000-8000-000000000203",
        cwd: "C:/synthetic/folderC",
        tool: "codex",
        accountKey: "codex:openai",
        title: "folderC-1",
        updatedAt: "2026-09-03T11:57:00.000Z",
      });

      useSessionStore.setState({
        sessions: [folderA1, folderB1, folderC1],
        accounts: twoAccounts,
        groupBy: "folder",
      });
      const { container } = render(<BoardView />);
      const region = screen.getByRole("region", { name: "ボード" });

      // 3 列（folderA, folderB, folderC。normalizeForCompare 済みキーの昇順）になっている。
      expect(columnKeysInDom(container)).toEqual([
        "c:/synthetic/foldera",
        "c:/synthetic/folderb",
        "c:/synthetic/folderc",
      ]);

      // 3 列目（folderC）の先頭カードまで移動する。
      fireEvent.keyDown(region, { key: "ArrowDown" }); // settle → 列0 index0 (folderA1)
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", folderA1.key);
      });
      fireEvent.keyDown(region, { key: "ArrowRight" }); // 列1 (folderB)
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", folderB1.key);
      });
      fireEvent.keyDown(region, { key: "ArrowRight" }); // 列2 (folderC)
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", folderC1.key);
      });

      // 絞り込みで codex を除外 → folderC 列が消え、列数が 3 → 2 に減る。
      useSessionStore.setState({
        filters: { ...DEFAULT_FILTERS, tool: "claude" },
      });
      await waitFor(() => {
        expect(columnKeysInDom(container)).toEqual([
          "c:/synthetic/foldera",
          "c:/synthetic/folderb",
        ]);
      });

      // 列が消えた際、直前までフォーカスされていたカード要素は DOM から取り除かれ、
      // activeElement が document.body に落ちうる。region 自身に明示的にフォーカスを戻してから
      // 次のキー入力を送る（activeElement が body のまま keyDown を送っても意味が無いため）。
      region.focus();
      // 消えた列（index 2）を指していた focusedCard で ↓ を押しても、列インデックスがクランプされ、
      // 新しい末尾列（folderB）のカードに移る（クラッシュしない）。
      fireEvent.keyDown(region, { key: "ArrowDown" });
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute("data-session-key", folderB1.key);
      });
    });
  });
});
