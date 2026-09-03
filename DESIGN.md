# DESIGN.md — AI-Manager デザインシステム

> 実装時は **本書がデザインの唯一の参照先**。ここに無い値をコードに書かない。
> すべての値は `src/client/styles/tokens.css` の CSS カスタムプロパティとして定義し、コンポーネントはトークン経由でのみ参照する。
> 参考画像（クリーム地 + テラコッタ）の配色・書体・見た目は一切流用しない。参考にしたのは情報構造だけ。
> 黒基調の出発点として `docs/reference/style-reference-harness-io.md` を参照したが、管制画面向けに再構成した（ADR-0006）。
> 2026-09-03 に利用者の指示で配色を藍〜紫のインディゴ基調に改め、稼働中の表示にだけ光彩を、ページ背景にグラデーションを許可した（ADR-0008）。レイアウト・余白・角丸・状態の形は変えていない。

---

## 1. プロダクトの性格づけ

**誰が**: 複数の Claude Code / Codex セッションを並列で走らせている開発者本人。
**どんな状況で**: サブモニタや画面端に **長時間開きっぱなし** にして、作業の合間に何度も視線を戻す。
**何のために**: 「どのセッションが今動いているか」「止まっているのはどれか」「最後に何を言ったか」を **数秒で把握** し、必要なら詳細を開く。

この性質から導く設計判断:

| 性質 | 判断 |
|---|---|
| 長時間表示される | 藍基調・低輝度。白面積を最小化し、目の疲労を抑える。装飾アニメーションを入れない。光彩は静的（点滅しない） |
| 視線が何度も戻る | 情報の位置を固定する。列の順序・カードの構造を状態で変えない。「今動いているもの」だけが光彩を伴って光る |
| 一目で把握 | 稼働状態は列ヘッダとカードの左端で分かる。文字を読む前に形で分かる |
| 数百件を扱う | 密度は高め。カードは 3 行に収める。仮想スクロールで描画を絞る |
| 誤操作を防ぐ | 既定で読み取り専用。送信系は無効表示で理由を出す |

**大胆さは 1 か所に集中させる**: 光彩を伴って光るのは「稼働中」を示すバイオレット（`--color-signal` + `--glow-signal`）だけ。それ以外の装飾は §2.5 に列挙したものに限る（ページ背景の `--gradient-page`、面の上端の `--gradient-surface`、塗りつぶしボタンの `--gradient-primary`、ページタイトルの `--glow-title`）。いずれも静的で、状態によって変化しない。

---

## 2. カラートークン

### 2.1 ベース（藍寄り 6 段）

| トークン | 値 | 役割 |
|---|---|---|
| `--color-bg` | `#06060f` | ページ背景。最下層（実際の描画は `--gradient-page` を重ねる） |
| `--color-surface-1` | `#0b0b1c` | 列の背景、ヘッダ帯 |
| `--color-surface-2` | `#12122b` | カード、入力欄、パネル |
| `--color-surface-3` | `#1a1a3c` | ホバー、選択行、ネストしたパネル |
| `--color-border` | `#2a2a60` | 通常の境界線 |
| `--color-border-strong` | `#3b3b78` | 列の区切り、フォーカスしていない入力欄の枠 |

### 2.2 テキスト（4 段）

| トークン | 値 | 役割 | 対 surface-2 コントラスト |
|---|---|---|---|
| `--color-text` | `#eef0ff` | タイトル、主要な数値 | 16.2:1 |
| `--color-text-2` | `#c6c9e6` | 本文、最終メッセージ | 11.2:1 |
| `--color-text-3` | `#9296bd` | メタ情報（時刻、サイズ、パス） | 6.4:1 |
| `--color-text-muted` | `#5f6389` | 無効状態、プレースホルダ | 3.2:1（無効要素にのみ使う） |

### 2.3 シグナルとアクセント

