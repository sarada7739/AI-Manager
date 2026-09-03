// T-022 受け入れ条件（AccountStrip）:
// 「右端に『Claude Code N  Codex N  稼働』の形式（中黒を使わない）」
// 「チップをクリックすると filters.accountKey がそのアカウントになる（再クリックで解除）。選択中は境界 --color-border-strong」
// 「アカウントが 0 件のとき『アカウント情報がありません。Claude Code を起動すると表示されます』」
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountStrip } from "../../../../../src/client/features/accounts/AccountStrip.js";
import { useSessionStore } from "../../../../../src/client/store/useSessionStore.js";
import { DEFAULT_FILTERS, DEFAULT_SORT } from "../../../../../src/shared/grouping.js";
import type { Account } from "../../../../../src/shared/types.js";

/** 合成データのみ（CLAUDE.md / タスクカードの指定）。 */
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

const desktopAccount = makeAccount({
  key: "claude:00000000-0000-4000-8000-000000000001",
  label: "Claude Desktop 1",
  running: true,
  runningCount: 1,
  sessionCount: 1,
  startedAt: "2026-09-03T13:11:00.000Z",
});

const cliAccount = makeAccount({
  key: "claude:cli",
  label: "Claude CLI",
  running: false,
  runningCount: 0,
  sessionCount: 2,
});

const codexAccount = makeAccount({
  key: "codex:openai",
  label: "Codex",
  tool: "codex",
  running: true,
  runningCount: 1,
  sessionCount: 1,
  startedAt: "2026-09-03T12:00:00.000Z",
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
  });
}

beforeEach(resetStore);
afterEach(() => {
  cleanup();
  resetStore();
});

describe("AccountStrip", () => {
  it("role=group と aria-label『アカウント』を持つ", () => {
    render(<AccountStrip />);
    expect(screen.getByRole("group", { name: "アカウント" })).toBeInTheDocument();
  });

  it("アカウントが 0 件のとき『アカウント情報がありません』『Claude Code を起動すると表示されます』が表示される", () => {
    render(<AccountStrip />);
    expect(screen.getByText("アカウント情報がありません")).toBeInTheDocument();
    expect(screen.getByText("Claude Code を起動すると表示されます")).toBeInTheDocument();
  });

  it("アカウントが 0 件のとき集計（Claude Code / Codex / 稼働）は表示されない", () => {
    render(<AccountStrip />);
    expect(screen.queryByText(/稼働$/)).not.toBeInTheDocument();
  });

  it("合成 3 件（claude desktop running 1, claude cli idle, codex running 1）で 3 チップが表示される", () => {
    useSessionStore.setState({ accounts: [desktopAccount, cliAccount, codexAccount] });
    render(<AccountStrip />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("集計『Claude Code 1』『Codex 1』『稼働』が表示され、中黒『・』を含まない", () => {
    useSessionStore.setState({ accounts: [desktopAccount, cliAccount, codexAccount] });
    const { container } = render(<AccountStrip />);
    const summaryText = container.textContent ?? "";
    expect(summaryText).toContain("Claude Code 1");
    expect(summaryText).toContain("Codex 1");
    expect(summaryText).toContain("稼働");
    expect(summaryText).not.toContain("・");
  });

  it("チップをクリックすると filters.accountKey がそのアカウントの key になる", () => {
    useSessionStore.setState({ accounts: [desktopAccount, cliAccount, codexAccount] });
    const { container } = render(<AccountStrip />);
    const cliButton = container.querySelector('[data-account-key="claude:cli"]');
    expect(cliButton).not.toBeNull();
    fireEvent.click(cliButton as Element);
    expect(useSessionStore.getState().filters.accountKey).toBe("claude:cli");
  });

  it("選択中のチップを再クリックすると filters.accountKey が null に戻る（解除）", () => {
    useSessionStore.setState({ accounts: [desktopAccount, cliAccount, codexAccount] });
    const { container } = render(<AccountStrip />);
    const cliButton = container.querySelector('[data-account-key="claude:cli"]') as Element;
    fireEvent.click(cliButton);
    expect(useSessionStore.getState().filters.accountKey).toBe("claude:cli");
    fireEvent.click(cliButton);
    expect(useSessionStore.getState().filters.accountKey).toBeNull();
  });

  it("filters.accountKey が一致するチップだけ aria-pressed=true になる", () => {
    useSessionStore.setState({
      accounts: [desktopAccount, cliAccount, codexAccount],
      filters: { ...DEFAULT_FILTERS, accountKey: "codex:openai" },
    });
    const { container } = render(<AccountStrip />);

    const codexButton = container.querySelector('[data-account-key="codex:openai"]');
    const cliButton = container.querySelector('[data-account-key="claude:cli"]');
    const desktopButton = container.querySelector(
      '[data-account-key="claude:00000000-0000-4000-8000-000000000001"]',
    );

    expect(codexButton).toHaveAttribute("aria-pressed", "true");
    expect(cliButton).toHaveAttribute("aria-pressed", "false");
    expect(desktopButton).toHaveAttribute("aria-pressed", "false");
  });
});
