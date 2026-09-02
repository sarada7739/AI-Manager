# ADR-0001 サブエージェントのモデル指定は Agent ツールのエイリアスで行う

- 日付: 2026-09-02
- 状態: 採用
- 関連: harness.md §3.1

## 文脈

harness.md §3.1 は implementer / tester を `claude-sonnet-5`、reviewer を `claude-opus-5` と定めている。
一方、メインセッションの Agent ツールが受け付けるモデル指定は `sonnet` / `opus` / `haiku` / `fable` のエイリアスのみで、
完全なモデル ID は渡せない。§3.1 の注記「実行環境の設定に合わせて調整し、差異を ADR に記録する」に従う。

## 決定

| 役割 | harness の指定 | 実際に渡す値 |
|---|---|---|
| implementer | `claude-sonnet-5` | `sonnet` |
| tester | `claude-sonnet-5` | `sonnet` |
| reviewer | `claude-opus-5` | `opus` |

`.claude/agents/*.md` の frontmatter `model:` にも同じエイリアスを書く。

## 結果

- 実ログの `message.model` には `claude-sonnet-5` / `claude-opus-5` が出現しているため、エイリアスは harness の意図と同じ世代を指す。
- 将来エイリアスの解決先が変わった場合は本 ADR を改訂する。