| トークン | 値 | 役割 |
|---|---|---|
| `--color-signal` | `#9d8cff` | **稼働中**。画面で唯一光る色（6.7:1）。ドット、列ヘッダの下線、件数 |
| `--color-signal-dim` | `#2b2466` | Toggle ON の地。稼働中の面を淡く塗る必要が出たときの予備（カード左端バーと列ヘッダ下線は `--color-signal` そのもの） |
| `--color-focus` | `#6ea8ff` | キーボードフォーカスリング、リンク（7.6:1）。signal と同じ面に重ねない |
| `--color-working` | `#f2b950` | **作業中**（ログが更新され続けているが稼働プロセス未確認） |
| `--color-danger` | `#ff6b7a` | エラー、読み取り失敗 |
| `--color-on-signal` | `#0a0a1c` | signal / `--gradient-primary` 背景上の文字（単色 signal 上 7.1:1、グラデーション上は 5.4:1 以上） |

### 2.4 状態は色だけで区別しない

| 状態 | 色 | 形（8px） | ラベル |
|---|---|---|---|
| 稼働中 `running` | `--color-signal` | `●` 塗りつぶし円 | 「稼働中」 |
| 作業中 `active` | `--color-working` | `◐` 半円（左塗り） | 「作業中」 |
| 停止 `idle` | `--color-text-3` | `○` 輪郭のみ | 「停止」 |
| エラー `error` | `--color-danger` | `▲` 三角 | 「エラー」 |

ツール種別は色ではなく **輪郭ピルのラベル**（`Claude` / `Codex`）で示す。ツール種別に専用色を与えない。

### 2.5 グラデーションと光彩（ADR-0008）

rgba / hex を含む値はここ（と tokens.css）にだけ書く。CSS Modules は必ずトークン経由で参照する。

| トークン | 役割 | 使う場所 |
|---|---|---|
| `--gradient-page` | ページ背景。左上に紫、右上に青の淡い放射グラデーションを藍の縦グラデーションに重ねる | `body` の `background-image`（`background` 自体は `--color-bg` のまま。`background-attachment: fixed` でスクロールしても光の位置を動かさない） |
| `--gradient-surface` | カード / パネル / 指示入力欄の上端にごく薄い紫を乗せる | `SessionCard`、`DetailPanel`、`ComposeBox`、`AccountChip` の `background-image` |
| `--gradient-primary` | 塗りつぶしボタン（`primary`）の背景 | `Button.primary`（文字は `--color-on-signal`） |
| `--glow-signal` | 稼働中の要素の輪郭光彩（1px の縁 + 18px のぼかし） | 稼働中の `SessionCard`、稼働中の `AccountChip`、稼働ありの `ColumnHeader` |
| `--glow-signal-dot` | 稼働中ドットの光彩 | `Dot[state=running]` |
| `--glow-title` | ページタイトルの淡い光彩 | `Header .title` の `text-shadow` |

光彩は **稼働中（running）にだけ** 付ける。作業中・停止・エラー・選択・ホバー・フォーカスには付けない。フォーカスは §7 のアウトラインのまま。

---

## 3. タイポグラフィ

書体は 2 種。Windows 11 標準フォントに寄せ、外部フォントを読み込まない（ローカル専用・オフライン動作のため）。

| トークン | 値 | 用途 |
|---|---|---|
| `--font-ui` | `"Segoe UI Variable Text", "Segoe UI", "Yu Gothic UI", system-ui, sans-serif` | 本文、UI 全般、日本語 |
| `--font-mono` | `"Cascadia Mono", Consolas, "Courier New", monospace` | **用途限定**: 作業ディレクトリ、ブランチ名、ログサイズ、PID、時刻 |
| `--font-display` | `Georgia, Cambria, "Yu Mincho", "Times New Roman", serif` | **ページタイトル「AI-Manager」だけ**（ADR-0008）。他の見出し・本文には使わない |

等幅を使ってよいのは上記 5 種の値だけ。タイトルや最終メッセージに等幅を使わない。書体は本文 1 種 + 等幅 1 種 + 表示用セリフ 1 種の計 3 種で、外部フォントは読み込まない。

### 3.1 スケール

