// T-021 受け入れ条件（ReadOnlyToggle）:
// 「『読むだけ・送信はしない』トグル（既定 ON）。OFF にすると隣に『第 1 段階では送信できません』を表示」
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReadOnlyToggle } from "../../../../../src/client/features/filters/ReadOnlyToggle.js";
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

describe("ReadOnlyToggle", () => {
  it("既定で aria-checked=true になる（readOnly の既定 ON）", () => {
    render(<ReadOnlyToggle />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("既定（ON）のとき『第 1 段階では送信できません』の注記は表示されない", () => {
    render(<ReadOnlyToggle />);
    expect(screen.queryByText(/第 1 段階では送信できません/)).not.toBeInTheDocument();
  });

  it("クリックすると getState().readOnly が false になり、注記『第 1 段階では送信できません』が表示される", () => {
    render(<ReadOnlyToggle />);
    fireEvent.click(screen.getByRole("switch"));
    expect(useSessionStore.getState().readOnly).toBe(false);
    expect(screen.getByText(/第 1 段階では送信できません/)).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("OFF から再クリックすると readOnly が true に戻り、注記が消える", () => {
    render(<ReadOnlyToggle />);
    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);
    expect(useSessionStore.getState().readOnly).toBe(false);
    fireEvent.click(toggle);
    expect(useSessionStore.getState().readOnly).toBe(true);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/第 1 段階では送信できません/)).not.toBeInTheDocument();
  });

  it("ストアの外側から readOnly を false にした場合も注記が表示される（表示はストア駆動）", () => {
    render(<ReadOnlyToggle />);
    act(() => {
      useSessionStore.setState({ readOnly: false });
    });
    expect(screen.getByText(/第 1 段階では送信できません/)).toBeInTheDocument();
  });
});
