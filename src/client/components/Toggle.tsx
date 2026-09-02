// ラベル付きトグルスイッチ。role="switch" + キーボード操作対応（DESIGN.md §6.5）。
import { type KeyboardEvent, useId } from "react";
import styles from "./Toggle.module.css";

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
}

/** OFF: surface-3 地 + text-3 ノブ。ON: signal-dim 地 + signal ノブ。ラベルは必ず横に置く（DESIGN.md §6.5）。 */
export function Toggle({ label, checked, onChange, disabled = false, id }: ToggleProps) {
  const generatedId = useId();
  const toggleId = id ?? generatedId;

  const toggle = () => {
    if (disabled) {
      return;
    }
    onChange(!checked);
  };

  // Space / Enter で切替。button の click に加えて明示的に処理する。
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      toggle();
    }
  };

  return (
    <span className={styles.wrapper}>
      <button
        type="button"
        role="switch"
        id={toggleId}
        aria-checked={checked}
        disabled={disabled}
        className={`${styles.track} ${checked ? styles.on : ""}`}
        onClick={toggle}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.knob} />
      </button>
      <label htmlFor={toggleId} className={styles.label}>
        {label}
      </label>
    </span>
  );
}