| トークン | サイズ / 行送り | 用途 |
|---|---|---|
| `--text-xs` | 11px / 1.3 | ピル、列内の件数、メタ情報 |
| `--text-sm` | 12px / 1.4 | 最終メッセージ、テーブル本文 |
| `--text-md` | 13px / 1.45 | 基本サイズ。カードタイトル、フィルタ、入力欄 |
| `--text-lg` | 15px / 1.4 | 列ヘッダ、パネル見出し |
| `--text-xl` | 20px / 1.2 | パネルの大見出し（予備） |
| `--text-2xl` | 28px / 1.1 | ページタイトル（`--font-display`、`--weight-regular`） |

### 3.2 ウェイトと字間

| トークン | 値 |
|---|---|
| `--weight-regular` | 400 |
| `--weight-medium` | 500（カードタイトル、列ヘッダ） |
| `--weight-semibold` | 600（件数の数字。ページタイトルはセリフ体のため `--weight-regular`） |
| `--tracking-normal` | 0 |
| `--tracking-wide` | 0.04em（ピル内のラベル。§6.3 の `Pill` は種別を問わず適用する） |

見出しの上に置く「トラッキングを広げた全大文字ラベル」は使わない。

---

## 4. 余白・角丸・影・モーション

### 4.1 余白（4px 基準）

| トークン | 値 | 用途 |
|---|---|---|
| `--space-1` | 4px | ピル内、アイコンと文字の間 |
| `--space-2` | 8px | カード内の行間、チップ間 |
| `--space-3` | 12px | カードのパディング、列内カード間 |
| `--space-4` | 16px | セクション内の要素間、列の左右パディング |
| `--space-5` | 24px | セクション間、ページ左右の余白 |
| `--space-6` | 32px | ヘッダ帯とボードの間 |

### 4.2 角丸（3 種のみ）

| トークン | 値 | 用途 |
|---|---|---|
| `--radius-sm` | 4px | 入力欄、ボタン、テーブル行のハイライト |
| `--radius-md` | 8px | カード、パネル、列 |
| `--radius-pill` | 999px | ピル（ツール種別、状態ラベル、フィルタチップ） |

すべての要素を同じ角丸のカードに切り分けない。列は角丸なし（`0`）でよい。カードとパネルだけ `--radius-md`。

### 4.3 影と光彩

装飾の影（カードの浮き上がり、ホバー時の影）は使わない。段差は surface の明度差と 1px の境界線で表す。
例外は次の 2 つだけ（ADR-0008）:
- モーダル・ドロップダウンの `--shadow-overlay`
- **稼働中** の要素とページタイトルの光彩 `--glow-signal` / `--glow-signal-dot` / `--glow-title`（§2.5）。光彩は静的で、点滅・呼吸アニメーションを付けない

### 4.4 モーション

ユーザー操作への応答のみ。装飾的なアニメーション（フェードイン、カードのホバー浮き上がり）は入れない。

| トークン | 値 | 用途 |
|---|---|---|
| `--duration-fast` | 120ms | ホバー背景、トグル |
| `--duration-normal` | 200ms | パネルの開閉、列の切替 |
| `--easing` | `cubic-bezier(0.2, 0, 0, 1)` | 共通 |

`prefers-reduced-motion: reduce` では `--duration-*` を `0ms` にする。稼働中ドットは **点滅させない**（常時点灯）。

---

## 5. レイアウト

