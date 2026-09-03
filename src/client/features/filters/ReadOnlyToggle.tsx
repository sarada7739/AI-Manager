// 「読むだけ・送信はしない」トグル。既定 ON。OFF のときは送信できる旨を隣に表示する
// （DESIGN.md §6.4 / F-8 / ADR-0009 / T-032）。
import { Toggle } from "../../components/index.js";
import { useSessionStore } from "../../store/useSessionStore.js";
import styles from "./ReadOnlyToggle.module.css";

/** readOnly をストアに反映するトグル。 */
export function ReadOnlyToggle() {
  const readOnly = useSessionStore((state) => state.readOnly);
  const setReadOnly = useSessionStore((state) => state.setReadOnly);

  return (
    <span className={styles.wrapper}>
      <Toggle label="読むだけ・送信はしない" checked={readOnly} onChange={setReadOnly} />
      {readOnly ? null : (
        <span className={styles.notice}>送信できます（送る前に確認が出ます）</span>
      )}
    </span>
  );
}
