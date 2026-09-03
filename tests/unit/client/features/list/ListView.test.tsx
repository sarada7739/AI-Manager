// T-024 受け入れ条件（ListView）:
// 「列: 状態(ドット)/種別(ピル)/タイトル/最終メッセージ/フォルダ/ブランチ/サイズ/最終更新」
// 「ヘッダクリックで sort を切替(同じ列で昇降反転)。並べ替え中の列に矢印と aria-sort」
// 「行高 --row-height、TanStack Virtual で仮想化」
// 「行クリック / Enter で select。選択行は背景 --color-surface-3」
// 「0 件は EmptyState『条件に合うセッションがありません。絞り込みを解除してください』」
// 「<table> セマンティクス(role 付与)でスクリーンリーダーが列名を読める」
//
// 合成データのみ（CLAUDE.md / タスクカードの指定）。UUID は 00000000-0000-4000-8000-00000000000N、
// cwd は C:/synthetic/... を使う。nowMs は固定。

import { Virtualizer } from "@tanstack/react-virtual";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ListView } from "../../../../../src/client/features/list/ListView.js";
import { useSessionStore } from "../../../../../src/client/store/useSessionStore.js";
import { DEFAULT_FILTERS, DEFAULT_SORT, sortSessions } from "../../../../../src/shared/grouping.js";
import type { SessionSummary } from "../../../../../src/shared/types.js";

/** `--row-height`(tokens.css)と同値。ListView.tsx の ROW_HEIGHT_PX と揃える。 */
const ROW_HEIGHT_PX = 36;

/**
 * 固定の基準時刻。`ListView` は内部で `useNowMinute()`(既定 `Date.now`)を呼ぶため、
 * 実時刻のまま実行すると `DEFAULT_FILTERS.sinceDays = 14` の絞り込み基準が実行日ベースになり、
 * `sessionE.updatedAt` のような固定の過去日時が実行日によって絞り込みで落ちてしまう
 * （REQUEST_CHANGES 指摘: BLOCKING）。`vi.useFakeTimers({ toFake: ["Date"] })` で `Date` だけを
 * 固定し、`setTimeout` / `requestAnimationFrame` は実タイマーのまま（useNowMinute の内部
 * setTimeout・↓キー移動の rAF モックと干渉しないようにするため）にする。
 */
const FIXED_NOW_ISO = "2026-09-03T12:00:00.000Z";
const FIXED_NOW_MS = Date.parse(FIXED_NOW_ISO);

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    key: "claude:00000000-0000-4000-8000-000000000001",
    tool: "claude",
    id: "00000000-0000-4000-8000-000000000001",
    title: "合成タイトルA",
    lastMessage: "合成の最終メッセージA",
    lastRole: "assistant",
    cwd: "C:/synthetic/proj-a",
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

// claude 3 件 / codex 2 件、running 1 件、サイズ・updatedAt・title がばらばら（タスクカード指定）。
// updatedAt 降順: A(30秒前) > B(5分前) > D(1時間前) > C(2日前) > E(10日前)。
const sessionA = makeSession({
  key: "claude:00000000-0000-4000-8000-000000000001",
  tool: "claude",
  id: "00000000-0000-4000-8000-000000000001",
  title: "タイトルA",
  cwd: "C:/synthetic/proj-a",
  branch: null,
  logSizeBytes: 1024, // 1.0 KB
  updatedAt: "2026-09-03T11:59:30.000Z", // 30秒前 → たった今
  state: "running",
});
const sessionB = makeSession({
  key: "claude:00000000-0000-4000-8000-000000000002",
  tool: "claude",
  id: "00000000-0000-4000-8000-000000000002",
  title: "タイトルB",
  cwd: "C:/synthetic/proj-b",
  branch: "main",
  logSizeBytes: 500, // 500 B
  updatedAt: "2026-09-03T11:55:00.000Z", // 5分前
  state: "idle",
});
const sessionC = makeSession({
  key: "claude:00000000-0000-4000-8000-000000000003",
  tool: "claude",
  id: "00000000-0000-4000-8000-000000000003",
  title: "タイトルC",
  cwd: "C:/synthetic/proj-c",
  branch: "feature/x",
  logSizeBytes: 2 * 1024 * 1024, // 2.0 MB
  updatedAt: "2026-09-01T12:00:00.000Z", // 2日前
  state: "idle",
});
const sessionD = makeSession({
  key: "codex:00000000-0000-4000-8000-000000000004",
  tool: "codex",
  id: "00000000-0000-4000-8000-000000000004",
  title: "タイトルD",
  cwd: "C:/synthetic/proj-d",
  branch: null,
  logSizeBytes: 10, // 10 B
  updatedAt: "2026-09-03T11:00:00.000Z", // 1時間前
  state: "idle",
});
const sessionE = makeSession({
  key: "codex:00000000-0000-4000-8000-000000000005",
  tool: "codex",
  id: "00000000-0000-4000-8000-000000000005",
  title: "タイトルE",
  cwd: "C:/synthetic/proj-e",
  branch: "dev",
  logSizeBytes: 3 * 1024 * 1024, // 3.0 MB
  updatedAt: "2026-08-24T12:00:00.000Z", // 10日前(sinceDays既定14で残る)
  state: "idle",
});