### 5.1 全体（ボード表示）

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ AI-Manager   22:45 現在   Claude 46 / Codex 3 件           [ボード][リスト] [更新] │  ヘッダ帯 (surface-1)
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ ここに指示を書く（読むだけ OFF + 稼働中の宛先を選ぶと有効）              │ │  指示入力 (surface-2)
│ │ 宛先 [● harness.md フェーズ… ~/AI-Manager ▾]                       [送る] │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ アカウント                                            Claude Code 1 · Codex 0 稼働 │
│ [● Claude Desktop 1  稼働中 22:11〜] [○ Claude CLI  停止] [○ Codex  停止]        │  アカウント帯
├──────────────────────────────────────────────────────────────────────────────┤
│ 並べ方 [アカウント][フォルダ][状態][種類]  絞り込み [すべて][Claude][Codex]           │  フィルタバー
│ アカウント: すべて ▾  フォルダ: すべて ▾  期間: 2週間 ▾  □ 稼働中だけ  [検索____]   │
│ ☑ 読むだけ・送信はしない                                            表示 46 件 │
├──────────────┬──────────────┬──────────────┬──────────────┬─────────────────┤
│ ● Desktop 1  │ ○ Claude CLI │ ○ Codex      │              │                 │  列ヘッダ
│ 1 稼働 / 40  │ 3            │ 3            │              │                 │
├──────────────┼──────────────┼──────────────┼──────────────┼─────────────────┤
│▌[Claude] ●   │ [Claude] ○   │ [Codex] ○    │              │                 │
│▌タイトル…    │ タイトル…    │ タイトル…    │              │                 │  カード (仮想スクロール)
│▌最終msg…     │ 最終msg…     │ 最終msg…     │              │                 │
│▌~/proj main  │ ~/proj  1.2MB│ ~/x  30KB    │              │                 │
│  たった今    │  5時間前     │  4日前       │              │                 │
│ ┌──────────┐ │              │              │              │                 │
│ │ ...      │ │              │              │              │                 │
└──────────────┴──────────────┴──────────────┴──────────────┴─────────────────┘
```

- ページ左右余白 `--space-5`。最大幅は設けない（ワイドモニタで列を増やす）。
- 列幅 `--column-width: 300px`、列間 `--space-3`。横スクロール可。
- フィルタバーは `position: sticky`。ヘッダ帯も sticky にする想定だったが、第 1 段階ではヘッダ帯の高さのトークンが無く両者の `top` を両立できないため、ヘッダ帯は固定しない（ADR-0007。`--header-height` を追加した時点で両立させる）。

### 5.2 リスト表示

```
┌────┬──────┬────────────────────────┬──────────────────────┬────────────┬────────┬────────┬──────────┐
│状態│種別  │タイトル                │最終メッセージ        │フォルダ    │ブランチ│サイズ  │最終更新  │
├────┼──────┼────────────────────────┼──────────────────────┼────────────┼────────┼────────┼──────────┤
│ ●  │Claude│Notion ページ設定       │お知らせの幅を…       │~/services  │main    │3.8MB   │たった今  │
│ ○  │Codex │(無題)                  │…                     │~/note      │—       │3.1MB   │23時間前  │
└────┴──────┴────────────────────────┴──────────────────────┴────────────┴────────┴────────┴──────────┘
```

- 行高 `--row-height: 36px`。仮想スクロール。
- 列ヘッダをクリックで並べ替え（最終更新 / タイトル / サイズ / 状態）。
- 行クリックで詳細パネル（右側 `--panel-width: 420px`、`--space-4` パディング）。

### 5.3 詳細パネル

```
┌────────────────────────────────────────┐
│ [Claude] ● 稼働中          [×]         │
│ タイトル（全文）                        │
│ ─────────────────────────────────────── │
│ 作業ディレクトリ  ~/services/dev  (mono)│
│ ブランチ          main            (mono)│
│ モデル            claude-sonnet-5       │
│ ログサイズ        3.8 MB          (mono)│
│ 最終更新          2026-09-02 22:45(mono)│
│ セッション ID     9171…9e24      (mono)│
│ ─────────────────────────────────────── │
│ 最近のメッセージ（マスク済み・最大 20） │
│ ▸ user   …                              │
│ ▸ assistant …                           │
└────────────────────────────────────────┘
```

---

## 6. コンポーネント目録

### 6.1 セッションカード `SessionCard`
- 背景 `--color-surface-2` に `--gradient-surface` を重ねる。境界 `1px solid --color-border`、角丸 `--radius-md`、パディング `--space-3`。
- 稼働中は左端に `3px` の `--color-signal` バー（`--card-accent-width: 3px`）と `--glow-signal` の光彩。作業中は `--color-working` のバーのみ（光彩なし）。停止は無し。
- 1 行目: ツールピル + 状態ドット + 相対時刻（右寄せ、`--text-xs`、`--color-text-3`）。
- 2 行目: タイトル（`--text-md`、`--weight-medium`、1 行省略）。
- 3 行目: 最終メッセージ（`--text-sm`、`--color-text-2`、2 行省略）。
- 4 行目: フォルダ（`--font-mono`、`--text-xs`、`--color-text-3`、先頭省略）+ ブランチ + サイズ。区切りは中黒ではなく `--space-2` の間隔。
- ホバー: 背景 `--color-surface-3`（`--duration-fast`）。選択: 境界 `--color-border-strong`。
- フォーカス: `2px solid --color-focus` のアウトライン、オフセット `2px`。

### 6.2 列ヘッダ `ColumnHeader`
- 背景 `--color-surface-1`、下線 `1px solid --color-border`。稼働セッションを含む列は下線を `2px solid --color-signal` にし、`--glow-signal` の光彩を付ける。
- 左: 状態ドット + グループ名（`--text-lg`、`--weight-medium`）。右: 件数（`--weight-semibold`、`--font-mono`）。稼働数がある場合は `1 稼働 / 40` の形式。
- `position: sticky; top: 0` で列内スクロール時も固定。

### 6.3 ピル `Pill`
- 輪郭のみ。`1px solid` + 文字色同色。塗りつぶさない。角丸 `--radius-pill`、パディング `1px --space-2`、`--text-xs`、`--tracking-wide`。
- 種別: `tool`（`--color-text-2`）、`state`（§2.4 の色）、`filter`（選択時のみ背景 `--color-surface-3`、境界 `--color-border-strong`）。

### 6.4 フィルタバー `FilterBar`
- セグメント（並べ方・絞り込み）は `Pill.filter` の横並び。選択中は 1 つだけ。
- セレクトは `--color-surface-2` 背景、`1px solid --color-border-strong`、`--radius-sm`、高さ `--control-height: 28px`。
- 検索欄は同じ枠。フォーカスで枠が `--color-focus` に変わる。グローは付けない。
- 「読むだけ・送信はしない」トグルは `Toggle` を使い、ON が既定。OFF のときは「送信できます（送る前に確認が出ます）」を隣に表示する（第 2 段階、ADR-0009）。

### 6.5 トグル `Toggle`
- 幅 `32px`、高さ `18px`、角丸 `--radius-pill`。OFF: `--color-surface-3` 地 + `--color-text-3` ノブ。ON: `--color-signal-dim` 地 + `--color-signal` ノブ。ラベルは必ず横に置く。

### 6.6 ボタン `Button`
- `primary`: 背景 `--gradient-primary`、文字 `--color-on-signal`、`--radius-sm`、高さ `--control-height`。画面に 1 つまで（「送る」）。確認ダイアログ（§6.11）の「送る」も primary だが、モーダル表示中は背景を操作できないため、操作可能な primary は常に 1 つ。無効時は背景 `--color-surface-3`、文字 `--color-text-muted`、カーソル `not-allowed`、隣に理由を表示。
- `ghost`: 背景なし、`1px solid --color-border-strong`、文字 `--color-text-2`。「更新」「閉じる」に使う。「ボード / リスト」の表示切替は選択状態（`aria-pressed`）を伝える必要があるため §6.4 と同じ `Pill.filter` のセグメントにする。

### 6.7 アカウントチップ `AccountChip`
- `--color-surface-2` 地、`1px solid --color-border`、`--radius-md`、パディング `--space-2 --space-3`。
- 状態ドット + 表示名（`--weight-medium`） + 「稼働中 22:11〜」または「停止」（`--text-xs`、`--color-text-3`、時刻は `--font-mono`）。
- 稼働中のチップは `--glow-signal` の光彩を付け、`--gradient-surface` を重ねる。

### 6.8 空状態 `EmptyState`
- 列内または一覧全体の中央。`--color-text-3`、`--text-sm`。文言は「このグループにセッションはありません」「条件に合うセッションがありません。絞り込みを解除してください」のように **次の行動** を含める。

### 6.9 ローディング `Loading`
- 初回のみスケルトン（`--color-surface-3` の矩形 3 行、アニメーションなし）。更新中はヘッダ帯右端に「更新中」テキストだけ出す。スピナーは使わない。

### 6.10 エラー `ErrorBanner`
- フィルタバー直下。`1px solid --color-danger`、文字 `--color-danger`、背景は `--color-surface-2`。
- 文言は「何が起きたか + 次にどうするか」。例: 「セッションログを読めませんでした（~/.claude/projects が見つかりません）。Claude Code を一度起動してから「更新」を押してください。」

### 6.11 指示入力 `ComposeBox` と確認ダイアログ `Dialog`（第 2 段階、ADR-0009）
- `ComposeBox`: テキストエリア + 宛先セレクト + 「送る」（`primary`）。宛先は **稼働中（`running`）の Claude セッションだけ** を列挙し、表示はタイトル + フォルダ（`--font-mono` ではなく本文書体。フォルダは先頭省略）。ボードやリストでセッションを選ぶと宛先に反映する。
- 無効条件と理由（`Button.reason`）: 読み取り専用トグルが ON →「読み取り専用です。送るにはトグルを OFF にしてください」。宛先が無い →「稼働中の Claude セッションがありません」。本文が空 →「指示を入力してください」。Codex は宛先に出さない。
- 「送る」を押すと **確認ダイアログ** を開く。送信は必ずダイアログの「送る」から行う（2 段階）。
- `Dialog`: `role="dialog"` + `aria-modal="true"` + `aria-labelledby`。背景 `--color-surface-2` に `--gradient-surface`、境界 `1px solid --color-border-strong`、角丸 `--radius-md`、影 `--shadow-overlay`（§4.3 の例外）、パディング `--space-4`、幅は最大 `--panel-width`。背後は `--color-bg` を半透明にせず、`--shadow-overlay` の段差だけで区別する（オーバーレイ色のトークンは持たない）。
- ダイアログの内容: 見出し「この指示を送りますか」、宛先（セッション名 / フォルダ）、本文の先頭 200 文字（超える場合は `…`）、「配信されるか保留されるかは受信側の設定に従います」の注記（`--color-text-3`、`--text-xs`）、ボタンは「キャンセル」（`ghost`）と「送る」（`primary`）。
- キーボード: 開いたら「送る」にフォーカス。`Tab` はダイアログ内で循環。`Esc` と「キャンセル」で閉じ、フォーカスを元の「送る」ボタンへ戻す。
- 送信中は両ボタンを無効にし「送信中…」。結果はダイアログを閉じた後、ヘッダ帯右端（`LiveStatus` と同じ場所）に「送信: 投函しました」または「送信: 失敗（理由）」を `--text-sm` で 10 秒表示する。色だけで区別せず、失敗は `--color-danger` + `▲`。
- 送信後はテキストエリアを空にし、宛先は保持する。

---

## 7. アクセシビリティ

- 本文テキストは対 surface で **4.5:1 以上**（§2.2 の表を満たす）。`--color-text-muted` は無効要素にのみ使う。
- すべての操作はキーボードで可能。ボードでは `←` `→` で列間、`↑` `↓` でカード間、`Enter` で詳細、`Esc` で閉じる。
- フォーカスリングは `2px solid --color-focus`、オフセット `2px`。`:focus-visible` でのみ表示。
- 状態は色 + 形 + ラベル（§2.4）。ドットには `aria-label` を付ける。光彩は補助であり、光彩の有無だけで状態を伝えない。
- `prefers-reduced-motion: reduce` で全モーションを 0ms にする。
- ライトテーマは提供しない（管制画面として黒を固定）。`color-scheme: dark` を宣言し、フォーム部品も暗色にする。

---

## 8. 文言のルール

- 能動態。「更新する」「絞り込む」。
- 同じ操作は同じ語で呼ぶ: 「更新」（再読込ではない）、「絞り込み」（フィルタではない）、「並べ方」（グルーピングではない）、「送る」。
- 相対時刻: 「たった今」（60 秒未満）「3分前」「5時間前」「2日前」。7 日以上は絶対日付 `2026-08-23`。
- 状態: 「稼働中」「作業中」「停止」「エラー」。
- 無題は「(無題)」。ブランチが `HEAD` または無い場合は「—」。
- エラー: 「何が起きたか + 次にどうするか」。技術用語は括弧で補足する。
- 秘密情報らしき文字列は `••••` に置換して表示する。対象は Anthropic / OpenAI 系（`sk-ant-`, `sk-…`）、GitHub（`ghp_` `gho_` `ghu_` `ghs_` `ghr_` `github_pat_`）、AWS（`AKIA` `ASIA`）、Slack（`xoxb-` `xoxp-`）、`Bearer` トークン、メールアドレス（`***@***`）。接頭辞（先頭 4 文字）だけ残し、Bearer はトークン全体を伏せる。マスク規則は `src/shared/masking.ts` の `SECRET_PATTERNS` が唯一の定義。

---

## 9. トークン一覧（tokens.css の正）

```css
:root {
  color-scheme: dark;

  --color-bg: #06060f;
  --color-surface-1: #0b0b1c;
  --color-surface-2: #12122b;
  --color-surface-3: #1a1a3c;
  --color-border: #2a2a60;
  --color-border-strong: #3b3b78;

  --color-text: #eef0ff;
  --color-text-2: #c6c9e6;
  --color-text-3: #9296bd;
  --color-text-muted: #5f6389;

  --color-signal: #9d8cff;
  --color-signal-dim: #2b2466;
  --color-focus: #6ea8ff;
  --color-working: #f2b950;
  --color-danger: #ff6b7a;
  --color-on-signal: #0a0a1c;

  --gradient-page:
    radial-gradient(ellipse 70% 45% at 15% 0%, rgba(124, 92, 255, 0.32), transparent 70%),
    radial-gradient(ellipse 50% 35% at 90% 10%, rgba(58, 108, 255, 0.2), transparent 70%),
    linear-gradient(180deg, #08081a 0%, #06060f 100%);
  --gradient-surface: linear-gradient(180deg, rgba(124, 92, 255, 0.07), rgba(124, 92, 255, 0) 60%);
  --gradient-primary: linear-gradient(135deg, #8f7dff 0%, #5b7cff 100%);
  --glow-signal: 0 0 0 1px rgba(157, 140, 255, 0.35), 0 0 18px rgba(124, 92, 255, 0.25);
  --glow-signal-dot: 0 0 8px rgba(157, 140, 255, 0.8);
  --glow-title: 0 0 24px rgba(157, 140, 255, 0.35);

  --font-ui: "Segoe UI Variable Text", "Segoe UI", "Yu Gothic UI", system-ui, sans-serif;
  --font-mono: "Cascadia Mono", Consolas, "Courier New", monospace;
  --font-display: Georgia, Cambria, "Yu Mincho", "Times New Roman", serif;

  --text-xs: 11px;
  --leading-xs: 1.3;
  --text-sm: 12px;
  --leading-sm: 1.4;
  --text-md: 13px;
  --leading-md: 1.45;
  --text-lg: 15px;
  --leading-lg: 1.4;
  --text-xl: 20px;
  --leading-xl: 1.2;
  --text-2xl: 28px;
  --leading-2xl: 1.1;

  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --tracking-normal: 0;
  --tracking-wide: 0.04em;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-pill: 999px;

  --shadow-overlay: 0 8px 24px rgba(0, 0, 0, 0.6);

  --duration-fast: 120ms;
  --duration-normal: 200ms;
  --easing: cubic-bezier(0.2, 0, 0, 1);

  --column-width: 300px;
  --panel-width: 420px;
  --row-height: 36px;
  --control-height: 28px;
  --card-accent-width: 3px;
  --dot-size: 8px;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-fast: 0ms;
    --duration-normal: 0ms;
  }
}
```

この一覧に無い値を CSS に書いてはならない。追加が必要な場合は本書と `tokens.css` を同時に更新し、PR 本文に理由を書く。
