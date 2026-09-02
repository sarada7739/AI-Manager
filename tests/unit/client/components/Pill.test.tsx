// T-017: Pill コンポーネントの受け入れ条件を検証する。
// 「tool / state / filter の 3 種。輪郭のみ。filter は selected で背景変化」
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STATE_LABELS } from "../../../../src/client/components/Dot.js";
import { Pill } from "../../../../src/client/components/Pill.js";
import type { SessionState, ToolKind } from "../../../../src/shared/types.js";

// vitest.config.ts は globals: true を設定していないため自動 cleanup が働かない。明示的に行う。
afterEach(cleanup);

describe("Pill", () => {
  it.each<[ToolKind, string]>([
    ["claude", "Claude"],
    ["codex", "Codex"],
  ])("kind=tool tool=%s のとき data-kind=tool でラベル %s を表示する", (tool, label) => {
    render(<Pill kind="tool" tool={tool} />);
    const pill = screen.getByText(label);
    expect(pill).toHaveAttribute("data-kind", "tool");
  });

  it.each<SessionState>(["running", "active", "idle", "error"])(
    "kind=state state=%s のとき data-state=%s とラベルを表示する",
    (state) => {
      render(<Pill kind="state" state={state} />);
      const pill = screen.getByText(STATE_LABELS[state]);
      expect(pill).toHaveAttribute("data-kind", "state");
      expect(pill).toHaveAttribute("data-state", state);
    },
  );

  it("kind=filter selected=true のとき aria-pressed=true になる", () => {
    render(<Pill kind="filter" label="すべて" selected onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "すべて" });
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("kind=filter selected=false のとき aria-pressed=false になる", () => {
    render(<Pill kind="filter" label="すべて" selected={false} onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "すべて" });
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("kind=filter で type=button の <button> として描画される（data-kind=filter）", () => {
    render(<Pill kind="filter" label="Claude" selected={false} onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Claude" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-kind", "filter");
  });

  it("kind=filter をクリックすると onClick が呼ばれる", () => {
    const onClick = vi.fn();
    render(<Pill kind="filter" label="Codex" selected={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("kind=filter で onClick を渡さずクリックしても例外にならない", () => {
    render(<Pill kind="filter" label="絞り込みなし" selected={false} />);
    expect(() => {
      fireEvent.click(screen.getByRole("button", { name: "絞り込みなし" }));
    }).not.toThrow();
  });

  it("kind=filter label が空文字でも例外にならず button が描画される", () => {
    render(<Pill kind="filter" label="" selected={false} onClick={() => {}} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
