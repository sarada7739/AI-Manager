// 輪郭ピル。tool / state / filter の 3 種を 1 コンポーネントで描画する（DESIGN.md §6.3）。
import type { SessionState, ToolKind } from "../../shared/types.js";
import { STATE_LABELS } from "./Dot.js";
import styles from "./Pill.module.css";

/** ツール種別のラベル。ツール種別に専用色は与えない（DESIGN.md §2.4）。 */
const TOOL_LABELS: Record<ToolKind, string> = {
  claude: "Claude",
  codex: "Codex",
};

export type PillProps =
  | { kind: "tool"; tool: ToolKind; className?: string }
  | { kind: "state"; state: SessionState; className?: string }
  | {
      kind: "filter";
      label: string;
      selected: boolean;
      onClick?: () => void;
      className?: string;
    };

/** 輪郭のみのピル。塗りつぶさず 1px の境界線 + 同色の文字で示す（DESIGN.md §6.3）。 */
export function Pill(props: PillProps) {
  if (props.kind === "tool") {
    const classes = [styles.pill, styles.tool, props.className].filter(Boolean).join(" ");
    return (
      <span className={classes} data-kind="tool">
        {TOOL_LABELS[props.tool]}
      </span>
    );
  }

  if (props.kind === "state") {
    const classes = [styles.pill, styles.state, styles[props.state], props.className]
      .filter(Boolean)
      .join(" ");
    return (
      <span className={classes} data-kind="state" data-state={props.state}>
        {STATE_LABELS[props.state]}
      </span>
    );
  }

  const classes = [
    styles.pill,
    styles.filter,
    props.selected ? styles.selected : "",
    props.className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={classes}
      data-kind="filter"
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}
