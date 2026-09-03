// T-025 受け入れ条件（ComposeBox）:
// 「ComposeBox がテキストエリア + アカウントピル + フォルダセレクト + 『送る』primary ボタンを
//   disabled で表示し、理由『第 1 段階では送信経路が未確認のため無効です（ADR 承認後に有効化）』を出す」
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComposeBox } from "../../../../../src/client/features/compose/ComposeBox.js";
import { useSessionStore } from "../../../../../src/client/store/useSessionStore.js";
import { DEFAULT_FILTERS, DEFAULT_SORT } from "../../../../../src/shared/grouping.js";
import type { Account, SessionSummary } from "../../../../../src/shared/types.js";

const DISABLED_REASON = "第 1 段階では送信経路が未確認のため無効です（ADR 承認後に有効化）";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    key: "claude:00000000-0000-4000-8000-000000000001",
    label: "Claude Desktop 1",
    tool: "claude",
    running: true,
    runningCount: 1,
    sessionCount: 1,
    startedAt: "2026-09-03T13:11:00.000Z",
    ...overrides,
  };
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
    firstAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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

describe("ComposeBox", () => {
  it("aria-label『指示入力』の region として描画される", () => {
    render(<ComposeBox />);
    expect(screen.getByRole("region", { name: "指示入力" })).toBeInTheDocument();
  });

  it("テキストエリア（aria-label『指示』）が disabled で表示される", () => {
    render(<ComposeBox />);
    const textarea = screen.getByLabelText("指示");
    expect(textarea).toBeDisabled();
    expect(textarea.tagName).toBe("TEXTAREA");
  });

  it("フォルダセレクト（aria-label『フォルダ』）が disabled で表示される", () => {
    render(<ComposeBox />);
    const select = screen.getByLabelText("フォルダ");
    expect(select).toBeDisabled();
    expect(select.tagName).toBe("SELECT");
  });

  it("『送る』ボタンが primary かつ aria-disabled で、理由が隣に表示される", () => {
    render(<ComposeBox />);
    const sendButton = screen.getByRole("button", { name: "送る" });
    expect(sendButton).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(DISABLED_REASON)).toBeInTheDocument();
  });

  it("accounts が 0 件のときアカウントピルが表示されない（button は『送る』の 1 個だけ）", () => {
    render(<ComposeBox />);
    expect(screen.queryByText("Claude Desktop 1")).not.toBeInTheDocument();
    expect(document.querySelectorAll("button")).toHaveLength(1);
  });

  // レビュー指摘（BLOCKING）: アカウントピルは非対話要素（Dot + 表示名の <span>）であり、
  // button（role=button）ではない。クリックしても何も起きないため、送信につながる誤操作を防ぐ。
  it("accounts が 1 件以上のとき、そのラベルと Dot（role=img）でピルが表示され、button ではない", () => {
    useSessionStore.setState({ accounts: [makeAccount()] });
    render(<ComposeBox />);

    expect(screen.getByText("Claude Desktop 1")).toBeInTheDocument();
    // Dot は状態を role=img + aria-label（DESIGN.md §7）で示す。running なアカウントなので「稼働中」。
    expect(screen.getByRole("img", { name: "稼働中" })).toBeInTheDocument();

    // ピル自体は button ではない。ページ上の button は『送る』の 1 個だけ。
    expect(screen.queryByRole("button", { name: "Claude Desktop 1" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("button")).toHaveLength(1);
  });

  it("停止中のアカウントは Dot が『停止』の aria-label を持つ", () => {
    useSessionStore.setState({
      accounts: [makeAccount({ running: false, runningCount: 0, startedAt: null })],
    });
    render(<ComposeBox />);
    expect(screen.getByRole("img", { name: "停止" })).toBeInTheDocument();
  });

  it("フォルダ選択肢は sessions のフォルダから作られる（cwd を含む選択肢が出る）", () => {
    useSessionStore.setState({ sessions: [makeSession({ cwd: "C:/synthetic/work" })] });
    render(<ComposeBox />);
    const select = screen.getByLabelText("フォルダ") as HTMLSelectElement;
    const optionTexts = Array.from(select.options).map((option) => option.textContent ?? "");
    expect(optionTexts.some((text) => text.includes("synthetic/work"))).toBe(true);
  });
});
