// T-021 受け入れ条件（GroupBySegment）:
// 「『並べ方』セグメント（アカウント / フォルダ / 状態 / 種類）が Pill.filter で切り替わり、ストアに反映される」
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GroupBySegment } from "../../../../../src/client/features/filters/GroupBySegment.js";
import { useSessionStore } from "../../../../../src/client/store/useSessionStore.js";
import { DEFAULT_FILTERS, DEFAULT_SORT } from "../../../../../src/shared/grouping.js";

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

describe("GroupBySegment", () => {
  it("role=group と aria-label『並べ方』を持つ", () => {
    render(<GroupBySegment />);
    expect(screen.getByRole("group", { name: "並べ方" })).toBeInTheDocument();
  });

  it("『アカウント / フォルダ / 状態 / 種類』の 4 ボタンが表示される", () => {
    render(<GroupBySegment />);
    const group = screen.getByRole("group", { name: "並べ方" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent)).toEqual([
      "アカウント",
      "フォルダ",
      "状態",
      "種類",
    ]);
  });

  it("groupBy に応じて選択中のボタンだけ aria-pressed=true になる（既定 account）", () => {
    render(<GroupBySegment />);
    expect(screen.getByRole("button", { name: "アカウント" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "フォルダ" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "状態" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "種類" })).toHaveAttribute("aria-pressed", "false");
  });

  it("groupBy が folder のとき『フォルダ』ボタンだけ aria-pressed=true になる", () => {
    useSessionStore.setState({ groupBy: "folder" });
    render(<GroupBySegment />);
    expect(screen.getByRole("button", { name: "フォルダ" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "アカウント" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("『状態』ボタンをクリックすると getState().groupBy が state になる", () => {
    render(<GroupBySegment />);
    fireEvent.click(screen.getByRole("button", { name: "状態" }));
    expect(useSessionStore.getState().groupBy).toBe("state");
  });

  it("『種類』ボタンをクリックすると getState().groupBy が tool になる", () => {
    render(<GroupBySegment />);
    fireEvent.click(screen.getByRole("button", { name: "種類" }));
    expect(useSessionStore.getState().groupBy).toBe("tool");
  });

  it("4 ボタンすべてが <button> でありフォーカス可能（tabIndex が -1 でない）", () => {
    render(<GroupBySegment />);
    const group = screen.getByRole("group", { name: "並べ方" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.tabIndex).not.toBe(-1);
      expect(button).not.toBeDisabled();
    }
  });
});
