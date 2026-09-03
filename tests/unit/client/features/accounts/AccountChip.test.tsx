// T-022 受け入れ条件（AccountChip）:
// 「accounts を AccountChip で横並び表示。ドット + 表示名 + 『稼働中 HH:mm〜』（startedAt、等幅）または『停止』」
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountChip } from "../../../../../src/client/features/accounts/AccountChip.js";
import type { Account } from "../../../../../src/shared/types.js";

// vitest.config.ts は globals: true を設定していないため自動 cleanup が働かない。明示的に行う。
afterEach(cleanup);

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

describe("AccountChip", () => {
  it("running: true かつ startedAt があるとき『稼働中』とローカル HH:mm、末尾の『〜』が表示される", () => {
    const startedAt = "2026-09-03T13:11:00.000Z";
    const expectedTime = new Intl.DateTimeFormat("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(startedAt));

    render(
      <AccountChip
        account={makeAccount({ running: true, startedAt, runningCount: 1 })}
        selected={false}
        onToggle={() => {}}
      />,
    );

    const normalized = screen.getByRole("button").textContent?.replace(/\s+/g, " ").trim();
    expect(normalized).toContain("稼働中");
    expect(normalized).toContain(expectedTime);
    expect(normalized).toContain("〜");
  });

  it("running: true かつ startedAt: null のとき『稼働中』のみが表示され、時刻・『〜』は出ない", () => {
    render(
      <AccountChip
        account={makeAccount({ running: true, startedAt: null })}
        selected={false}
        onToggle={() => {}}
      />,
    );
    const text = screen.getByRole("button").textContent ?? "";
    expect(text).toContain("稼働中");
    expect(text).not.toContain("〜");
  });

  it("running: false のとき『停止』が表示される", () => {
    render(
      <AccountChip
        account={makeAccount({ running: false, startedAt: null })}
        selected={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole("button").textContent).toContain("停止");
  });

  it("running: true のとき Dot の aria-label が『稼働中』になる", () => {
    render(
      <AccountChip
        account={makeAccount({ running: true, startedAt: null })}
        selected={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole("img", { name: "稼働中" })).toBeInTheDocument();
  });

  it("running: false のとき Dot の aria-label が『停止』になる", () => {
    render(
      <AccountChip
        account={makeAccount({ running: false })}
        selected={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole("img", { name: "停止" })).toBeInTheDocument();
  });

  it("aria-pressed が selected に追従する（selected: false → true）", () => {
    const { rerender } = render(
      <AccountChip account={makeAccount()} selected={false} onToggle={() => {}} />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");

    rerender(<AccountChip account={makeAccount()} selected={true} onToggle={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("クリックすると onToggle(account.key) が呼ばれる", () => {
    const onToggle = vi.fn();
    render(
      <AccountChip
        account={makeAccount({ key: "codex:openai" })}
        selected={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledWith("codex:openai");
  });

  it("表示名（label）が表示される", () => {
    render(
      <AccountChip
        account={makeAccount({ label: "Claude Desktop 1" })}
        selected={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("Claude Desktop 1")).toBeInTheDocument();
  });

  it("label に UUID を含む合成データを渡してもそのまま表示する（クライアントは加工しない）", () => {
    const label = "claude:00000000-0000-4000-8000-000000000001";
    render(<AccountChip account={makeAccount({ label })} selected={false} onToggle={() => {}} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
