// セッション詳細パネル。props なし、ストアを直接購読する（F-5 / T-025）。
// DESIGN.md §5.3 のレイアウトに対応する。summary（作業ディレクトリ・ブランチ等）はストアの
// SessionSummary から即時表示し、recentMessages / parseWarnings だけ apiClient.getSession を待つ。
import { useEffect, useRef, useState } from "react";
import { formatBytes } from "../../../shared/format.js";
import type { SessionDetail, ToolKind } from "../../../shared/types.js";
import { type ApiErrorBody, apiClient } from "../../api/client.js";
import { Dot, ErrorBanner, Loading, Pill, STATE_LABELS } from "../../components/index.js";
import { selectSelectedSession } from "../../store/selectors.js";
import { useSessionStore } from "../../store/useSessionStore.js";
import styles from "./DetailPanel.module.css";

/** 直近メッセージ（recentMessages）取得の状態。selectedKey が変わるたびに作り直す。 */
type MessagesState =
  | { status: "loading" }
  | { status: "ok"; detail: SessionDetail }
  | { status: "error"; error: ApiErrorBody };

/** ロールラベル（DESIGN.md §5.3 の表示例に合わせ英字のまま出す）。 */
const ROLE_LABELS: Record<"user" | "assistant", string> = {
  user: "user",
  assistant: "assistant",
};

/** `tool` がセッションキーの想定どおり claude / codex のいずれかであることを確かめる型ガード。 */
function isToolKind(value: string): value is ToolKind {
  return value === "claude" || value === "codex";
}

