// T-032 受け入れ条件（ComposeBox、DESIGN.md §6.11 / ADR-0009）:
// 「読み取り専用トグルが ON の間は送信できず、理由を隣に表示する」
// 「宛先は稼働中の Claude セッションだけ。selectedKey が稼働中 Claude なら追随」
// 「確認ダイアログに宛先（タイトル / フォルダ）/ 本文の先頭 200 文字を出し、『送る』だけを primary にする。
//   Esc で閉じる。フォーカスはダイアログに閉じ込める。閉じたら元のボタンへ戻る」
// 「送信結果（投函 / 失敗 / 送信中）を LiveStatus に出す」（LiveStatus.test.tsx 側で検証）
//
// apiClient.postMessage は vi.mock で差し替える（他のメソッドは実装のまま）。ストアは既定インスタンス
// useSessionStore を使い、beforeEach で初期状態に戻す。合成データのみ。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../../../../src/client/api/client.js";
import { ComposeBox } from "../../../../../src/client/features/compose/ComposeBox.js";
import { useSessionStore } from "../../../../../src/client/store/useSessionStore.js";
import { DEFAULT_FILTERS, DEFAULT_SORT } from "../../../../../src/shared/grouping.js";
import type { SessionSummary } from "../../../../../src/shared/types.js";

vi.mock("../../../../../src/client/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../src/client/api/client.js")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      postMessage: vi.fn(),
    },
  };
});

function postMessageMock() {
  return apiClient.postMessage as unknown as ReturnType<typeof vi.fn>;
}

const RUNNING_CLAUDE_KEY = "claude:00000000-0000-4000-8000-000000000001";
const RUNNING_CLAUDE_ID = "00000000-0000-4000-8000-000000000001";
const IDLE_CLAUDE_KEY = "claude:00000000-0000-4000-8000-000000000002";
const RUNNING_CODEX_KEY = "codex:00000000-0000-4000-8000-000000000003";

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    key: RUNNING_CLAUDE_KEY,
    tool: "claude",
    id: RUNNING_CLAUDE_ID,
    title: "合成タイトル",
    lastMessage: "合成メッセージ",
    lastRole: "assistant",
    cwd: "C:/synthetic/work",
    branch: "main",
    model: "synthetic-model",
    entrypoint: "cli",
    accountKey: "claude:cli",
    state: "running",
    stateReason: "process",
    pid: 1234,
    startedAt: "2026-01-01T00:00:00.000Z",
    firstAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    logSizeBytes: 100,
    subagentCount: 0,
    released: false,
    ...overrides,
  };
}

const RUNNING_CLAUDE = makeSession();
const IDLE_CLAUDE = makeSession({
  key: IDLE_CLAUDE_KEY,
  id: "00000000-0000-4000-8000-000000000002",
  title: "停止中の Claude",
  state: "idle",
  stateReason: "none",
  pid: null,
  startedAt: null,
});
const RUNNING_CODEX = makeSession({
  key: RUNNING_CODEX_KEY,
  tool: "codex",
  id: "00000000-0000-4000-8000-000000000003",
  title: "稼働中の Codex",
  state: "running",
});

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

beforeEach(() => {
  resetStore();
  postMessageMock().mockReset();
  postMessageMock().mockResolvedValue({
    ok: true,
    value: { ok: true, sentAt: "2026-01-01T00:00:00.000Z", note: "" },
  });
});

afterEach(() => {
  cleanup();
  resetStore();
  vi.restoreAllMocks();
});

