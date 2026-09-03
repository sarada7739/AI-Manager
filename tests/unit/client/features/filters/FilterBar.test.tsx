// T-021 受け入れ条件（FilterBar）:
// 「並べ方 / 絞り込みセグメントが Pill.filter で切り替わりストアに反映される」
// 「アカウント・フォルダのセレクト、期間セレクト（1日 / 3日 / 1週間 / 2週間 / 1か月 / すべて）、
//   『稼働中だけ』チェック、フリーワード検索（300ms debounce）」
// 「『表示 N 件』を右端に出す。絞り込みで 0 件のとき『絞り込みを解除』リンクを出す」
// 「すべてキーボード操作可能」
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterBar } from "../../../../../src/client/features/filters/FilterBar.js";
import { useSessionStore } from "../../../../../src/client/store/useSessionStore.js";
import { DEFAULT_FILTERS, DEFAULT_SORT } from "../../../../../src/shared/grouping.js";
import type { Account, SessionSummary } from "../../../../../src/shared/types.js";

/** 合成データのみ（CLAUDE.md / タスクカードの指定）。updatedAt は既定 sinceDays: 14 で落ちないよう「たった今」にする。 */
function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    key: "claude:00000000-0000-4000-8000-000000000001",
    tool: "claude",
    id: "00000000-0000-4000-8000-000000000001",
    title: "タイトル",
    lastMessage: "最終メッセージ",
    lastRole: "assistant",
    cwd: "C:/synthetic/a",
    branch: null,
    model: "claude-sonnet-5",
    entrypoint: "cli",
    accountKey: "claude:cli",
    state: "idle",
    stateReason: "mtime",
    pid: null,
    startedAt: null,
    firstAt: null,
    updatedAt: new Date().toISOString(),
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

const cliAccount = makeAccount({ key: "claude:cli", label: "Claude CLI" });
const codexAccount = makeAccount({
  key: "codex:openai",
  label: "Codex",
  tool: "codex",
  running: true,
  runningCount: 1,
});

// フォルダ集計で a: 2 件、b: 1 件になるようにする（folderOptions は count 降順のため a が先頭）。
const sessionA1 = makeSession({
  key: "claude:00000000-0000-4000-8000-000000000001",
  id: "00000000-0000-4000-8000-000000000001",
  tool: "claude",
  accountKey: "claude:cli",
  cwd: "C:/synthetic/a",
  state: "idle",
});
const sessionA2 = makeSession({
  key: "claude:00000000-0000-4000-8000-000000000002",
  id: "00000000-0000-4000-8000-000000000002",
  tool: "claude",
  accountKey: "claude:cli",
  cwd: "C:/synthetic/a",
  state: "running",
});
const sessionB1 = makeSession({
  key: "codex:00000000-0000-4000-8000-000000000003",
  id: "00000000-0000-4000-8000-000000000003",
  tool: "codex",
  accountKey: "codex:openai",
  cwd: "C:/synthetic/b",
  state: "idle",
});

const THREE_SESSIONS = [sessionA1, sessionA2, sessionB1];
const THREE_ACCOUNTS = [cliAccount, codexAccount];

// レビュー指摘の回帰テスト用。アンマウントテストで setFilter を差し替えるため、元の実装を保持しておく。
const originalSetFilter = useSessionStore.getState().setFilter;

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
  vi.useRealTimers();
});

