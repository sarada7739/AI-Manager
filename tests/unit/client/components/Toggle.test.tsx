// T-017: Toggle コンポーネントの受け入れ条件を検証する。
// 「ラベル必須。aria-checked。キーボードで切替」
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toggle } from "../../../../src/client/components/Toggle.js";

// vitest.config.ts は globals: true を設定していないため自動 cleanup が働かない。明示的に行う。
afterEach(cleanup);

describe("Toggle", () => {
  it("role=switch で描画される", () => {
    render(<Toggle label="読むだけ・送信はしない" checked={false} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("checked=true のとき aria-checked=true になる", () => {
    render(<Toggle label="読むだけ・送信はしない" checked onChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("checked=false のとき aria-checked=false になる", () => {
    render(<Toggle label="読むだけ・送信はしない" checked={false} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("label が button に紐づく（getByLabelText でスイッチ button が取得できる）", () => {
    render(<Toggle label="読むだけ・送信はしない" checked={false} onChange={() => {}} />);
    const el = screen.getByLabelText("読むだけ・送信はしない");
    expect(el).toHaveAttribute("role", "switch");
  });

  it("クリックすると onChange(!checked) が呼ばれる", () => {
    const onChange = vi.fn();
    render(<Toggle label="ラベル" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("keyDown Space で onChange(!checked) が呼ばれる", () => {
    const onChange = vi.fn();
    render(<Toggle label="ラベル" checked={true} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("switch"), { key: " " });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("keyDown Enter で onChange(!checked) が呼ばれる", () => {
    const onChange = vi.fn();
    render(<Toggle label="ラベル" checked={false} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("switch"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("keyDown で他のキー（a）を押しても onChange は呼ばれない", () => {
    const onChange = vi.fn();
    render(<Toggle label="ラベル" checked={false} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("switch"), { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled のときクリックしても onChange が呼ばれない", () => {
    const onChange = vi.fn();
    render(<Toggle label="ラベル" checked={false} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled のとき keyDown Space / Enter を押しても onChange が呼ばれない", () => {
    const onChange = vi.fn();
    render(<Toggle label="ラベル" checked={false} onChange={onChange} disabled />);
    const el = screen.getByRole("switch");
    fireEvent.keyDown(el, { key: " " });
    fireEvent.keyDown(el, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("id を渡すとそれが button の id とラベルの htmlFor に使われる", () => {
    render(<Toggle label="ラベル" checked={false} onChange={() => {}} id="my-toggle-id" />);
    const el = screen.getByRole("switch");
    expect(el).toHaveAttribute("id", "my-toggle-id");
    expect(screen.getByLabelText("ラベル")).toBe(el);
  });

  it("空文字の label でも例外なく描画される", () => {
    expect(() => {
      render(<Toggle label="" checked={false} onChange={() => {}} />);
    }).not.toThrow();
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });
});
