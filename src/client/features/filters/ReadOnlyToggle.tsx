// 「読むだけ・送信はしない」トグル。既定 ON。OFF のときは第 1 段階では送信できない旨を隣に表示する
// （DESIGN.md §6.4 / F-8 / T-021）。
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
        <span className={styles.notice}>第 1 段階では送信できません（第 2 段階で対応予定）</span>
      )}
    </span>
  );
}