describe("FilterBar", () => {
  it("data-feature=filter-bar を持つ", () => {
    render(<FilterBar />);
    expect(document.querySelector('[data-feature="filter-bar"]')).toBeInTheDocument();
  });

  it("絞り込みセグメントに『すべて / Claude / Codex』の 3 ボタンがあり、既定は『すべて』が選択されている", () => {
    render(<FilterBar />);
    const group = screen.getByRole("group", { name: "絞り込み" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent)).toEqual(["すべて", "Claude", "Codex"]);
    expect(screen.getByRole("button", { name: "すべて" })).toHaveAttribute("aria-pressed", "true");
  });

  it("『Codex』ボタンをクリックすると filters.tool が codex になり aria-pressed が切り替わる", () => {
    render(<FilterBar />);
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(useSessionStore.getState().filters.tool).toBe("codex");
    expect(screen.getByRole("button", { name: "Codex" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "すべて" })).toHaveAttribute("aria-pressed", "false");
  });

  it("アカウントセレクトが accounts の label を option に持つ（先頭は『すべて』）", () => {
    useSessionStore.setState({ accounts: THREE_ACCOUNTS });
    render(<FilterBar />);
    const select = screen.getByLabelText("アカウント") as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((option) => option.textContent);
    expect(optionLabels).toEqual(["すべて", "Claude CLI", "Codex"]);
  });

  it("アカウントセレクトを選択すると filters.accountKey が反映され、『すべて』で null に戻る", () => {
    useSessionStore.setState({ accounts: THREE_ACCOUNTS });
    render(<FilterBar />);
    const select = screen.getByLabelText("アカウント") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "codex:openai" } });
    expect(useSessionStore.getState().filters.accountKey).toBe("codex:openai");
    fireEvent.change(select, { target: { value: "" } });
    expect(useSessionStore.getState().filters.accountKey).toBeNull();
  });

  it("フォルダセレクトが sessions の cwd から option を作る（count 降順で a が先頭）", () => {
    useSessionStore.setState({ sessions: THREE_SESSIONS });
    render(<FilterBar />);
    const select = screen.getByLabelText("フォルダ") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((option) => option.value);
    expect(optionValues).toEqual(["", "C:/synthetic/a", "C:/synthetic/b"]);
  });

  it("フォルダセレクトを選択すると filters.folder が反映される", () => {
    useSessionStore.setState({ sessions: THREE_SESSIONS });
    render(<FilterBar />);
    const select = screen.getByLabelText("フォルダ") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "C:/synthetic/b" } });
    expect(useSessionStore.getState().filters.folder).toBe("C:/synthetic/b");
  });

  it("期間セレクトに 6 つの選択肢（1日 / 3日 / 1週間 / 2週間 / 1か月 / すべて）がある", () => {
    render(<FilterBar />);
    const select = screen.getByLabelText("期間") as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((option) => option.textContent);
    expect(optionLabels).toEqual(["1日", "3日", "1週間", "2週間", "1か月", "すべて"]);
  });

  it("期間セレクトの既定値は sinceDays: 14（『2週間』）で、選択すると sinceDays が反映される。『すべて』は null になる", () => {
    render(<FilterBar />);
    const select = screen.getByLabelText("期間") as HTMLSelectElement;
    expect(select.value).toBe("14");
    fireEvent.change(select, { target: { value: "1" } });
    expect(useSessionStore.getState().filters.sinceDays).toBe(1);
    fireEvent.change(select, { target: { value: "" } });
    expect(useSessionStore.getState().filters.sinceDays).toBeNull();
  });

  it("『稼働中だけ』チェックボックスをオンにすると filters.runningOnly が true になる", () => {
    render(<FilterBar />);
    const checkbox = screen.getByLabelText("稼働中だけ") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(useSessionStore.getState().filters.runningOnly).toBe(true);
    expect(checkbox.checked).toBe(true);
  });

  it("検索欄に入力した直後は filters.query が変わらず、300ms 進めると反映される（debounce）", () => {
    vi.useFakeTimers();
    render(<FilterBar />);
    const input = screen.getByLabelText("検索") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    expect(useSessionStore.getState().filters.query).toBe("");
    vi.advanceTimersByTime(300);
    expect(useSessionStore.getState().filters.query).toBe("abc");
  });

  it("検索欄への連続入力は debounce により最後の値だけが反映される", () => {
    vi.useFakeTimers();
    render(<FilterBar />);
    const input = screen.getByLabelText("検索") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "a" } });
    vi.advanceTimersByTime(100);
    fireEvent.change(input, { target: { value: "ab" } });
    vi.advanceTimersByTime(100);
    fireEvent.change(input, { target: { value: "abc" } });
    expect(useSessionStore.getState().filters.query).toBe("");
    vi.advanceTimersByTime(300);
    expect(useSessionStore.getState().filters.query).toBe("abc");
  });

  it("検索欄で Enter を押すと debounce を待たずに即時反映される", () => {
    vi.useFakeTimers();
    render(<FilterBar />);
    const input = screen.getByLabelText("検索") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "xyz" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useSessionStore.getState().filters.query).toBe("xyz");
  });

  it("filters.query を外から setFilter({ query }) すると検索欄の表示値が追従する", () => {
    render(<FilterBar />);
    const input = screen.getByLabelText("検索") as HTMLInputElement;
    expect(input.value).toBe("");
    act(() => {
      useSessionStore.getState().setFilter({ query: "x" });
    });
    expect(input.value).toBe("x");
  });

  it("『表示 N 件』が selectFilteredSessions の件数を表示する（合成 3 件を tool=codex で絞ると 1 件）", () => {
    useSessionStore.setState({ sessions: THREE_SESSIONS, accounts: THREE_ACCOUNTS });
    render(<FilterBar />);
    expect(screen.getByText("表示 3 件")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(screen.getByText("表示 1 件")).toBeInTheDocument();
  });

  it("sessions があり絞り込みで 0 件のとき『絞り込みを解除』が表示され、クリックで filters が DEFAULT_FILTERS に戻る", () => {
    useSessionStore.setState({
      sessions: THREE_SESSIONS,
      accounts: THREE_ACCOUNTS,
      filters: { ...DEFAULT_FILTERS, accountKey: "no-such-account" },
    });
    render(<FilterBar />);
    expect(screen.getByText("表示 0 件")).toBeInTheDocument();
    const resetButton = screen.getByRole("button", { name: "絞り込みを解除" });
    expect(resetButton).toBeInTheDocument();
    fireEvent.click(resetButton);
    expect(useSessionStore.getState().filters).toEqual(DEFAULT_FILTERS);
  });

  it("sessions が 0 件のときは絞り込みを解除ボタンが表示されない", () => {
    useSessionStore.setState({ sessions: [], accounts: THREE_ACCOUNTS });
    render(<FilterBar />);
    expect(screen.getByText("表示 0 件")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "絞り込みを解除" })).not.toBeInTheDocument();
  });

  it("フォーカス可能な要素はすべて button / select / input のネイティブ要素である（role=switch も button タグ）", () => {
    useSessionStore.setState({ sessions: THREE_SESSIONS, accounts: THREE_ACCOUNTS });
    const { container } = render(<FilterBar />);
    const focusCandidates = Array.from(
      container.querySelectorAll<HTMLElement>("button, select, input, a, [tabindex]"),
    );
    // セグメント 4+3、セレクト 3、チェックボックス 1、検索欄 1、読み取り専用トグル 1 の最低数。
    expect(focusCandidates.length).toBeGreaterThanOrEqual(13);
    for (const el of focusCandidates) {
      expect(["BUTTON", "SELECT", "INPUT"]).toContain(el.tagName);
      expect(el.tabIndex).not.toBe(-1);
    }
  });

  // ここから REQUEST_CHANGES（BLOCKING 3件）の回帰テスト。実装反映前に走らせると失敗しうる。

  it("確定済みの query（非空）がある状態で追加入力し、debounce 保留中に resetFilters() が呼ばれると保留中のタイマーはキャンセルされ、古い値で query が上書きされない（Round 2 回帰）", () => {
    vi.useFakeTimers();
    // filters.query が実際に変化するケース（"zzz" → ""）でのみ保留タイマーが破棄されることを検証する。
    // 既定値 "" のまま resetFilters() しても query の値自体は変わらないため、そのケースは別の意味を持つ
    // （Round 1 の指摘はこちらの「非空 → リセット」のケースが本来の不具合だったため、シナリオを差し替えた）。
    useSessionStore.setState({ filters: { ...DEFAULT_FILTERS, query: "zzz" } });
    render(<FilterBar />);
    const input = screen.getByLabelText("検索") as HTMLInputElement;
    expect(input.value).toBe("zzz");
    fireEvent.change(input, { target: { value: "zzzz" } });
    vi.advanceTimersByTime(100);
    act(() => {
      useSessionStore.getState().resetFilters();
    });
    vi.advanceTimersByTime(300);
    expect(useSessionStore.getState().filters.query).toBe("");
    expect(input.value).toBe("");
  });

  it("検索の debounce 保留中に外部から setFilter({ query }) が呼ばれると保留中のタイマーはキャンセルされ、古い値で上書きされない（Round 1 回帰）", () => {
    vi.useFakeTimers();
    render(<FilterBar />);
    const input = screen.getByLabelText("検索") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    vi.advanceTimersByTime(100);
    act(() => {
      useSessionStore.getState().setFilter({ query: "x" });
    });
    vi.advanceTimersByTime(300);
    expect(useSessionStore.getState().filters.query).toBe("x");
    expect(input.value).toBe("x");
  });

  it("検索の debounce 保留中に filters.query 以外の setFilter（tool）が呼ばれても入力欄の値は保持され、300ms 後に打った文字で query が確定する（Round 2 回帰）", () => {
    vi.useFakeTimers();
    render(<FilterBar />);
    const input = screen.getByLabelText("検索") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    vi.advanceTimersByTime(100);
    act(() => {
      useSessionStore.getState().setFilter({ tool: "codex" });
    });
    expect(input.value).toBe("abc");
    vi.advanceTimersByTime(200);
    expect(useSessionStore.getState().filters.query).toBe("abc");
    expect(useSessionStore.getState().filters.tool).toBe("codex");
    expect(input.value).toBe("abc");
  });

  it("検索の debounce 保留中に sessions がストア更新（再取得相当）されても入力欄の値は保持され、300ms 後に打った文字で query が確定する（Round 2 回帰）", () => {
    vi.useFakeTimers();
    useSessionStore.setState({ sessions: THREE_SESSIONS, accounts: THREE_ACCOUNTS });
    render(<FilterBar />);
    const input = screen.getByLabelText("検索") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    vi.advanceTimersByTime(100);
    const refetchedSession = makeSession({
      key: "codex:00000000-0000-4000-8000-000000000005",
      id: "00000000-0000-4000-8000-000000000005",
      tool: "codex",
      accountKey: "codex:openai",
      cwd: "C:/synthetic/c",
      state: "idle",
    });
    act(() => {
      useSessionStore.setState({ sessions: [...THREE_SESSIONS, refetchedSession] });
    });
    expect(input.value).toBe("abc");
    vi.advanceTimersByTime(200);
    expect(useSessionStore.getState().filters.query).toBe("abc");
    expect(input.value).toBe("abc");
  });

  it("検索の debounce 保留中に setView('list') / setReadOnly(false) が呼ばれても入力欄の値は保持される（Round 2 回帰）", () => {
    vi.useFakeTimers();
    render(<FilterBar />);
    const input = screen.getByLabelText("検索") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    vi.advanceTimersByTime(100);
    act(() => {
      useSessionStore.getState().setView("list");
      useSessionStore.getState().setReadOnly(false);
    });
    expect(input.value).toBe("abc");
    vi.advanceTimersByTime(200);
    expect(useSessionStore.getState().filters.query).toBe("abc");
    expect(input.value).toBe("abc");
  });

  it("cwd が空文字のセッションはフォルダセレクトの option から除外される（BLOCKING 回帰）", () => {
    const emptyCwdSession = makeSession({
      key: "claude:00000000-0000-4000-8000-000000000004",
      id: "00000000-0000-4000-8000-000000000004",
      cwd: "",
    });
    useSessionStore.setState({ sessions: [sessionA1, emptyCwdSession] });
    render(<FilterBar />);
    const select = screen.getByLabelText("フォルダ") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((option) => option.value);
    expect(optionValues).toEqual(["", "C:/synthetic/a"]);
  });

  it("cwd が空文字のセッションだけのとき、フォルダセレクトの option は『すべて』の 1 件だけになる（BLOCKING 回帰）", () => {
    const emptyCwdSession = makeSession({
      key: "claude:00000000-0000-4000-8000-000000000004",
      id: "00000000-0000-4000-8000-000000000004",
      cwd: "",
    });
    useSessionStore.setState({ sessions: [emptyCwdSession] });
    render(<FilterBar />);
    const select = screen.getByLabelText("フォルダ") as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
    expect(select.options[0]?.textContent).toBe("すべて");
  });

  it("アンマウント時に保留中の debounce タイマーが破棄され、300ms 経過しても setFilter が呼ばれない", () => {
    vi.useFakeTimers();
    const setFilterSpy = vi.fn();
    useSessionStore.setState({ setFilter: setFilterSpy });
    try {
      const { unmount } = render(<FilterBar />);
      const input = screen.getByLabelText("検索") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "abc" } });
      unmount();
      vi.advanceTimersByTime(300);
      expect(setFilterSpy).not.toHaveBeenCalled();
    } finally {
      useSessionStore.setState({ setFilter: originalSetFilter });
    }
  });
});
