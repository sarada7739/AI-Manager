// 指示入力欄（無効表示）。第 1 段階では送信経路が未確認のため、常に disabled で表示する
// （F-7 / T-025）。props は持たずストアを直接購読する。
import { useMemo } from "react";
import { shortenPath } from "../../../shared/format.js";
import { Button, Dot } from "../../components/index.js";
import { selectFolderOptions } from "../../store/selectors.js";
import { useSessionStore } from "../../store/useSessionStore.js";
import styles from "./ComposeBox.module.css";

/** 「送る」ボタン無効時の理由（タスクカード指定の文言）。 */
const DISABLED_REASON = "第 1 段階では送信経路が未確認のため無効です（ADR 承認後に有効化）";

/**
 * 指示入力欄（props なし）。テキストエリア・アカウントピル・フォルダセレクト・送るボタンを
 * すべて disabled で表示する。`readOnly` の値には関わらず、第 1 段階では常に無効。
 */
export function ComposeBox() {
  const accounts = useSessionStore((state) => state.accounts);
  const sessions = useSessionStore((state) => state.sessions);

  // selectors.ts の関数は毎回新しい配列を返すため、sessions が変わったときだけ計算し直す
  // （store/selectors.ts のコメント・FilterBar.tsx と同じ使い方）。
  const folderOptionsList = useMemo(
    () =>
      selectFolderOptions({ ...useSessionStore.getState(), sessions }).filter(
        (option) => option.folder !== "",
      ),
    [sessions],
  );

  return (
    <section data-feature="compose" aria-label="指示入力" className={styles.compose}>
      <textarea
        aria-label="指示"
        placeholder="ここに指示を書く（第 1 段階では無効）"
        disabled
        rows={2}
        className={styles.textarea}
      />
      <div className={styles.row}>
        {accounts.length > 0 ? (
          <div className={styles.accountPills}>
            {/* 送信不可の第 1 段階では操作できないため、Pill（button）ではなく非対話の span で表示する
                （DESIGN.md §6.3 の輪郭ピルの見た目だけをローカル CSS で再現）。 */}
            {accounts.map((account) => (
              <span key={account.key} className={styles.accountPill}>
                <Dot state={account.running ? "running" : "idle"} />
                {account.label}
              </span>
            ))}
          </div>
        ) : null}

        <select aria-label="フォルダ" className={styles.select} disabled defaultValue="">
          <option value="">フォルダ ▾</option>
          {folderOptionsList.map((option) => (
            <option key={option.folder} value={option.folder}>
              {shortenPath(option.folder, "")}
            </option>
          ))}
        </select>

        <Button variant="primary" disabled reason={DISABLED_REASON}>
          送る
        </Button>
      </div>
    </section>
  );
}
