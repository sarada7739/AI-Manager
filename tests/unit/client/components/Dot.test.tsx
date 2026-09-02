// T-017: Dot コンポーネントの受け入れ条件を検証する。
// 「state → 色 + 形 + aria-label。running ● / active ◐ / idle ○ / error ▲」
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dot, STATE_LABELS } from "../../../../src/client/components/Dot.js";
import type { SessionState } from "../../../../src/shared/types.js";

// vitest.config.ts は globals: true を設定していないため、@testing-library/react の
// 自動 cleanup（globalThis.afterEach 検出）が働かない。各テスト後に明示的に cleanup する。
afterEach(cleanup);

describe("Dot", () => {
  it("STATE_LABELS が 4 状態すべてのラベルを持つ（running=稼働中 / active=作業中 / idle=停止 / error=エラー）", () => {
    expect(STATE_LABELS.running).toBe("稼働中");
    expect(STATE_LABELS.active).toBe("作業中");
    expect(STATE_LABELS.idle).toBe("停止");
    expect(STATE_LABELS.error).toBe("エラー");
  });

  it.each<[SessionState, string]>([
    ["running", "稼働中"],
    ["active", "作業中"],
    ["idle", "停止"],
    ["error", "エラー"],
  ])("state=%s のとき role=img と aria-label=%s と data-state=%s を持つ", (state, label) => {
    render(<Dot state={state} />);
    const dot = screen.getByRole("img", { name: label });
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveAttribute("data-state", state);
  });

  it("className を渡すとルート要素に付与される", () => {
    render(<Dot state="running" className="extra-class" />);
    const dot = screen.getByRole("img", { name: STATE_LABELS.running });
    expect(dot).toHaveClass("extra-class");
  });

  it("4 状態それぞれで aria-label が重複せず一意である", () => {
    const labels = new Set(Object.values(STATE_LABELS));
    expect(labels.size).toBe(4);
  });
});
