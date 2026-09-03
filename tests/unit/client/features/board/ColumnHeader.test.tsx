// T-023 受け入れ条件（ColumnHeader）:
// 「ColumnHeader にドット + 名前 + 件数（稼働があれば 1 稼働 / 40）。稼働列は下線が --color-signal」
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ColumnHeader } from "../../../../../src/client/features/board/ColumnHeader.js";
import type { SessionGroup } from "../../../../../src/shared/grouping.js";
import type { SessionSummary } from "../../../../../src/shared/types.js";

/**
 * 合成セッション 1 件分。ColumnHeader は sessions の件数（length）しか見ないが、
 * 型を欺く（null の配列を SessionSummary[] にキャストする）のではなく、CLAUDE.md /
 * タスクカードの指定どおり実データに近い合成 SessionSummary を渡す（レビュー指摘）。
 */
function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    key: "claude:00000000-0000-4000-8000-000000000001",
    tool: "claude",
    id: "00000000-0000-4000-8000-000000000001",
    title: "合成タイトル",
    lastMessage: "合成の最終メッセージ",
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

/** 指定件数分の合成セッション配列を作る（key/id だけ連番で変える）。 */
function makeSessions(count: number): SessionSummary[] {
  return Array.from({ length: count }, (_, i) => {
    const suffix = String(i + 1).padStart(12, "0");
    return makeSession({
      key: `claude:00000000-0000-4000-8000-${suffix}`,
      id: `00000000-0000-4000-8000-${suffix}`,
    });
  });
}

function makeGroup(overrides: Partial<SessionGroup> = {}): SessionGroup {
  return {
    key: "claude:00000000-0000-4000-8000-000000000001-normalized",
    label: "Claude Desktop 1",
    state: "idle",
    sessions: [],
    runningCount: 0,
    ...overrides,
  };
}

afterEach(cleanup);

describe("ColumnHeader", () => {
  it("<h2> 要素として描画される", () => {
    const { container } = render(<ColumnHeader group={makeGroup()} />);
    expect(container.querySelector("h2")).not.toBeNull();
  });

  it.each([
    ["running", "稼働中"],
    ["active", "作業中"],
    ["idle", "停止"],
    ["error", "エラー"],
  ] as const)("group.state が %s のとき Dot の aria-label が『%s』になる", (state, label) => {
    render(<ColumnHeader group={makeGroup({ state })} />);
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
  });

  it("group.label が表示され、group.key（別値）は表示されない", () => {
    const { container } = render(
      <ColumnHeader
        group={makeGroup({
          key: "claude:00000000-0000-4000-8000-000000000001-normalized",
          label: "Claude Desktop 1",
        })}
      />,
    );
    expect(screen.getByText("Claude Desktop 1")).toBeInTheDocument();
    expect(container.textContent).not.toContain(
      "claude:00000000-0000-4000-8000-000000000001-normalized",
    );
  });

  it("runningCount > 0 のとき『2 稼働 / 40』形式（『稼働』と『/』を含む）で表示される", () => {
    const { container } = render(
      <ColumnHeader group={makeGroup({ runningCount: 2, sessions: makeSessions(40) })} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("2");
    expect(text).toContain("稼働");
    expect(text).toContain("/");
    expect(text).toContain("40");
  });

  it("runningCount が 0 のときは総数のみが表示され『稼働』は含まれない", () => {
    const { container } = render(
      <ColumnHeader group={makeGroup({ runningCount: 0, sessions: makeSessions(5) })} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("5");
    expect(text).not.toContain("稼働");
  });

  it('runningCount > 0 のとき data-has-running="true" が付く', () => {
    const { container } = render(
      <ColumnHeader group={makeGroup({ runningCount: 1, sessions: makeSessions(1) })} />,
    );
    const header = container.querySelector("h2") as Element;
    expect(header).toHaveAttribute("data-has-running", "true");
  });

  it("runningCount が 0 のとき data-has-running が付かない", () => {
    const { container } = render(<ColumnHeader group={makeGroup({ runningCount: 0 })} />);
    const header = container.querySelector("h2") as Element;
    expect(header).not.toHaveAttribute("data-has-running");
  });
});
