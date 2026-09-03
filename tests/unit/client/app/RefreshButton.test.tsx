// T-020 受け入れ条件:
// 「ヘッダ帯に…[更新] ghost ボタン」の RefreshButton 単体の振る舞いを検証する。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshButton } from "../../../../src/client/features/refresh/RefreshButton.js";
import { useSessionStore } from "../../../../src/client/store/useSessionStore.js";
import { DEFAULT_FILTERS, DEFAULT_SORT } from "../../../../src/shared/grouping.js";

/** 既定インスタンス useSessionStore を初期状態に戻す。 */
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
  vi.unstubAllGlobals();
});

describe("RefreshButton", () => {
  it("『更新』という文字列の ghost ボタンとして描画される", () => {
    render(<RefreshButton />);
    expect(screen.getByRole("button", { name: "更新" })).toBeInTheDocument();
  });

  it("クリックで store の refresh が呼ばれる", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useSessionStore.setState({ refresh });
    render(<RefreshButton />);

    fireEvent.click(screen.getByRole("button", { name: "更新" }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("status.loading が false のとき aria-disabled は false", () => {
    useSessionStore.setState({
      status: { loading: false, error: null, lastFetchedAt: null, live: false },
    });
    render(<RefreshButton />);
    expect(screen.getByRole("button", { name: "更新" })).toHaveAttribute("aria-disabled", "false");
  });

  it("status.loading が true のとき aria-disabled='true' になる", () => {
    useSessionStore.setState({
      status: { loading: true, error: null, lastFetchedAt: null, live: false },
    });
    render(<RefreshButton />);
    expect(screen.getByRole("button", { name: "更新" })).toHaveAttribute("aria-disabled", "true");
  });

  it("status.loading が true のときクリックしても refresh は呼ばれない", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useSessionStore.setState({
      refresh,
      status: { loading: true, error: null, lastFetchedAt: null, live: false },
    });
    render(<RefreshButton />);

    fireEvent.click(screen.getByRole("button", { name: "更新" }));

    expect(refresh).not.toHaveBeenCalled();
  });
});
