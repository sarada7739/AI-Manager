// 並べ方セグメント。groupBy をストアに反映する（DESIGN.md §6.4 / F-3 / T-021）。
import type { GroupBy } from "../../../shared/grouping.js";
import { Pill } from "../../components/index.js";
import { useSessionStore } from "../../store/useSessionStore.js";
import styles from "./GroupBySegment.module.css";

/** 並べ方の軸一覧（表示順。DESIGN.md §8 の文言）。 */
const GROUP_BY_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: "account", label: "アカウント" },
  { value: "folder", label: "フォルダ" },
  { value: "state", label: "状態" },
  { value: "tool", label: "種類" },
];

/** 「並べ方」セグメント。Pill.filter の横並びで 1 つだけ選択できる（DESIGN.md §6.4）。 */
export function GroupBySegment() {
  const groupBy = useSessionStore((state) => state.groupBy);
  const setGroupBy = useSessionStore((state) => state.setGroupBy);

  return (
    // biome-ignore lint/a11y/useSemanticElements: フィルタセグメント（トグルボタン群）であり fieldset ではないため role="group" を使う。
    <div className={styles.segment} role="group" aria-label="並べ方">
      {GROUP_BY_OPTIONS.map((option) => (
        <Pill
          key={option.value}
          kind="filter"
          label={option.label}
          selected={groupBy === option.value}
          onClick={() => setGroupBy(option.value)}
        />
      ))}
    </div>
  );
}