describe("ComposeBox: 読み取り専用トグルが ON の間は送信できない", () => {
  it("readOnly ON（既定）ではテキストエリアは有効だが『送る』は aria-disabled で理由が表示される", () => {
    useSessionStore.setState({ sessions: [RUNNING_CLAUDE] });
    render(<ComposeBox />);

    const textarea = screen.getByLabelText("指示");
    expect(textarea).not.toBeDisabled();
    expect(textarea.tagName).toBe("TEXTAREA");

    const sendButton = screen.getByRole("button", { name: "送る" });
    expect(sendButton).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("読み取り専用です。送るにはトグルを OFF にしてください"),
    ).toBeInTheDocument();
  });

  it("フォルダセレクトやアカウントピルは表示されない（宛先セレクトのみ）", () => {
    useSessionStore.setState({ sessions: [RUNNING_CLAUDE] });
    render(<ComposeBox />);
    expect(screen.queryByLabelText("フォルダ")).not.toBeInTheDocument();
    expect(screen.getByLabelText("宛先")).toBeInTheDocument();
  });
});

describe("ComposeBox: 宛先は稼働中の Claude セッションだけ", () => {
  it("稼働中の Claude だけが宛先セレクトに並ぶ（idle の Claude / running の Codex は出ない）", () => {
    useSessionStore.setState({ sessions: [RUNNING_CLAUDE, IDLE_CLAUDE, RUNNING_CODEX] });
    render(<ComposeBox />);

    const select = screen.getByLabelText("宛先") as HTMLSelectElement;
    const optionTexts = Array.from(select.options).map((option) => option.textContent ?? "");
    expect(optionTexts.some((text) => text.includes(RUNNING_CLAUDE.title))).toBe(true);
    expect(optionTexts.some((text) => text.includes(IDLE_CLAUDE.title))).toBe(false);
    expect(optionTexts.some((text) => text.includes(RUNNING_CODEX.title))).toBe(false);
  });

  it("selectedKey が稼働中 Claude なら宛先セレクトで選択済みになる", () => {
    const other = makeSession({
      key: "claude:00000000-0000-4000-8000-000000000009",
      id: "00000000-0000-4000-8000-000000000009",
      title: "別の稼働中 Claude",
    });
    useSessionStore.setState({
      sessions: [RUNNING_CLAUDE, other],
      selectedKey: other.key,
    });
    render(<ComposeBox />);

    const select = screen.getByLabelText("宛先") as HTMLSelectElement;
    expect(select.value).toBe(other.key);
  });

  it("宛先が無いとき理由『稼働中の Claude セッションがありません』が表示される", () => {
    useSessionStore.setState({ readOnly: false, sessions: [IDLE_CLAUDE] });
    render(<ComposeBox />);
    // 同じ文言が宛先セレクトの唯一の option（プレースホルダ）と Button の理由表示の両方に出るため、
    // 件数と、理由表示側（button の aria-describedby が指す要素）の両方を確認する。
    const matches = screen.getAllByText("稼働中の Claude セッションがありません");
    expect(matches.length).toBe(2);
    const sendButton = screen.getByRole("button", { name: "送る" });
    const describedBy = sendButton.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const reasonElement = document.getElementById(describedBy as string);
    expect(reasonElement?.textContent).toBe("稼働中の Claude セッションがありません");
  });
});

describe("ComposeBox: 送る の有効化条件", () => {
  it("readOnly OFF + 宛先あり + 本文ありで『送る』が有効になる", () => {
    useSessionStore.setState({ readOnly: false, sessions: [RUNNING_CLAUDE] });
    render(<ComposeBox />);

    fireEvent.change(screen.getByLabelText("指示"), { target: { value: "本文あり" } });

    const sendButton = screen.getByRole("button", { name: "送る" });
    expect(sendButton).not.toHaveAttribute("aria-disabled", "true");
  });

  it("本文が空のとき理由『指示を入力してください』が表示される", () => {
    useSessionStore.setState({ readOnly: false, sessions: [RUNNING_CLAUDE] });
    render(<ComposeBox />);
    expect(screen.getByText("指示を入力してください")).toBeInTheDocument();
  });
});

