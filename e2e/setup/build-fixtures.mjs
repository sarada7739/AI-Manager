// E2E 用の合成フィクスチャを毎回作り直すビルドスクリプト（T-026）。
// 依存追加なし（node:fs/promises, node:path, node:url のみ）。
// local-data/e2e/ 配下（.gitignore 済み）に、Claude / Codex それぞれの合成セッションログと
// サーバ設定（config.json）を生成する。実データ・実パス・実 UUID は使わない
// （UUID は "00000000-0000-4000-8000-00000000000N" 形式、cwd は "C:\synthetic\..." 形式）。

import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// パスの組み立て（すべて path.resolve / path.join で絶対パス化する）
// ---------------------------------------------------------------------------

// playwright.config.ts と同じくファイル位置からリポジトリルートを導出する（cwd に依存させない。ずれると
// AI_MANAGER_CONFIG_PATH の先が無くなり、サーバが既定の実 roots に静かにフォールバックしてしまう）
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const E2E_DIR = path.join(REPO_ROOT, "local-data", "e2e");
const CLAUDE_ROOT = path.join(E2E_DIR, ".claude");
const CODEX_ROOT = path.join(E2E_DIR, ".codex");

const PROJECTS_DIR = path.join(CLAUDE_ROOT, "projects");
const CLAUDE_SESSIONS_DIR = path.join(CLAUDE_ROOT, "sessions");

const ID_DESKTOP = "00000000-0000-4000-8000-000000000001";
const ID_CLI_A = "00000000-0000-4000-8000-000000000002";
const ID_CLI_B = "00000000-0000-4000-8000-000000000003";
const ID_CODEX = "00000000-0000-4000-8000-000000000004";

const DIR_DESKTOP = path.join(PROJECTS_DIR, "e2e-desktop");
const DIR_CLI_A = path.join(PROJECTS_DIR, "e2e-cli-a");
const DIR_CLI_B = path.join(PROJECTS_DIR, "e2e-cli-b");

const JSONL_DESKTOP = path.join(DIR_DESKTOP, `${ID_DESKTOP}.jsonl`);
const JSONL_CLI_A = path.join(DIR_CLI_A, `${ID_CLI_A}.jsonl`);
const JSONL_CLI_B = path.join(DIR_CLI_B, `${ID_CLI_B}.jsonl`);
const CUSTOM_TITLE_CLI_A = path.join(DIR_CLI_A, ID_CLI_A, "custom-title.json");

const CODEX_DAY_DIR = path.join(CODEX_ROOT, "sessions", "2026", "09", "01");
const JSONL_CODEX = path.join(CODEX_DAY_DIR, `rollout-2026-09-01T00-00-00-${ID_CODEX}.jsonl`);

const CONFIG_PATH = path.join(E2E_DIR, "config.json");

/** 現在時刻。全ファイルの mtime とログ内タイムスタンプの基準にする。 */
const NOW = new Date();

/** NOW から `minutesAgo` 分前の ISO 文字列を返す。 */
function isoMinutesAgo(minutesAgo) {
  return new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
}

/** オブジェクト配列を JSONL 文字列（各行 JSON.stringify、末尾に改行）に変換する。 */
function toJsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Claude セッション本体（type: user / assistant / bridge-session / custom-title を含む）
// ---------------------------------------------------------------------------

/** Desktop 起動セッション（bridge-session あり → Claude Desktop アカウント扱い）。 */
const desktopLines = [
  {
    type: "bridge-session",
    ownerAccountUuid: ID_DESKTOP,
    timestamp: isoMinutesAgo(9),
  },
  {
    type: "user",
    timestamp: isoMinutesAgo(8),
    cwd: "C:\\synthetic\\e2e-desktop",
    version: "2.1.0",
    gitBranch: "main",
    entrypoint: "claude-desktop",
    message: { content: "E2E ボード表示テスト用のセッションです" },
  },
  {
    type: "assistant",
    timestamp: isoMinutesAgo(7),
    message: {
      model: "claude-sonnet-5",
      content: [{ type: "text", text: "了解しました。ボードに表示されます。" }],
    },
  },
];

/** CLI セッション A（custom-title.json で正式タイトルを上書きする）。 */
const cliALines = [
  {
    type: "user",
    timestamp: isoMinutesAgo(6),
    cwd: "C:\\synthetic\\e2e-cli-a",
    version: "1.5.0",
    gitBranch: "feature/e2e",
    entrypoint: "cli",
    message: { content: "CLI セッション A: リスト表示テスト用です" },
  },
  {
    type: "assistant",
    timestamp: isoMinutesAgo(5),
    message: {
      model: "claude-opus-5",
      content: [{ type: "text", text: "承知しました。" }],
    },
  },
];