function allSessions(): SessionSummary[] {
  return [sessionA, sessionB, sessionC, sessionD, sessionE];
}

/** 既定インスタンス useSessionStore を初期状態に戻す（他テストからの汚染を防ぐ）。 */
function resetStore(): void {
  useSessionStore.setState({
    sessions: [],
    accounts: [],
    view: "list",
    groupBy: "account",
    filters: DEFAULT_FILTERS,
    sort: DEFAULT_SORT,
    readOnly: true,
    selectedKey: null,
    status: { loading: false, error: null, lastFetchedAt: null, live: false },
  });
}

/** DOM に描画されている行の data-session-key を、描画順のまま取り出す。 */
function sessionKeysInDom(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-session-key]")).map(
    (el) => el.getAttribute("data-session-key") ?? "",
  );
}

describe("ListView 仮想化（jsdom 既定の clientHeight=0 のとき。パッチ未適用）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW_MS);
    resetStore();
    useSessionStore.setState({ sessions: allSessions() });
  });
  afterEach(() => {
    cleanup();
    resetStore();
    vi.useRealTimers();
  });

  it("clientHeight を固定しない場合に描画される行数を記録する（0 件～overscan 分。jsdom の制約でテスト不能な範囲）", () => {
    const { container } = render(<ListView />);
    const rowCount = sessionKeysInDom(container).length;
    // jsdom は要素サイズが 0 のため、TanStack Virtual が算出する可視範囲は環境依存。
    // ここでは「クラッシュせず、総件数を超えない」ことだけを確認する（挙動の記録）。
    expect(rowCount).toBeGreaterThanOrEqual(0);
    expect(rowCount).toBeLessThanOrEqual(allSessions().length);
  });
});