describe("ComposeBox: 確認ダイアログ", () => {
  it("『送る』を押すとダイアログが開き、宛先（タイトル / フォルダ）と本文が表示される", () => {
    useSessionStore.setState({ readOnly: false, sessions: [RUNNING_CLAUDE] });
    render(<ComposeBox />);
    fireEvent.change(screen.getByLabelText("指示"), { target: { value: "短い本文" } });
    fireEvent.click(screen.getByRole("button", { name: "送る" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain(RUNNING_CLAUDE.title);
    expect(dialog.textContent).toContain("synthetic/work");
    expect(dialog.textContent).toContain("短い本文");
  });

  it("本文 250 文字なら確認ダイアログには先頭 200 文字 + 『…』が表示される", () => {
    useSessionStore.setState({ readOnly: false, sessions: [RUNNING_CLAUDE] });
    render(<ComposeBox />);
    const longText = "あ".repeat(250);
    fireEvent.change(screen.getByLabelText("指示"), { target: { value: longText } });
    fireEvent.click(screen.getByRole("button", { name: "送る" }));

    const dialog = screen.getByRole("dialog");
    const expectedPreview = `${"あ".repeat(200)}…`;
    expect(dialog.textContent).toContain(expectedPreview);
    expect(dialog.textContent).not.toContain("あ".repeat(201));
  });

  it("ダイアログの『キャンセル』で閉じ、sendMessage（postMessage）は呼ばれない", () => {
    useSessionStore.setState({ readOnly: false, sessions: [RUNNING_CLAUDE] });
    render(<ComposeBox />);
    fireEvent.change(screen.getByLabelText("指示"), { target: { value: "本文" } });
    fireEvent.click(screen.getByRole("button", { name: "送る" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(postMessageMock()).not.toHaveBeenCalled();
  });

  it("Esc で閉じ、sendMessage（postMessage）は呼ばれない", () => {
    useSessionStore.setState({ readOnly: false, sessions: [RUNNING_CLAUDE] });
    render(<ComposeBox />);
    fireEvent.change(screen.getByLabelText("指示"), { target: { value: "本文" } });
    fireEvent.click(screen.getByRole("button", { name: "送る" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(postMessageMock()).not.toHaveBeenCalled();
  });

  it("ダイアログの『送る』で sendMessage(key, text) 相当の postMessage が呼ばれ、成功後にテキストエリアが空になり宛先は保持される", async () => {
    useSessionStore.setState({ readOnly: false, sessions: [RUNNING_CLAUDE] });
    render(<ComposeBox />);
    fireEvent.change(screen.getByLabelText("指示"), { target: { value: "送信する本文" } });
    fireEvent.click(screen.getByRole("button", { name: "送る" }));

    const confirmButtons = screen.getAllByRole("button", { name: "送る" });
    const confirmButton = confirmButtons[confirmButtons.length - 1] as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(confirmButton);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(postMessageMock()).toHaveBeenCalledWith("claude", RUNNING_CLAUDE_ID, "送信する本文");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    const textarea = screen.getByLabelText("指示") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
    const select = screen.getByLabelText("宛先") as HTMLSelectElement;
    expect(select.value).toBe(RUNNING_CLAUDE_KEY);
  });

  it("送信失敗時はテキストエリアの本文が残る", async () => {
    postMessageMock().mockReset();
    postMessageMock().mockResolvedValue({
      ok: false,
      error: {
        code: "http_500",
        message: "送信に失敗しました。",
        hint: "時間をおいて再試行してください。",
      },
    });
    useSessionStore.setState({ readOnly: false, sessions: [RUNNING_CLAUDE] });
    render(<ComposeBox />);
    fireEvent.change(screen.getByLabelText("指示"), { target: { value: "失敗する本文" } });
    fireEvent.click(screen.getByRole("button", { name: "送る" }));

    const confirmButtons = screen.getAllByRole("button", { name: "送る" });
    const confirmButton = confirmButtons[confirmButtons.length - 1] as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(confirmButton);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    const textarea = screen.getByLabelText("指示") as HTMLTextAreaElement;
    expect(textarea.value).toBe("失敗する本文");
  });
});
