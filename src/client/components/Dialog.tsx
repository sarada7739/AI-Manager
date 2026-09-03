// モーダルダイアログの共通コンポーネント（DESIGN.md §6.11 / ADR-0009）。
// 開いたら initialFocusRef（無ければ自身）へフォーカスし、Tab はダイアログ内で循環、
// Esc で onClose。閉じたら開く前にフォーカスされていた要素へ戻す。
import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import styles from "./Dialog.module.css";

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 開いたときに最初にフォーカスする要素。省略時はダイアログ自身にフォーカスする。 */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/** フォーカス対象にする要素の最低限のセレクタ。 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * モーダルダイアログ（DESIGN.md §6.11）。`role="dialog"` + `aria-modal="true"` + `aria-labelledby`。
 * `open` が false のときは何も描画しない。
 */
export function Dialog({ open, title, onClose, children, initialFocusRef }: DialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // 開いた瞬間にフォーカス元を記憶し initialFocusRef（無ければ自身）へフォーカスする。
  // クリーンアップは「閉じた瞬間」と「アンマウント時」の両方で走るため、そこで元の要素へ戻す。
  useEffect(() => {
    if (!open) {
      return;
    }
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = initialFocusRef?.current ?? dialogRef.current;
    target?.focus();

    return () => {
      previousFocusRef.current?.focus();
    };
  }, [open, initialFocusRef]);

  // Esc で閉じる。Tab / Shift+Tab はダイアログ内の focusable 要素で循環させる。
  useEffect(() => {
    if (!open) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        // モーダル表示中は背後の Esc 処理（詳細パネルを閉じてカードへフォーカスを戻す等）を
        // 走らせない。capture 段階で受けて伝播を止める（実機で競合を確認して修正）。
        event.stopPropagation();
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      event.stopPropagation();
      const container = dialogRef.current;
      if (container === null) {
        return;
      }
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !container.contains(active);

      if (event.shiftKey) {
        if (outside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (outside || active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    // capture 段階で登録し、bubble 段階の他リスナ（DetailPanel の Esc など）より先に処理する。
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