describe("ListView（clientHeight を 600px に固定。実際に行が描画される設定）", () => {
  // タスクカードの (b) 方式。ただし実装（@tanstack/virtual-core@3.17.8 の observeElementRect /
  // getRect）は clientHeight ではなく element.offsetWidth / offsetHeight を読んで可視範囲を
  // 計算していた（調査の結果、タスクカードの想定と異なる。報告に記載）。
  // そのため clientHeight / getBoundingClientRect に加えて offsetWidth / offsetHeight も固定する
  // （offsetWidth / offsetHeight が実際に行の描画有無を左右する）。
  let originalClientHeight: PropertyDescriptor | undefined;
  let originalGetBoundingClientRect: PropertyDescriptor | undefined;
  let originalOffsetWidth: PropertyDescriptor | undefined;
  let originalOffsetHeight: PropertyDescriptor | undefined;

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
      value: 600,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        bottom: 600,
        right: 800,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      }),
    });
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
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW_MS);
    resetStore();
    useSessionStore.setState({ sessions: allSessions() });
  });
  afterEach(() => {
    cleanup();
    resetStore();
    vi.useRealTimers();
  });

  it("role=grid、aria-label『セッション一覧』、aria-rowcount が 件数+1 になる", () => {
    const { container } = render(<ListView />);
    const grid = container.querySelector('[role="grid"]');
    expect(grid).not.toBeNull();
    expect(grid).toHaveAttribute("aria-label", "セッション一覧");
    expect(grid).toHaveAttribute("aria-rowcount", String(allSessions().length + 1));
  });

  it("8 つの columnheader が表示順どおりの文言を持つ", () => {
    const { container } = render(<ListView />);
    const headers = Array.from(container.querySelectorAll('[role="columnheader"]'));
    expect(headers).toHaveLength(8);
    const expectedLabels = [
      "状態",
      "種別",
      "タイトル",
      "最終メッセージ",
      "フォルダ",
      "ブランチ",
      "サイズ",
      "最終更新",
    ];
    expectedLabels.forEach((label, index) => {
      expect(headers[index]?.textContent).toContain(label);
    });
  });

  it("既定では『最終更新』列が aria-sort=descending になる", () => {
    const { container } = render(<ListView />);
    const headers = Array.from(container.querySelectorAll('[role="columnheader"]'));
    const updatedAtHeader = headers.find((h) => h.textContent?.includes("最終更新"));
    expect(updatedAtHeader).toHaveAttribute("aria-sort", "descending");
  });

  it("並べ替え不可の列（種別・最終メッセージ・フォルダ・ブランチ）に aria-sort が無い", () => {
    const { container } = render(<ListView />);
    const headers = Array.from(container.querySelectorAll('[role="columnheader"]'));
    for (const label of ["種別", "最終メッセージ", "フォルダ", "ブランチ"]) {
      const header = headers.find((h) => h.textContent?.includes(label));
      expect(header?.hasAttribute("aria-sort")).toBe(false);
    }
  });

  it("『サイズ』ヘッダをクリックすると sort が { key: logSizeBytes, dir: asc } になり aria-sort=ascending・矢印が出る", () => {
    const { container } = render(<ListView />);
    const sizeButton = screen.getByRole("button", { name: "サイズ" });
    fireEvent.click(sizeButton);

    expect(useSessionStore.getState().sort).toEqual({ key: "logSizeBytes", dir: "asc" });

    const headers = Array.from(container.querySelectorAll('[role="columnheader"]'));
    const sizeHeader = headers.find((h) => h.textContent?.includes("サイズ"));
    expect(sizeHeader).toHaveAttribute("aria-sort", "ascending");
    expect(sizeHeader?.textContent).toContain("▲");
  });

  it("同じ列（サイズ）を再クリックすると dir が desc に反転し矢印が変わる", () => {
    const { container } = render(<ListView />);
    const sizeButton = screen.getByRole("button", { name: "サイズ" });
    fireEvent.click(sizeButton);
    fireEvent.click(screen.getByRole("button", { name: /サイズ/ }));

    expect(useSessionStore.getState().sort).toEqual({ key: "logSizeBytes", dir: "desc" });

    const headers = Array.from(container.querySelectorAll('[role="columnheader"]'));
    const sizeHeader = headers.find((h) => h.textContent?.includes("サイズ"));
    expect(sizeHeader).toHaveAttribute("aria-sort", "descending");
    expect(sizeHeader?.textContent).toContain("▼");
  });

  it("行の順序（data-session-key）は既定の sort（updatedAt desc）で sortSessions の結果と一致する", () => {
    const { container } = render(<ListView />);
    const expectedKeys = sortSessions(allSessions(), DEFAULT_SORT).map((s) => s.key);
    expect(sessionKeysInDom(container)).toEqual(expectedKeys);
  });

  it("『サイズ』ヘッダクリック後の行の順序も sortSessions の結果と一致する", () => {
    const { container } = render(<ListView />);
    fireEvent.click(screen.getByRole("button", { name: "サイズ" }));

    const expectedKeys = sortSessions(allSessions(), { key: "logSizeBytes", dir: "asc" }).map(
      (s) => s.key,
    );
    expect(sessionKeysInDom(container)).toEqual(expectedKeys);
  });

  it("行クリックで selectedKey が変わる", () => {
    const { container } = render(<ListView />);
    const row = container.querySelector(`[data-session-key="${sessionB.key}"]`) as Element;
    fireEvent.click(row);
    expect(useSessionStore.getState().selectedKey).toBe(sessionB.key);
  });

  it("行で Enter を押しても selectedKey が変わる", () => {
    const { container } = render(<ListView />);
    const row = container.querySelector(`[data-session-key="${sessionC.key}"]`) as Element;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(useSessionStore.getState().selectedKey).toBe(sessionC.key);
  });

  it("selectedKey と一致する行だけ aria-selected=true になる", () => {
    useSessionStore.setState({ selectedKey: sessionD.key });
    const { container } = render(<ListView />);

    const selectedRow = container.querySelector(`[data-session-key="${sessionD.key}"]`);
    expect(selectedRow).toHaveAttribute("aria-selected", "true");

    for (const session of allSessions()) {
      if (session.key === sessionD.key) {
        continue;
      }
      const row = container.querySelector(`[data-session-key="${session.key}"]`);
      expect(row).toHaveAttribute("aria-selected", "false");
    }
  });

  it("sessions が 0 件のとき EmptyState の 2 文言が表示され role=grid が存在しない", () => {
    useSessionStore.setState({ sessions: [] });
    const { container } = render(<ListView />);
    expect(screen.getByText("条件に合うセッションがありません")).toBeInTheDocument();
    expect(screen.getByText("絞り込みを解除してください")).toBeInTheDocument();
    expect(container.querySelector('[role="grid"]')).toBeNull();
  });

  it("絞り込みの結果 0 件になった場合も EmptyState が表示され role=grid が存在しない", () => {
    useSessionStore.setState({
      filters: { ...DEFAULT_FILTERS, query: "該当しない合成キーワードxyz999" },
    });
    const { container } = render(<ListView />);
    expect(screen.getByText("条件に合うセッションがありません")).toBeInTheDocument();
    expect(screen.getByText("絞り込みを解除してください")).toBeInTheDocument();
    expect(container.querySelector('[role="grid"]')).toBeNull();
  });

  it("↓ キーで次の行に tabIndex=0 が移る", () => {
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    try {
      const { container } = render(<ListView />);
      const firstRow = container.querySelector('[data-row-index="0"]') as Element;
      expect(firstRow).toHaveAttribute("tabIndex", "0");

      fireEvent.keyDown(firstRow, { key: "ArrowDown" });

      const secondRow = container.querySelector('[data-row-index="1"]');
      const firstRowAfter = container.querySelector('[data-row-index="0"]');
      expect(secondRow).toHaveAttribute("tabIndex", "0");
      expect(firstRowAfter).toHaveAttribute("tabIndex", "-1");
    } finally {
      rafSpy.mockRestore();
    }
  });

  it("--list-body-height が 36 × 件数 px になる", () => {
    const { container } = render(<ListView />);
    const rowGroups = Array.from(container.querySelectorAll('[role="rowgroup"]'));
    const bodyGroup = rowGroups[1] as HTMLElement | undefined;
    expect(bodyGroup).toBeDefined();
    expect(bodyGroup?.style.getPropertyValue("--list-body-height")).toBe(
      `${ROW_HEIGHT_PX * allSessions().length}px`,
    );
  });

  it("clientHeight 固定時は 5 件すべての行が実際に描画される", () => {
    const { container } = render(<ListView />);
    expect(sessionKeysInDom(container)).toHaveLength(allSessions().length);
  });

  it("絞り込みで件数が減り focusedIndex が範囲外になっても、描画中の行にちょうど1つ tabIndex=0 が存在する", () => {
    // このテストは tabIndex 属性（React state 由来）だけを見るため、requestAnimationFrame の
    // コールバック自体は実行しなくてよい。@tanstack/virtual-core の scheduleScrollReconcile は
    // 同じ window.requestAnimationFrame を使っており、jsdom には実スクロールが無い（scrollTop が
    // 変化しない）ため、コールバックを同期的に呼ぶモックにすると reconcileScroll が収束せず
    // 無限再帰（Maximum call stack size exceeded）になる（実行して確認済み）。呼び出しを記録する
    // だけの no-op にして再帰を避ける。
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    try {
      const { container } = render(<ListView />);
      const firstRow = container.querySelector('[data-row-index="0"]') as Element;

      // End キーで末尾（5件中の最後 = index 4）にフォーカスを移す。
      fireEvent.keyDown(firstRow, { key: "End" });
      expect(container.querySelector('[data-row-index="4"]')).toHaveAttribute("tabIndex", "0");

      // 絞り込みで codex のみ（sessionD・sessionE の 2 件）にする。
      // focusedIndex は 4 のまま持ち越されるため、新しい一覧（長さ 2）では範囲外になる。
      act(() => {
        useSessionStore.getState().setFilter({ tool: "codex" });
      });

      const tabbableRows = container.querySelectorAll('[tabindex="0"]');
      expect(tabbableRows).toHaveLength(1);
    } finally {
      rafSpy.mockRestore();
    }
  });

  it("500 件でフォーカス行が仮想化ウィンドウ外に出ても、描画中の行にちょうど1つ tabIndex=0 が存在する", () => {
    // 上のテストと同じ理由で no-op モックにする（500 件では実際にスクロールが必要になり、
    // 同期コールバックだと reconcileScroll の無限再帰が顕在化しやすい）。
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    try {
      // 500 件の合成データ。updatedAt は 1 分刻みで過去にずらす（sinceDays 既定 14 日以内に収まる）。
      const manySessions: SessionSummary[] = Array.from({ length: 500 }, (_, i) =>
        makeSession({
          key: `claude:00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
          id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
          title: `タイトル${i}`,
          cwd: `C:/synthetic/proj-${i}`,
          updatedAt: new Date(FIXED_NOW_MS - i * 60_000).toISOString(),
        }),
      );
      useSessionStore.setState({ sessions: manySessions });

      const { container } = render(<ListView />);
      const firstRow = container.querySelector('[data-row-index="0"]') as Element;

      // End キーで末尾（500件中の最後 = index 499）にフォーカスを移す。
      // jsdom には実レイアウトが無く、TanStack Virtual の scrollToIndex が呼ぶ
      // element.scrollTo() は "scroll" イベントを発火しないため、可視範囲（getVirtualItems）は
      // 追従しない可能性がある（= フォーカス行がそもそも描画されない）。このテストはその状況で
      // 「描画中のどれかの行にちょうど1つ tabIndex=0 がある」という不変条件を検証する
      // （実装が focusedIndex を可視範囲にクランプしていなければ、tabbableRows は 0 件になり失敗する）。
      fireEvent.keyDown(firstRow, { key: "End" });

      const tabbableRows = container.querySelectorAll('[tabindex="0"]');
      expect(tabbableRows).toHaveLength(1);
    } finally {
      rafSpy.mockRestore();
    }
  });

  it("描画された行の --virtual-offset は先頭行で 0px、i 番目で i×36px になる（scrollMargin 回帰の検出）", () => {
    const { container } = render(<ListView />);
    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-row-index]"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const index = Number(row.getAttribute("data-row-index"));
      const expectedOffset = `${index * ROW_HEIGHT_PX}px`;
      expect(row.style.getPropertyValue("--virtual-offset")).toBe(expectedOffset);
    }
  });

  it("先頭行（data-row-index=0）の --virtual-offset は常に 0px（offsetHeight を 600 に固定していても scrollMargin でずれない）", () => {
    const { container } = render(<ListView />);
    const firstRow = container.querySelector<HTMLElement>('[data-row-index="0"]');
    expect(firstRow).not.toBeNull();
    expect(firstRow?.style.getPropertyValue("--virtual-offset")).toBe("0px");
  });

  it("最終行の --virtual-offset + 36px は --list-body-height 以下になる", () => {
    const { container } = render(<ListView />);
    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-row-index]"));
    expect(rows.length).toBeGreaterThan(0);
    const offsets = rows.map((row) =>
      Number.parseFloat(row.style.getPropertyValue("--virtual-offset")),
    );
    const maxOffset = Math.max(...offsets);

    const rowGroups = Array.from(container.querySelectorAll('[role="rowgroup"]'));
    const bodyGroup = rowGroups[1] as HTMLElement | undefined;
    const bodyHeight = Number.parseFloat(
      bodyGroup?.style.getPropertyValue("--list-body-height") ?? "0",
    );

    expect(maxOffset + ROW_HEIGHT_PX).toBeLessThanOrEqual(bodyHeight);
  });

  describe("moveFocus の tryFocus（requestAnimationFrame での再試行、最大2回）", () => {
    // @tanstack/virtual-core の Virtualizer.scheduleScrollReconcile は tryFocus と同じ
    // window.requestAnimationFrame を共有しており、jsdom には実スクロールが無い（scrollTop が
    // 変化しない）ため reconcileScroll が収束しないケースがある（Round 1 で実際に無限再帰
    // させてしまい確認済み）。ここでは scheduleScrollReconcile 自体を no-op にして、
    // window.requestAnimationFrame の呼び出しが純粋に ListView 側の tryFocus 由来になるよう
    // 切り分けたうえで、コーディネーター指示どおり「呼び出し回数を数えて setTimeout(0) に
    // 逃がす」モックで検証する。
    // `scheduleScrollReconcile` は @tanstack/virtual-core の型定義上 private のため、
    // スパイ対象にするには最小限のインターフェースを介したキャストが必要
    // （`any` は CLAUDE.md で禁止のため、メソッド名だけを持つ型を用意する）。
    interface VirtualizerWithScheduleScrollReconcile {
      scheduleScrollReconcile: () => void;
    }
    let scheduleScrollReconcileSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      const virtualizerProto =
        Virtualizer.prototype as unknown as VirtualizerWithScheduleScrollReconcile;
      scheduleScrollReconcileSpy = vi
        .spyOn(virtualizerProto, "scheduleScrollReconcile")
        .mockImplementation(() => {});
    });
    afterEach(() => {
      scheduleScrollReconcileSpy.mockRestore();
    });

    it("対象行がすぐに見つかる場合、tryFocus の requestAnimationFrame は1回だけ呼ばれ focus が1回だけ呼ばれる", async () => {
      let rafCallCount = 0;
      const rafSpy = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((cb: FrameRequestCallback) => {
          rafCallCount += 1;
          setTimeout(() => cb(0), 0);
          return 0;
        });
      const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
      try {
        const { container } = render(<ListView />);
        const firstRow = container.querySelector('[data-row-index="0"]') as Element;
        fireEvent.keyDown(firstRow, { key: "ArrowDown" });

        // setTimeout(0) のチェーンが解決するまで実時間で待つ。
        await new Promise((resolve) => setTimeout(resolve, 50));

        const targetRow = container.querySelector('[data-row-index="1"]') as HTMLElement;
        expect(rafCallCount).toBe(1);
        expect(focusSpy).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(targetRow);
      } finally {
        rafSpy.mockRestore();
        focusSpy.mockRestore();
      }
    });

    it("対象行が最後まで見つからない場合、tryFocus の requestAnimationFrame は最大2回（初回+再試行1回）で打ち切られ focus は呼ばれない", async () => {
      let rafCallCount = 0;
      const rafSpy = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((cb: FrameRequestCallback) => {
          rafCallCount += 1;
          setTimeout(() => cb(0), 0);
          return 0;
        });
      const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
      try {
        // 500 件の合成データ。updatedAt は 1 分刻みで過去にずらす（sinceDays 既定 14 日以内）。
        const manySessions: SessionSummary[] = Array.from({ length: 500 }, (_, i) =>
          makeSession({
            key: `claude:00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
            id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
            title: `タイトル${i}`,
            cwd: `C:/synthetic/proj-${i}`,
            updatedAt: new Date(FIXED_NOW_MS - i * 60_000).toISOString(),
          }),
        );
        useSessionStore.setState({ sessions: manySessions });

        const { container } = render(<ListView />);
        const firstRow = container.querySelector('[data-row-index="0"]') as Element;

        // End キーで index 499 にフォーカス。offset が固定 0 のまま（jsdom に実スクロールが
        // 無い）ため対象行は描画範囲に入らず、tryFocus はどちらの試行でも見つけられない。
        fireEvent.keyDown(firstRow, { key: "End" });

        await new Promise((resolve) => setTimeout(resolve, 50));
        // さらに待っても増え続けない（2回で本当に打ち切られている）ことを確認する。
        const countAfterFirstWait = rafCallCount;
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(countAfterFirstWait).toBe(2);
        expect(rafCallCount).toBe(2);
        expect(focusSpy).not.toHaveBeenCalled();
      } finally {
        rafSpy.mockRestore();
        focusSpy.mockRestore();
      }
    });
  });
});
