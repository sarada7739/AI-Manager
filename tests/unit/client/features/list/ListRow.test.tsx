// T-024 受け入れ条件（ListRow）:
// 「列: 状態（ドット）/ 種別（ピル）/ タイトル / 最終メッセージ / フォルダ（等幅・先頭省略）/ ブランチ / サイズ / 最終更新」
// 「行クリック / Enter で select。選択行は背景 --color-surface-3」（選択状態の onSelect 呼び出し部分）
// 合成データのみ。UUID は 00000000-0000-4000-8000-00000000000N、cwd は C:/synthetic/... を使う。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListRow } from "../../../../../src/client/features/list/ListRow.js";
import { formatBytes, shortenPath, truncateStart } from "../../../../../src/shared/format.js";
import { formatRelative } from "../../../../../src/shared/time.js";
import type { SessionSummary } from "../../../../../src/shared/types.js";

/** 固定の基準時刻（`formatRelative` の nowMs）。 */
const NOW_MS = Date.parse("2026-09-03T12:00:00.000Z");

/** 合成セッション（CLAUDE.md の指定どおり UUID / cwd を合成データにする）。 */
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

describe("ListRow", () => {
  it("8 セル（role=gridcell が 8 個）を持つ", () => {
    render(
      <ListRow
        session={makeSession()}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    expect(screen.getAllByRole("gridcell")).toHaveLength(8);
  });

  it.each([
    ["running", "稼働中"],
    ["active", "作業中"],
    ["idle", "停止"],
    ["error", "エラー"],
  ] as const)("状態 %s のとき Dot の aria-label が『%s』になる", (state, label) => {
    render(
      <ListRow
        session={makeSession({ state })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
  });

  it("種別が claude のとき Pill に『Claude』が表示される", () => {
    render(
      <ListRow
        session={makeSession({ tool: "claude" })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    expect(screen.getByText("Claude")).toBeInTheDocument();
  });

  it("種別が codex のとき Pill に『Codex』が表示される", () => {
    render(
      <ListRow
        session={makeSession({ tool: "codex", key: "codex:00000000-0000-4000-8000-000000000002" })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    expect(screen.getByText("Codex")).toBeInTheDocument();
  });

  it("タイトルがそのまま表示される", () => {
    render(
      <ListRow
        session={makeSession({ title: "合成タイトルXYZ" })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    expect(screen.getByText("合成タイトルXYZ")).toBeInTheDocument();
  });

  it("最終メッセージがそのまま表示される", () => {
    render(
      <ListRow
        session={makeSession({ lastMessage: "合成の最終メッセージXYZ" })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    expect(screen.getByText("合成の最終メッセージXYZ")).toBeInTheDocument();
  });

  it("フォルダは truncateStart(shortenPath(cwd, homeDir)) の結果と一致する（先頭省略）", () => {
    const cwd = "C:/synthetic/a/very/long/path/that/should/be/truncated/from/the/start/project";
    const expected = truncateStart(shortenPath(cwd, ""), 32);
    // 実装（ListRow.tsx）の FOLDER_MAX_CHARS と同じ 32 を使う前提のテスト。
    expect(expected.startsWith("…")).toBe(true);
    render(
      <ListRow
        session={makeSession({ cwd })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("ブランチが null のとき『—』が表示される", () => {
    render(
      <ListRow
        session={makeSession({ branch: null })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("ブランチが空文字のとき『—』が表示される（normalizeBranch 経由）", () => {
    render(
      <ListRow
        session={makeSession({ branch: "" })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("ブランチがある場合はそのまま表示される", () => {
    render(
      <ListRow
        session={makeSession({ branch: "feature/synthetic" })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    expect(screen.getByText("feature/synthetic")).toBeInTheDocument();
  });

  it("サイズは formatBytes(logSizeBytes) の結果と一致する", () => {
    const logSizeBytes = 2 * 1024 * 1024;
    const expected = formatBytes(logSizeBytes);
    render(
      <ListRow
        session={makeSession({ logSizeBytes })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("最終更新は formatRelative(updatedAt, nowMs) の結果と一致する", () => {
    const updatedAt = "2026-09-03T10:00:00.000Z";
    const expected = formatRelative(updatedAt, NOW_MS);
    render(
      <ListRow
        session={makeSession({ updatedAt })}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("クリックで onSelect(key) が呼ばれる", () => {
    const onSelect = vi.fn();
    const session = makeSession();
    const { container } = render(
      <ListRow
        session={session}
        selected={false}
        nowMs={NOW_MS}
        onSelect={onSelect}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    const row = container.querySelector('[data-row-index="0"]') as Element;
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(session.key);
  });

  it("Enter キーで onSelect(key) が呼ばれる", () => {
    const onSelect = vi.fn();
    const session = makeSession();
    const { container } = render(
      <ListRow
        session={session}
        selected={false}
        nowMs={NOW_MS}
        onSelect={onSelect}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    const row = container.querySelector('[data-row-index="0"]') as Element;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(session.key);
  });

  it("Space キーで onSelect(key) が呼ばれる", () => {
    const onSelect = vi.fn();
    const session = makeSession();
    const { container } = render(
      <ListRow
        session={session}
        selected={false}
        nowMs={NOW_MS}
        onSelect={onSelect}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    const row = container.querySelector('[data-row-index="0"]') as Element;
    fireEvent.keyDown(row, { key: " " });
    expect(onSelect).toHaveBeenCalledWith(session.key);
  });

  it("それ以外のキー（ArrowDown）は onKeyDown に委譲され onSelect は呼ばれない", () => {
    const onSelect = vi.fn();
    const onKeyDown = vi.fn();
    const { container } = render(
      <ListRow
        session={makeSession()}
        selected={false}
        nowMs={NOW_MS}
        onSelect={onSelect}
        rowIndex={0}
        tabIndex={0}
        onKeyDown={onKeyDown}
        virtualOffset={0}
      />,
    );
    const row = container.querySelector('[data-row-index="0"]') as Element;
    fireEvent.keyDown(row, { key: "ArrowDown" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onKeyDown).toHaveBeenCalled();
  });

  it("selected props に aria-selected が追従する", () => {
    const { container, rerender } = render(
      <ListRow
        session={makeSession()}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    const row = container.querySelector('[data-row-index="0"]') as Element;
    expect(row).toHaveAttribute("aria-selected", "false");

    rerender(
      <ListRow
        session={makeSession()}
        selected={true}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    expect(row).toHaveAttribute("aria-selected", "true");
  });

  it("tabIndex props に追従する", () => {
    const { container, rerender } = render(
      <ListRow
        session={makeSession()}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={0}
      />,
    );
    const row = container.querySelector('[data-row-index="0"]') as Element;
    expect(row).toHaveAttribute("tabIndex", "0");

    rerender(
      <ListRow
        session={makeSession()}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={-1}
        virtualOffset={0}
      />,
    );
    expect(row).toHaveAttribute("tabIndex", "-1");
  });

  it("--virtual-offset が style に反映される", () => {
    const { container } = render(
      <ListRow
        session={makeSession()}
        selected={false}
        nowMs={NOW_MS}
        onSelect={() => {}}
        rowIndex={0}
        tabIndex={0}
        virtualOffset={72}
      />,
    );
    const row = container.querySelector('[data-row-index="0"]') as HTMLElement;
    expect(row.style.getPropertyValue("--virtual-offset")).toBe("72px");
  });
});
