// T-023 受け入れ条件（SessionCard）:
// 「SessionCard が DESIGN.md §6.1 の 4 行構成。稼働中は左端バー。クリックで select、選択中は境界強調」
// 合成データのみ（CLAUDE.md / タスクカードの指定）。UUID は 00000000-0000-4000-8000-00000000000N、
// cwd は C:/synthetic/... を使う。nowMs は固定。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionCard } from "../../../../../src/client/features/board/SessionCard.js";
import { formatBytes, shortenPath, truncateStart } from "../../../../../src/shared/format.js";
import { formatRelative } from "../../../../../src/shared/time.js";
import type { SessionSummary } from "../../../../../src/shared/types.js";

/** フォルダ表示の最大文字数（SessionCard.tsx の FOLDER_MAX_CHARS と同じ）。 */
const FOLDER_MAX_CHARS = 40;

/** 固定の基準時刻。 */
const NOW_MS = Date.parse("2026-09-03T12:00:00.000Z");

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

afterEach(cleanup);

describe("SessionCard", () => {
  it("1 行目: ツールピルが claude のとき『Claude』が表示される", () => {
    render(
      <SessionCard
        session={makeSession({ tool: "claude" })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    expect(screen.getByText("Claude")).toBeInTheDocument();
  });

  it("1 行目: ツールピルが codex のとき『Codex』が表示される", () => {
    render(
      <SessionCard
        session={makeSession({ tool: "codex", key: "codex:00000000-0000-4000-8000-000000000002" })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    expect(screen.getByText("Codex")).toBeInTheDocument();
  });

  it.each([
    ["running", "稼働中"],
    ["active", "作業中"],
    ["idle", "停止"],
    ["error", "エラー"],
  ] as const)("1 行目: 状態 %s のとき Dot の aria-label が『%s』になる", (state, label) => {
    render(
      <SessionCard
        session={makeSession({ state })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
  });

  it("1 行目: 相対時刻が formatRelative(updatedAt, nowMs) と一致する", () => {
    const updatedAt = "2026-09-03T10:00:00.000Z";
    const expected = formatRelative(updatedAt, NOW_MS);
    render(
      <SessionCard
        session={makeSession({ updatedAt })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("2 行目: タイトルがそのまま表示される", () => {
    render(
      <SessionCard
        session={makeSession({ title: "合成タイトルXYZ" })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    expect(screen.getByText("合成タイトルXYZ")).toBeInTheDocument();
  });

  it("3 行目: 最終メッセージがそのまま表示される", () => {
    render(
      <SessionCard
        session={makeSession({ lastMessage: "合成の最終メッセージXYZ" })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    expect(screen.getByText("合成の最終メッセージXYZ")).toBeInTheDocument();
  });

  it('4 行目: フォルダは truncateStart(shortenPath(cwd, ""), 40) の結果と一致する（先頭省略）', () => {
    const cwd = "C:/synthetic/a/very/long/path/that/should/be/truncated/from/the/start/project";
    const expected = truncateStart(shortenPath(cwd, ""), FOLDER_MAX_CHARS);
    expect(expected.startsWith("…")).toBe(true);
    render(
      <SessionCard
        session={makeSession({ cwd })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("4 行目: ブランチが null のとき『—』が表示される", () => {
    render(
      <SessionCard
        session={makeSession({ branch: null })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("4 行目: ブランチがある場合はそのまま表示される", () => {
    render(
      <SessionCard
        session={makeSession({ branch: "feature/synthetic" })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    expect(screen.getByText("feature/synthetic")).toBeInTheDocument();
  });

  it("4 行目: ブランチが空文字のとき『—』が表示される（normalizeBranch 経由。レビュー指摘）", () => {
    render(
      <SessionCard
        session={makeSession({ branch: "" })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("lastMessage が空文字でも例外なく描画される", () => {
    expect(() =>
      render(
        <SessionCard
          session={makeSession({ lastMessage: "" })}
          selected={false}
          nowMs={NOW_MS}
          onSelect={() => {}}
          tabIndex={0}
        />,
      ),
    ).not.toThrow();
  });

  it("cwd が空文字でも例外なく描画される", () => {
    expect(() =>
      render(
        <SessionCard
          session={makeSession({ cwd: "" })}
          selected={false}
          nowMs={NOW_MS}
          onSelect={() => {}}
          tabIndex={0}
        />,
      ),
    ).not.toThrow();
  });

  it("4 行目: サイズは formatBytes(logSizeBytes) の結果と一致する", () => {
    const logSizeBytes = 2 * 1024 * 1024;
    const expected = formatBytes(logSizeBytes);
    render(
      <SessionCard
        session={makeSession({ logSizeBytes })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it.each(["running", "active", "idle", "error"] as const)(
    "data-state が state(%s) に一致する",
    (state) => {
      const { container } = render(
        <SessionCard
          session={makeSession({ state })}
          selected={false}
          nowMs={NOW_MS}
          onSelect={() => {}}
          tabIndex={0}
        />,
      );
      const card = container.querySelector("article") as Element;
      expect(card).toHaveAttribute("data-state", state);
    },
  );

  it("クリックで onSelect(key) が呼ばれる", () => {
    const onSelect = vi.fn();
    const session = makeSession();
    const { container } = render(
      <SessionCard
        session={session}
        selected={false}
        nowMs={NOW_MS}
        onSelect={onSelect}
        tabIndex={0}
      />,
    );
    const card = container.querySelector("article") as Element;
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(session.key);
  });

  it("Enter キーで onSelect(key) が呼ばれる", () => {
    const onSelect = vi.fn();
    const session = makeSession();
    const { container } = render(
      <SessionCard
        session={session}
        selected={false}
        nowMs={NOW_MS}
        onSelect={onSelect}
        tabIndex={0}
      />,
    );
    const card = container.querySelector("article") as Element;
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(session.key);
  });

  it("Space キーで onSelect(key) が呼ばれる", () => {
    const onSelect = vi.fn();
    const session = makeSession();
    const { container } = render(
      <SessionCard
        session={session}
        selected={false}
        nowMs={NOW_MS}
        onSelect={onSelect}
        tabIndex={0}
      />,
    );
    const card = container.querySelector("article") as Element;
    fireEvent.keyDown(card, { key: " " });
    expect(onSelect).toHaveBeenCalledWith(session.key);
  });

  it("それ以外のキー（ArrowDown）では onSelect は呼ばれない", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SessionCard
        session={makeSession()}
        selected={false}
        nowMs={NOW_MS}
        onSelect={onSelect}
        tabIndex={0}
      />,
    );
    const card = container.querySelector("article") as Element;
    fireEvent.keyDown(card, { key: "ArrowDown" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selected=true で data-selected="true" と aria-current="true" になる', () => {
    const { container } = render(
      <SessionCard
        session={makeSession()}
        selected={true}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    const card = container.querySelector("article") as Element;
    expect(card).toHaveAttribute("data-selected", "true");
    expect(card).toHaveAttribute("aria-current", "true");
  });

  it("selected=false のとき data-selected も aria-current も付かない", () => {
    const { container } = render(
      <SessionCard
        session={makeSession()}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    const card = container.querySelector("article") as Element;
    expect(card).not.toHaveAttribute("data-selected");
    expect(card).not.toHaveAttribute("aria-current");
  });

  it("tabIndex props に追従する", () => {
    const { container, rerender } = render(
      <SessionCard
        session={makeSession()}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    const card = container.querySelector("article") as Element;
    expect(card).toHaveAttribute("tabIndex", "0");

    rerender(
      <SessionCard
        session={makeSession()}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={-1}
      />,
    );
    expect(card).toHaveAttribute("tabIndex", "-1");
  });

  it("aria-label がタイトルと一致する", () => {
    const { container } = render(
      <SessionCard
        session={makeSession({ title: "合成タイトルAria" })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        tabIndex={0}
      />,
    );
    const card = container.querySelector("article") as Element;
    expect(card).toHaveAttribute("aria-label", "合成タイトルAria");
  });
});
