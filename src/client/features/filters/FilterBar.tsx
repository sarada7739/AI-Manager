// フィルタバー。並べ方・絞り込みの軸切替、セレクト・検索、読み取り専用トグル、表示件数をまとめる
// （F-3 / F-4 / F-8 / T-021）。props は持たずストアを直接購読する。
import { useEffect, useMemo, useRef, useState } from "react";
import { shortenPath } from "../../../shared/format.js";
import type { ToolKind } from "../../../shared/types.js";
import { Button, Pill } from "../../components/index.js";
import { selectFilteredSessions, selectFolderOptions } from "../../store/selectors.js";
import { useSessionStore } from "../../store/useSessionStore.js";
import styles from "./FilterBar.module.css";
import { GroupBySegment } from "./GroupBySegment.js";
import { ReadOnlyToggle } from "./ReadOnlyToggle.js";

/** 絞り込み（ツール種別）セグメントの選択肢（表示順。DESIGN.md §8 の文言）。 */
const TOOL_FILTER_OPTIONS: Array<{ value: ToolKind | "all"; label: string }> = [
  { value: "all", label: "すべて" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
];

/** 期間セレクトの選択肢（表示順）。days が null は絞り込みなし（すべて）。 */
const PERIOD_OPTIONS: Array<{ label: string; days: number | null }> = [
  { label: "1日", days: 1 },
  { label: "3日", days: 3 },
  { label: "1週間", days: 7 },
  { label: "2週間", days: 14 },
  { label: "1か月", days: 30 },
  { label: "すべて", days: null },
];

/** 検索欄の debounce 時間（ms）。 */
const SEARCH_DEBOUNCE_MS = 300;

/** フィルタバー本体。DESIGN.md §5.1 の 3 段レイアウトに対応する。 */
export function FilterBar() {
  const sessions = useSessionStore((state) => state.sessions);
  const accounts = useSessionStore((state) => state.accounts);
  const filters = useSessionStore((state) => state.filters);
  const setFilter = useSessionStore((state) => state.setFilter);
  const resetFilters = useSessionStore((state) => state.resetFilters);

  const [queryInput, setQueryInput] = useState(filters.query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // filters.query が外部から実際に変わったときだけ、保留中の検索 debounce を破棄して入力欄を追従させる。
  // 依存は filters.query（値）。setFilter / setView / select など他の操作で query 以外だけが変わった
  // ときは発火しないため、入力中の文字を無関係な操作で消してしまわない。
  useEffect(() => {
    if (debounceRef.current !== undefined) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
    }
    setQueryInput(filters.query);
  }, [filters.query]);

  // アンマウント時に保留中の debounce タイマーを破棄する（アンマウント後の setFilter 呼び出しを防ぐ）。
  useEffect(() => {
    return () => {
      if (debounceRef.current !== undefined) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const folderOptionsList = useMemo(
    () =>
      selectFolderOptions({ ...useSessionStore.getState(), sessions }).filter(
        (option) => option.folder !== "",
      ),
    [sessions],
  );

  const visibleCount = useMemo(
    () =>
      selectFilteredSessions({ ...useSessionStore.getState(), sessions, filters }, Date.now())
        .length,
    [sessions, filters],
  );

  const showResetLink = sessions.length > 0 && visibleCount === 0;

  /** debounce をキャンセルして即座に query を確定させる。 */
  const commitQuery = (value: string) => {
    if (debounceRef.current !== undefined) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
    }
    setFilter({ query: value });
  };

  const handleQueryChange = (value: string) => {
    setQueryInput(value);
    if (debounceRef.current !== undefined) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => commitQuery(value), SEARCH_DEBOUNCE_MS);
  };

  return (
    <div data-feature="filter-bar" className={styles.filterBar}>
      <div className={`${styles.row} ${styles.segments}`}>
        <GroupBySegment />
        {/* biome-ignore lint/a11y/useSemanticElements: フィルタセグメント（トグルボタン群）であり fieldset ではないため role="group" を使う。 */}
        <div className={styles.segmentGroup} role="group" aria-label="絞り込み">
          {TOOL_FILTER_OPTIONS.map((option) => (
            <Pill
              key={option.value}
              kind="filter"
              label={option.label}
              selected={filters.tool === option.value}
              onClick={() => setFilter({ tool: option.value })}
            />
          ))}
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="filter-account" className={styles.fieldLabel}>
            アカウント
          </label>
          <select
            id="filter-account"
            className={styles.select}
            value={filters.accountKey ?? ""}
            onChange={(event) =>
              setFilter({ accountKey: event.target.value === "" ? null : event.target.value })
            }
          >
            <option value="">すべて</option>
            {accounts.map((account) => (
              <option key={account.key} value={account.key}>
                {account.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor="filter-folder" className={styles.fieldLabel}>
            フォルダ
          </label>
          <select
            id="filter-folder"
            className={styles.select}
            value={filters.folder ?? ""}
            onChange={(event) =>
              setFilter({ folder: event.target.value === "" ? null : event.target.value })
            }
          >
            <option value="">すべて</option>
            {folderOptionsList.map((option) => (
              <option key={option.folder} value={option.folder}>
                {shortenPath(option.folder, "")}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor="filter-since-days" className={styles.fieldLabel}>
            期間
          </label>
          <select
            id="filter-since-days"
            className={styles.select}
            value={filters.sinceDays === null ? "" : String(filters.sinceDays)}
            onChange={(event) =>
              setFilter({
                sinceDays: event.target.value === "" ? null : Number(event.target.value),
              })
            }
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.label} value={option.days === null ? "" : String(option.days)}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.checkboxField}>
          <input
            id="filter-running-only"
            type="checkbox"
            checked={filters.runningOnly}
            onChange={(event) => setFilter({ runningOnly: event.target.checked })}
          />
          <label htmlFor="filter-running-only">稼働中だけ</label>
        </div>

        <input
          type="search"
          aria-label="検索"
          placeholder="検索"
          className={styles.search}
          value={queryInput}
          onChange={(event) => handleQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commitQuery(queryInput);
            }
          }}
        />
      </div>

      <div className={`${styles.row} ${styles.row3}`}>
        <ReadOnlyToggle />
        <div className={styles.rightGroup}>
          {showResetLink ? (
            <Button variant="ghost" onClick={resetFilters}>
              絞り込みを解除
            </Button>
          ) : null}
          <span className={styles.count}>表示 {visibleCount} 件</span>
        </div>
      </div>
    </div>
  );
}
