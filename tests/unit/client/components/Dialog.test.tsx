// T-032 受け入れ条件（Dialog、DESIGN.md §6.11 / ADR-0009）:
// 「Dialog: role="dialog" + aria-modal="true" + aria-labelledby。open=false のときは何も描画しない。
//   開いたら initialFocusRef（無ければ自身）へフォーカスし、Tab はダイアログ内で循環、
//   Esc で onClose。閉じたら開く前にフォーカスされていた要素へ戻す」
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type RefObject, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../../../../src/client/components/Dialog.js";

afterEach(() => {
  cleanup();
});

/** Dialog を開くトリガーボタン + Dialog 本体を持つ静的なラッパ（open は props で固定）。 */
function StaticHarness({
  open,
  onClose,
  useInitialFocus = false,
}: {
  open: boolean;
  onClose: () => void;
  useInitialFocus?: boolean;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  return (
    <div>
      <button type="button" data-testid="trigger">
        トリガー
      </button>
      <Dialog
        open={open}
        title="確認"
        onClose={onClose}
        initialFocusRef={useInitialFocus ? confirmRef : undefined}
      >
        <button type="button" data-testid="cancel">
          キャンセル
        </button>
        <button type="button" ref={confirmRef} data-testid="confirm">
          送る
        </button>
      </Dialog>
    </div>
  );
}

describe("Dialog: open=false のとき何も描画しない", () => {
  it("role=dialog が存在しない", () => {
    render(<StaticHarness open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Dialog: 開いたときのロール・ラベル", () => {
  it('role="dialog" + aria-modal="true" + aria-labelledby が見出しを指す', () => {
    render(<StaticHarness open={true} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).not.toBeNull();
    const heading = document.getElementById(labelledBy as string);
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("確認");
    expect(heading?.tagName).toBe("H2");
  });
});

describe("Dialog: 初期フォーカス", () => {
  it("initialFocusRef が無い場合はダイアログ自身にフォーカスする", () => {
    render(<StaticHarness open={true} onClose={() => {}} useInitialFocus={false} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("initialFocusRef がある場合はその要素にフォーカスする", () => {
    render(<StaticHarness open={true} onClose={() => {}} useInitialFocus={true} />);
    expect(document.activeElement).toBe(screen.getByTestId("confirm"));
  });
});

describe("Dialog: Tab の循環", () => {
  it("末尾要素で Tab を押すと先頭要素へ循環する", () => {
    render(<StaticHarness open={true} onClose={() => {}} useInitialFocus={true} />);
    const confirm = screen.getByTestId("confirm");
    const cancel = screen.getByTestId("cancel");
    confirm.focus();
    expect(document.activeElement).toBe(confirm);

    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
  });

  it("先頭要素で Shift+Tab を押すと末尾要素へ循環する", () => {
    render(<StaticHarness open={true} onClose={() => {}} useInitialFocus={true} />);
    const confirm = screen.getByTestId("confirm");
    const cancel = screen.getByTestId("cancel");
    cancel.focus();
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });
});

describe("Dialog: Esc で閉じる", () => {
  it("Esc キーで onClose が呼ばれる", () => {
    const onClose = vi.fn();
    render(<StaticHarness open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("open=false のときは Esc を押しても onClose は呼ばれない（リスナーが外れている）", () => {
    const onClose = vi.fn();
    render(<StaticHarness open={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Dialog: キーイベントの伝播（capture + stopPropagation。背後の Esc ハンドラとの二重発火防止）", () => {
  it("Escape は capture 段階で止められ、後から登録した bubble リスナ（例: DetailPanel の Esc）は呼ばれない", () => {
    const onClose = vi.fn();
    const bubbleListener = vi.fn();
    render(<StaticHarness open={true} onClose={onClose} />);
    window.addEventListener("keydown", bubbleListener);

    try {
      fireEvent.keyDown(screen.getByTestId("cancel"), { key: "Escape" });

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(bubbleListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", bubbleListener);
    }
  });

  it("Tab も同様に bubble リスナへ伝播しない", () => {
    const onClose = vi.fn();
    const bubbleListener = vi.fn();
    render(<StaticHarness open={true} onClose={onClose} useInitialFocus={true} />);
    window.addEventListener("keydown", bubbleListener);

    try {
      fireEvent.keyDown(screen.getByTestId("confirm"), { key: "Tab" });

      expect(bubbleListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", bubbleListener);
    }
  });

  it("Escape / Tab 以外のキーは伝播を止めない（ダイアログ内テキスト入力を妨げない）", () => {
    const onClose = vi.fn();
    const bubbleListener = vi.fn();
    render(<StaticHarness open={true} onClose={onClose} />);
    window.addEventListener("keydown", bubbleListener);

    try {
      fireEvent.keyDown(screen.getByTestId("cancel"), { key: "a" });

      expect(onClose).not.toHaveBeenCalled();
      expect(bubbleListener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", bubbleListener);
    }
  });
});

/** open/close を自身の state で切り替える、フォーカス往復検証用のラッパ。 */
function ControlledHarness({ initialOpen }: { initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const confirmRef: RefObject<HTMLButtonElement | null> = useRef(null);
  return (
    <div>
      <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
        トリガー
      </button>
      <Dialog open={open} title="確認" onClose={() => setOpen(false)} initialFocusRef={confirmRef}>
        <button type="button" data-testid="cancel" onClick={() => setOpen(false)}>
          キャンセル
        </button>
        <button type="button" ref={confirmRef} data-testid="confirm">
          送る
        </button>
      </Dialog>
    </div>
  );
}

describe("Dialog: 閉じたら開く前の要素にフォーカスが戻る", () => {
  it("トリガーからクリックで開いて Esc で閉じると、フォーカスがトリガーへ戻る", () => {
    render(<ControlledHarness initialOpen={false} />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("confirm"));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("キャンセルボタンで閉じてもフォーカスがトリガーへ戻る", () => {
    render(<ControlledHarness initialOpen={false} />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByTestId("cancel"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});