/** CLI セッション B（JSONL 内の custom-title 行でタイトルを上書きする。custom-title.json は無し）。 */
const cliBLines = [
  {
    type: "user",
    timestamp: isoMinutesAgo(4),
    cwd: "C:\\synthetic\\e2e-cli-b",
    version: "1.5.0",
    gitBranch: "HEAD",
    entrypoint: "cli",
    message: { content: "CLI セッション B: 絞り込みテスト用です" },
  },
  {
    type: "assistant",
    timestamp: isoMinutesAgo(3),
    // T-026: マスク検証用に合成トークン（sk-ant- 形式。実際のキーではない）を仕込む。
    // maskSecrets が「先頭 4 文字 + ••••」に変換することを e2e/keyboard-and-refresh.spec.ts で確認する。
    message: {
      model: "claude-sonnet-5",
      content: [
        {
          type: "text",
          text: "了解しました。認証情報の例: sk-ant-FAKE1234567890abcdefFAKE（合成データ）",
        },
      ],
    },
  },
  {
    type: "custom-title",
    timestamp: isoMinutesAgo(3),
    customTitle: "インラインカスタムタイトルB",
  },
];

// ---------------------------------------------------------------------------
// Codex セッション本体（type: session_meta / turn_context / event_msg / response_item）
// ---------------------------------------------------------------------------

const codexLines = [
  {
    timestamp: isoMinutesAgo(6),
    type: "session_meta",
    payload: {
      cwd: "C:\\synthetic\\e2e-codex",
      originator: "codex_exec",
      cli_version: "1.0.0",
      model_provider: "openai",
    },
  },
  {
    timestamp: isoMinutesAgo(5),
    type: "turn_context",
    payload: { model: "gpt-5-codex" },
  },
  {
    timestamp: isoMinutesAgo(4),
    type: "event_msg",
    payload: { type: "user_message", message: "Codex セッション: E2E テスト用です" },
  },
  {
    timestamp: isoMinutesAgo(3),
    type: "response_item",
    payload: { type: "message", role: "assistant", content: "応答本文のテストです" },
  },
  {
    timestamp: isoMinutesAgo(2),
    type: "event_msg",
    payload: { type: "task_complete", last_agent_message: "タスクを完了しました" },
  },
];

// ---------------------------------------------------------------------------
// 書き込み
// ---------------------------------------------------------------------------

async function main() {
  // 毎回作り直す。
  await rm(E2E_DIR, { recursive: true, force: true });

  await mkdir(DIR_DESKTOP, { recursive: true });
  await mkdir(DIR_CLI_A, { recursive: true });
  await mkdir(DIR_CLI_B, { recursive: true });
  await mkdir(CLAUDE_SESSIONS_DIR, { recursive: true }); // 空でよい（稼働中プロセスなしを表す）
  await mkdir(path.dirname(CUSTOM_TITLE_CLI_A), { recursive: true });
  await mkdir(CODEX_DAY_DIR, { recursive: true });

  await writeFile(JSONL_DESKTOP, toJsonl(desktopLines), "utf-8");
  await writeFile(JSONL_CLI_A, toJsonl(cliALines), "utf-8");
  await writeFile(JSONL_CLI_B, toJsonl(cliBLines), "utf-8");
  await writeFile(
    CUSTOM_TITLE_CLI_A,
    `${JSON.stringify({ customTitle: "カスタムタイトルのセッションA" })}\n`,
    "utf-8",
  );
  await writeFile(JSONL_CODEX, toJsonl(codexLines), "utf-8");

  // sinceDays: 14（既定フィルタ）に収まるよう、mtime を「現在」にする。
  // これにより activeWindowMinutes（既定 5 分）内となり、state は running プロセスが無くても active になる。
  for (const jsonlPath of [JSONL_DESKTOP, JSONL_CLI_A, JSONL_CLI_B, JSONL_CODEX]) {
    await utimes(jsonlPath, NOW, NOW);
  }

  const config = {
    roots: [CLAUDE_ROOT, CODEX_ROOT],
    port: 4317,
    accounts: { "claude:cli": "E2E CLI" },
  };
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf-8");

  console.log("[build-fixtures] 合成フィクスチャを再作成しました（Claude 3 件 / Codex 1 件）。");
}

main().catch((error) => {
  console.error("[build-fixtures] フィクスチャの生成に失敗しました。", error);
  process.exitCode = 1;
});
