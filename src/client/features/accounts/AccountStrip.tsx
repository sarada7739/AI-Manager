// アカウント帯。accounts をチップで横並び表示し、右端に稼働集計を出す（DESIGN.md §5.1 / §6.7 / T-022）。
import type { Account } from "../../../shared/types.js";
import { EmptyState } from "../../components/index.js";
import { useSessionStore } from "../../store/useSessionStore.js";
import { AccountChip } from "./AccountChip.js";
import styles from "./AccountStrip.module.css";

/** アカウントごとの稼働数を tool ごとに合計する。 */
function sumRunningByTool(accounts: Account[]) {
  let claude = 0;
  let codex = 0;
  for (const account of accounts) {
    if (account.tool === "claude") {
      claude += account.runningCount;
    } else {
      codex += account.runningCount;
    }
  }
  return { claude, codex };
}

/** アカウント帯（props なし。ストア購読）。 */
export function AccountStrip() {
  const accounts = useSessionStore((state) => state.accounts);
  const accountKey = useSessionStore((state) => state.filters.accountKey);
  const setFilter = useSessionStore((state) => state.setFilter);

  const handleToggle = (key: string) => {
    setFilter({ accountKey: accountKey === key ? null : key });
  };

  const { claude, codex } = sumRunningByTool(accounts);

  return (
    // biome-ignore lint/a11y/useSemanticElements: アカウントチップの集まりであり、フォーム部品の fieldset ではないため role="group" を使う（タスクカードの指定）。
    <div className={styles.strip} data-feature="account-strip" role="group" aria-label="アカウント">
      <span className={styles.heading}>アカウント</span>
      {accounts.length === 0 ? (
        <div className={styles.empty}>
          <EmptyState
            message="アカウント情報がありません"
            action="Claude Code を起動すると表示されます"
          />
        </div>
      ) : (
        <>
          <div className={styles.chips}>
            {accounts.map((account) => (
              <AccountChip
                key={account.key}
                account={account}
                selected={accountKey === account.key}
                onToggle={handleToggle}
              />
            ))}
          </div>
          <div className={styles.summary}>
            <span>Claude Code {claude}</span>
            <span>Codex {codex}</span>
            <span>稼働</span>
          </div>
        </>
      )}
    </div>
  );
}
