// アカウントチップ。1 アカウントの稼働状態をドット + 表示名 + 状態テキストで示す（DESIGN.md §6.7 / T-022）。
import type { Account } from "../../../shared/types.js";
import { Dot } from "../../components/index.js";
import styles from "./AccountChip.module.css";

export interface AccountChipProps {
  account: Account;
  selected: boolean;
  onToggle: (key: string) => void;
}

/** `HH:mm` を 24 時間表記で整形する（Header.tsx と同じ書式）。 */
const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 状態テキストを組み立てる。running なら「稼働中」（+ 開始時刻）、そうでなければ「停止」。 */
function formatStatus(account: Account): { time: string | null } {
  if (!account.running || account.startedAt === null) {
    return { time: null };
  }
  // サーバは ISO を保証するが、不正な値で RangeError を投げて画面全体を落とさないよう防御する
  const ms = Date.parse(account.startedAt);
  return { time: Number.isFinite(ms) ? timeFormatter.format(ms) : null };
}

/** アカウント 1 件分のチップ。クリックで選択トグル（DESIGN.md §6.7）。 */
export function AccountChip({ account, selected, onToggle }: AccountChipProps) {
  const { time } = formatStatus(account);

  return (
    <button
      type="button"
      className={styles.chip}
      aria-pressed={selected}
      data-account-key={account.key}
      onClick={() => onToggle(account.key)}
    >
      <Dot state={account.running ? "running" : "idle"} />
      <span className={styles.label}>{account.label}</span>
      <span className={styles.status}>
        {account.running ? (
          <>
            稼働中
            {time !== null ? (
              <>
                {" "}
                <span className={styles.time}>{time}</span>〜
              </>
            ) : null}
          </>
        ) : (
          "停止"
        )}
      </span>
    </button>
  );
}
