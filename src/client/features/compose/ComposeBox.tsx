// 指示入力欄。読み取り専用トグル OFF + 送信前の確認ダイアログの 2 段階でだけ送信できる
// （DESIGN.md §6.11、ADR-0009、F-7 / T-032）。props は持たずストアを直接購読する。
import { useEffect, useMemo, useRef, useState } from "react";
import { shortenPath, truncateStart } from "../../../shared/format.js";
import { Button, Dialog } from "../../components/index.js";
import { selectRunningClaudeSessions } from "../../store/selectors.js";
import { useSessionStore } from "../../store/useSessionStore.js";
import styles from "./ComposeBox.module.css";

/** フォルダ表示の最大文字数（board/list の SessionCard と同じ値）。 */
const FOLDER_MAX_CHARS = 40;

/** 確認ダイアログに出す本文プレビューの最大文字数（DESIGN.md §6.11）。 */
const PREVIEW_MAX_CHARS = 200;

/** セッションの「タイトル — フォルダ」表示ラベルを作る（DESIGN.md §6.11）。 */
function formatTargetLabel(session: { title: string; cwd: string }): string {
  const folder = truncateStart(shortenPath(session.cwd, ""), FOLDER_MAX_CHARS);
  return `${session.title} — ${folder}`;
}

/**
 * 指示入力欄（props なし）。宛先は稼働中の Claude セッションだけを列挙する。
 * 「送る」は確認ダイアログを経てから `sendMessage` を呼ぶ（2 段階）。
 */
export function ComposeBox() {
  const readOnly = useSessionStore((state) => state.readOnly);
  const selectedKey = useSessionStore((state) => state.selectedKey);
  const sessions = useSessionStore((state) => state.sessions);
  const sendState = useSessionStore((state) => state.send.state);
  const sendMessage = useSessionStore((state) => state.sendMessage);

  // selectors.ts の関数は毎回新しい配列を返すため、sessions が変わったときだけ計算し直す
  // （store/selectors.ts のコメント・FilterBar.tsx と同じ使い方）。
  const targets = useMemo(
    () => selectRunningClaudeSessions({ ...useSessionStore.getState(), sessions }),
    [sessions],
  );

  const [targetKey, setTargetKey] = useState("");
  const [text, setText] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const confirmSendRef = useRef<HTMLButtonElement | null>(null);

  // ボード / リストでの選択に追随する。選択中のセッションが稼働中 Claude ならそれを宛先にする。
  // それ以外（未選択・停止中・Codex 選択時など）は現在の宛先が候補に残っていればそのまま、
  // 無ければ先頭（無ければ空）にする。
  useEffect(() => {
    if (selectedKey !== null && targets.some((session) => session.key === selectedKey)) {
      setTargetKey(selectedKey);
      return;
    }
    setTargetKey((current) =>
      targets.some((session) => session.key === current) ? current : (targets[0]?.key ?? ""),
    );
  }, [selectedKey, targets]);

  const trimmedText = text.trim();
  const target = targets.find((session) => session.key === targetKey) ?? null;

  let disabledReason: string | undefined;
  if (readOnly) {
    disabledReason = "読み取り専用です。送るにはトグルを OFF にしてください";
  } else if (target === null) {
    disabledReason = "稼働中の Claude セッションがありません";
  } else if (trimmedText === "") {
    disabledReason = "指示を入力してください";
  } else if (sendState === "sending") {
    disabledReason = "送信中…";
  }

  const previewText =
    trimmedText.length > PREVIEW_MAX_CHARS
      ? `${trimmedText.slice(0, PREVIEW_MAX_CHARS)}…`
      : trimmedText;

  const handleConfirm = () => {
    if (target === null) {
      return;
    }
    void sendMessage(target.key, trimmedText).then(() => {
      setDialogOpen(false);
      // 成功（send.state === "sent"）のときだけ本文を空にする。宛先（targetKey）は保持する。
      // sendMessage は解決直後に idle へ戻すタイマーを仕掛けるだけなので、この時点ではまだ
      // "sent" / "error" のいずれかが確定している。
      if (useSessionStore.getState().send.state === "sent") {
        setText("");
      }
    });
  };

  return (
    <section data-feature="compose" aria-label="指示入力" className={styles.compose}>
      <textarea
        aria-label="指示"
        placeholder="ここに指示を書く"
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className={styles.textarea}
      />
      <div className={styles.row}>
        <select
          aria-label="宛先"
          className={styles.select}
          value={targetKey}
          onChange={(event) => setTargetKey(event.target.value)}
        >
          {targets.length === 0 ? (
            <option value="">稼働中の Claude セッションがありません</option>
          ) : null}
          {targets.map((session) => (
            <option key={session.key} value={session.key}>
              {formatTargetLabel(session)}
            </option>
          ))}
        </select>

        <Button
          variant="primary"
          disabled={disabledReason !== undefined}
          reason={disabledReason}
          onClick={() => setDialogOpen(true)}
        >
          送る
        </Button>
      </div>

      <Dialog
        open={dialogOpen}
        title="この指示を送りますか"
        onClose={() => setDialogOpen(false)}
        initialFocusRef={confirmSendRef}
      >
        <dl className={styles.confirmList}>
          <dt>宛先</dt>
          <dd>{target !== null ? formatTargetLabel(target) : "—"}</dd>
          <dt>本文</dt>
          <dd className={styles.preview}>{previewText}</dd>
        </dl>
        <p className={styles.note}>配信されるか保留されるかは受信側の設定に従います</p>
        <div className={styles.confirmActions}>
          <Button
            variant="ghost"
            disabled={sendState === "sending"}
            onClick={() => setDialogOpen(false)}
          >
            キャンセル
          </Button>
          {/* Button（components/）は ref を透過しないため、初期フォーカス対象にする必要がある
              確認ダイアログの「送る」だけは、DetailPanel の閉じるボタンと同様にネイティブ button で
              primary の見た目をローカル CSS で再現する。 */}
          <button
            ref={confirmSendRef}
            type="button"
            className={
              sendState === "sending"
                ? `${styles.primaryButton} ${styles.disabledButton}`
                : styles.primaryButton
            }
            aria-disabled={sendState === "sending"}
            onClick={sendState === "sending" ? undefined : handleConfirm}
          >
            送る
          </button>
        </div>
      </Dialog>
    </section>
  );
}
