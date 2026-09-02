# ADR-0003 稼働状態は「プロセスメタ + プロセス生存 + ログ更新時刻」の 3 段階で判定する

- 日付: 2026-09-02
- 状態: 採用
- 関連: harness.md §1.2 F-6, §2.3 / docs/RESEARCH.md §2.2, §5

## 文脈

`~/.claude/sessions/<pid>.json` は稼働中プロセスに 1 対 1 で対応し、終了時に削除されることを実測で確認した。
ただし対の `.key` ファイルは残留することがあり、Codex のロックファイルも終了後に残る。
Windows では `ps` が使えず、プロセス列挙は PowerShell / `tasklist` に頼る必要がある。

## 決定

状態は次の 3 値とし、UI には判定根拠（「プロセス確認」「ログ更新」など）を併記する。

| 状態 | 条件 |
|---|---|
| `running` | Claude: `sessions/<pid>.json` が存在し、同 PID のプロセスが存在し `procStart` が一致する。Codex: プロセス列挙で `codex` 系プロセスの `CommandLine` に threadId が含まれる |
| `active` | `running` ではないが、セッションログの mtime が直近 N 分以内（既定 5 分、設定可） |
| `idle` | 上記いずれでもない |

- プロセス列挙は `Get-CimInstance Win32_Process` を子プロセスで実行し、結果を 1 秒以上キャッシュする。
- 列挙に失敗した場合は `running` 判定を諦め、`active` / `idle` のみで表示し、「プロセス情報なし」を明示する。
- `.key` ファイルとロックファイルの有無は判定に使わない。
- `procStart` と `Get-CimInstance` の `CreationDate` の突合は **1 秒（FILETIME で 10,000,000 ticks）の許容差** で行う（2026-09-03 追記、T-010）。理由: `procStart` は JSON 数値として 2^53 を超え JS では下位桁が丸められ、CIM の `CreationDate` はマイクロ秒精度で FILETIME の下位桁が落ちるため、厳密一致は成立しない。実誤差は数十 ticks だが、狭すぎると稼働中セッションが「稼働中でない」側に静かに倒れるため 1 秒とした。PID 再利用が 1 秒以内に起きる可能性は無視できる。

## 結果

- PID 再利用による誤判定を `procStart` で排除できる。
- プロセス列挙が使えない環境でも表示が崩れない。