/** 2 桁ゼロ埋め。 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/** 最終更新・メッセージ時刻の固定書式 `YYYY-MM-DD HH:mm`（ローカル時刻）。不正な日時は「—」。 */
function formatFixedDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/** セッション ID を先頭 4 文字 + … + 末尾 4 文字に短縮する（UUID 全文を出さない）。 */
function shortenId(id: string): string {
  if (id.length <= 9) {
    return id;
  }
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/** 詳細パネル（props なし）。`selectedKey` が null のときは何も描画しない。 */
export function DetailPanel() {
  const selectedKey = useSessionStore((state) => state.selectedKey);
  const select = useSessionStore((state) => state.select);
  const summary = useSessionStore((state) => selectSelectedSession(state));

  const [messages, setMessages] = useState<MessagesState>({ status: "loading" });
  const [entered, setEntered] = useState(false);

  const panelRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const lastOpenKeyRef = useRef<string | null>(null);

  // selectedKey が変わるたびに詳細（recentMessages）を取得する。古いリクエストの結果は無視する
  // （useEffect のクリーンアップで cancelled フラグを立てる）。
  useEffect(() => {
    if (selectedKey === null) {
      return;
    }
    const separatorIndex = selectedKey.indexOf(":");
    const tool = selectedKey.slice(0, separatorIndex);
    const id = selectedKey.slice(separatorIndex + 1);

    if (!isToolKind(tool)) {
      setMessages({
        status: "error",
        error: {
          code: "invalid_key",
          message: "セッションキーの形式が不正です。",
          hint: "一覧から選び直してください。",
        },
      });
      return;
    }

    let cancelled = false;
    setMessages({ status: "loading" });

    void apiClient.getSession(tool, id).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setMessages({ status: "ok", detail: result.value });
      } else {
        setMessages({ status: "error", error: result.error });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  // 開閉のスライドインアニメーション。null → 非 null の最初の遷移のときだけ発火させる
  // （セッションを選び直すたびに再アニメーションしない）。
  useEffect(() => {
    if (selectedKey !== null && !wasOpenRef.current) {
      wasOpenRef.current = true;
      setEntered(false);
      const frame = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(frame);
    }
    if (selectedKey === null) {
      wasOpenRef.current = false;
    }
    return;
  }, [selectedKey]);

  // 開いた（または別セッションに選び直した）ら「×」ボタンへフォーカスを移す。
  // 閉じたら data-session-key で元のカード / 行を探してフォーカスを戻す（仮想スクロールで
  // DOM が再利用され得るため、要素参照ではなくキーで探し直す）。
  useEffect(() => {
    if (selectedKey !== null) {
      lastOpenKeyRef.current = selectedKey;
      panelRef.current?.querySelector<HTMLElement>('[data-close="true"]')?.focus();
      return;
    }
    const previousKey = lastOpenKeyRef.current;
    lastOpenKeyRef.current = null;
    if (previousKey !== null) {
      // CSS.escape が使えない環境（一部のテスト環境等）ではキーをそのまま使う。
      let selectorValue = previousKey;
      try {
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
          selectorValue = CSS.escape(previousKey);
        }
      } catch {
        // フォールバック（上で代入済みの生キーを使う）。
      }
      document.querySelector<HTMLElement>(`[data-session-key="${selectorValue}"]`)?.focus();
    }
    return;
  }, [selectedKey]);

  // Esc で閉じる。入力欄（input/textarea/select/contenteditable）にフォーカスがあるときは、
  // そちら側の用途（検索欄のクリア等）を優先し除外する。
  useEffect(() => {
    if (selectedKey === null) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") {
        return;
      }
      const active = document.activeElement;
      const tagName = active?.tagName;
      if (
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT" ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }
      select(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedKey, select]);

  if (selectedKey === null || summary === null) {
    return null;
  }

  const panelClassName = entered ? `${styles.panel} ${styles.entered}` : styles.panel;

  return (
    <aside
      ref={panelRef}
      className={panelClassName}
      data-feature="session-detail"
      role="dialog"
      aria-label="セッション詳細"
      aria-modal="false"
    >
      <div className={styles.headerRow}>
        <Pill kind="tool" tool={summary.tool} />
        <Dot state={summary.state} />
        <span className={styles.stateLabel}>{STATE_LABELS[summary.state]}</span>
        {/* Button（components/）は data-* / ref を透過しないため、閉じるボタンは
            DESIGN.md §6.6 の ghost 見た目をローカル CSS で再現したネイティブ button にする。 */}
        <button
          type="button"
          data-close="true"
          aria-label="閉じる"
          className={styles.closeButton}
          onClick={() => select(null)}
        >
          ×
        </button>
      </div>

      <h2 className={styles.title}>{summary.title}</h2>

      <hr className={styles.divider} />

      <dl className={styles.summaryList}>
        <dt>作業ディレクトリ</dt>
        <dd className={styles.mono}>{summary.cwd}</dd>

        <dt>ブランチ</dt>
        <dd className={summary.branch !== null ? styles.mono : undefined}>
          {summary.branch ?? "—"}
        </dd>

        <dt>モデル</dt>
        <dd>{summary.model ?? "—"}</dd>

        <dt>ログサイズ</dt>
        <dd className={styles.mono}>{formatBytes(summary.logSizeBytes)}</dd>

        <dt>最終更新</dt>
        <dd className={styles.mono}>{formatFixedDateTime(summary.updatedAt)}</dd>

        <dt>セッション ID</dt>
        <dd className={styles.mono}>{shortenId(summary.id)}</dd>
      </dl>

      <hr className={styles.divider} />

      <h3 className={styles.messagesHeading}>最近のメッセージ（マスク済み・最大 20）</h3>

      {messages.status === "loading" ? <Loading rows={3} label="読み込み中" /> : null}
      {messages.status === "error" ? (
        <ErrorBanner message={messages.error.message} hint={messages.error.hint} />
      ) : null}
      {/* 取得成功かつ 0 件のときだけ案内を出す（取得中・失敗時は上の Loading / ErrorBanner が担う）。
          パネル内の一部分の空状態で「列内または一覧全体の中央」ではないため、EmptyState は使わず段落にする。
          文言は DESIGN.md §8 に従い「何が起きたか + 次にどうするか」。原因は 1 つに断定しない。 */}
      {messages.status === "ok" && messages.detail.recentMessages.length === 0 ? (
        <p className={styles.emptyMessages} data-empty-messages="true">
          直近のログに表示できる発言がありません。ツールの実行が続いている間は発言が記録されないことがあります。しばらくしてから「更新」を押してください。
        </p>
      ) : null}
      {messages.status === "ok" ? (
        <>
          {messages.detail.recentMessages.length > 0 ? (
            <ol className={styles.messageList}>
              {/* recentMessages は取得後に並べ替え・挿入をしない静的リスト。role + at だけでは
                  同一ロール・同一時刻が実データでも重複し得るため、index を含めて一意な key にする。 */}
              {messages.detail.recentMessages.map((message, index) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: 静的リストのため index を含めてよい（上のコメント参照）。
                  key={`${message.role}:${message.at}:${index}`}
                  data-role={message.role}
                  className={styles.messageItem}
                >
                  <div className={styles.messageMeta}>
                    <span className={styles.roleLabel}>{ROLE_LABELS[message.role]}</span>
                    <span className={styles.messageAt}>{formatFixedDateTime(message.at)}</span>
                  </div>
                  <p className={styles.messageText}>{message.text}</p>
                </li>
              ))}
            </ol>
          ) : null}
          {messages.detail.parseWarnings.length > 0 ? (
            <p className={styles.warnings}>
              {messages.detail.parseWarnings.join(" ")}表示に影響はありません。
            </p>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}
