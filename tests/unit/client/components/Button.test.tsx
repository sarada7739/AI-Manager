// T-017: Button コンポーネントの受け入れ条件を検証する。
// 「primary / ghost。disabled 時は reason を隣に表示し aria-disabled」
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../../../../src/client/components/Button.js";

// vitest.config.ts は globals: true を設定していないため自動 cleanup が働かない。明示的に行う。
afterEach(cleanup);

describe("Button", () => {
  it.each<["primary" | "ghost"]>([["primary"], ["ghost"]])(
    "variant=%s のとき <button> として描画され children が表示される",
    (variant) => {
      render(
        <Button variant={variant} onClick={() => {}}>
          送る
        </Button>,
      );
      expect(screen.getByRole("button", { name: "送る" })).toBeInTheDocument();
    },
  );

  it("クリックすると onClick が呼ばれる（disabled でない場合）", () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" onClick={onClick}>
        送る
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "送る" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disabled のとき aria-disabled=true になる", () => {
    render(
      <Button variant="primary" disabled onClick={() => {}}>
        送る
      </Button>,
    );
    expect(screen.getByRole("button", { name: "送る" })).toHaveAttribute("aria-disabled", "true");
  });

  it("disabled のときネイティブ disabled 属性は付かない", () => {
    render(
      <Button variant="primary" disabled onClick={() => {}}>
        送る
      </Button>,
    );
    expect(screen.getByRole("button", { name: "送る" })).not.toBeDisabled();
  });

  it("disabled のときクリックしても onClick が呼ばれない", () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" disabled onClick={onClick}>
        送る
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "送る" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled かつ reason 指定時、理由が表示され aria-describedby が理由要素の id を指す", () => {
    render(
      <Button variant="primary" disabled reason="送信経路が未確認です">
        送る
      </Button>,
    );
    const button = screen.getByRole("button", { name: "送る" });
    const reasonText = screen.getByText("送信経路が未確認です");
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(reasonText).toHaveAttribute("id", describedBy);
  });

  it("disabled でなければ reason を渡しても表示されない", () => {
    render(
      <Button variant="primary" reason="送信経路が未確認です">
        送る
      </Button>,
    );
    expect(screen.queryByText("送信経路が未確認です")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送る" })).not.toHaveAttribute("aria-describedby");
  });

  it("disabled だが reason 未指定なら理由要素も aria-describedby も無い", () => {
    render(
      <Button variant="primary" disabled>
        送る
      </Button>,
    );
    expect(screen.getByRole("button", { name: "送る" })).not.toHaveAttribute("aria-describedby");
  });

  it("type=submit を渡すと button の type 属性に反映される", () => {
    render(
      <Button variant="primary" type="submit">
        送る
      </Button>,
    );
    expect(screen.getByRole("button", { name: "送る" })).toHaveAttribute("type", "submit");
  });

  it("type を省略すると既定で type=button になる", () => {
    render(<Button variant="ghost">更新</Button>);
    expect(screen.getByRole("button", { name: "更新" })).toHaveAttribute("type", "button");
  });
});
