// セッションカード。DESIGN.md §6.1 の 4 行構成
// （1: ツールピル + 状態ドット + 相対時刻、2: タイトル、3: 最終メッセージ、4: フォルダ + ブランチ + サイズ）。
import type { KeyboardEvent } from "react";
import {
  formatBytes,
  normalizeBranch,
  shortenPath,
  truncateStart,
} from "../../../shared/format.js";
import { formatRelative } from "../../../shared/time.js";
import type { SessionSummary } from "../../../shared/types.js";
import { Dot, Pill } from "../../components/index.js";
import styles from "./SessionCard.module.css";

/** フォルダ表示の最大文字数。文字数はトークンで表せないため JS 定数として持つ。 */
const FOLDER_MAX_CHARS = 40;

export interface SessionCardProps {
  session: SessionSummary;
  selected: boolean;
  nowMs: number;
  onSelect: (key: string) => void;
  tabIndex: number;
  cardRef?: (el: HTMLElement | null) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}

/** セッション 1 件分のカード（DESIGN.md §6.1）。稼働中/作業中は左端にアクセントバーを付ける。 */
export function SessionCard({
  session,
  selected,
  nowMs,
  onSelect,
  tabIndex,
  cardRef,
  onKeyDown,
}: SessionCardProps) {
  // 表示専用の先頭省略。実パス（cwd）はサーバから受け取ったものをそのまま渡す
  // （UI 側にホームディレクトリの情報が無いため、ここでは区切り文字の統一のみ行われる）。
  const folder = truncateStart(shortenPath(session.cwd, ""), FOLDER_MAX_CHARS);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      // region 側の onKeyDown（BoardView）にバブリングさせて二重に select() されるのを防ぐ
      // （レビュー指摘 NON_BLOCKING）。
      event.stopPropagation();
      onSelect(session.key);
    }
    onKeyDown?.(event);
  };

  return (
    <article
      ref={cardRef}
      tabIndex={tabIndex}
      data-session-key={session.key}
      data-selected={selected ? "true" : undefined}
      data-state={session.state}
      aria-current={selected ? "true" : undefined}
      aria-label={session.title}
      className={styles.card}
      onClick={() => onSelect(session.key)}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.row1}>
        <Pill kind="tool" tool={session.tool} />
        <Dot state={session.state} />
        <span className={styles.time}>{formatRelative(session.updatedAt, nowMs)}</span>
      </div>
      <div className={styles.title}>{session.title}</div>
      <div className={styles.message}>{session.lastMessage}</div>
      <div className={styles.meta}>
        <span className={styles.path}>{folder}</span>
        <span>{normalizeBranch(session.branch) ?? "—"}</span>
        <span>{formatBytes(session.logSizeBytes)}</span>
      </div>
    </article>
  );
}
