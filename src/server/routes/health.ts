// GET /api/health: 起動状態・ルート一覧・監視モード・プロセス情報取得可否・警告件数を返す。
// ローカル専用 API のため roots は実パスを返す設計（ARCHITECTURE.md §3 の cwd と同じ扱い）。
// ただし homeDir 配下は `~` に置換して短くする。ログには出さない（呼び出し側の責務）。

import { Hono } from "hono";
import type { AppConfig } from "../config.js";
import type { SessionIndex } from "../store/index.js";

/** createHealthRoute の依存。 */
export interface HealthRouteDeps {
  index: Pick<SessionIndex, "getWarnings" | "isProcessInfoAvailable">;
  config: AppConfig;
  /** roots の `~` 置換用のホームディレクトリ。 */
  homeDir: string;
  /** package.json の version（index.ts が渡す）。 */
  version: string;
  /** T-015 が実装する監視モード。未指定なら "poll"。 */
  watcherMode?: () => "fs" | "poll" | "both";
}

/** パス文字列を `\` / `/` 区切りのセグメント配列に分割する（末尾の区切りは無視。大文字小文字は保持）。 */
function splitSegments(value: string): string[] {
  return value
    .replace(/[\\/]+$/, "")
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0);
}

/** 比較用に小文字化したセグメント配列を返す。 */
function toSegments(value: string): string[] {
  return splitSegments(value).map((segment) => segment.toLowerCase());
}

/**
 * root が homeDir 自身またはその配下なら、先頭を `~` に置換した表示用の文字列を返す。
 * 大文字小文字を無視し、区切り文字は `\` / `/` どちらでも判定する。homeDir 配下でなければそのまま返す。
 */
function displayRoot(root: string, homeDir: string): string {
  const homeSegments = toSegments(homeDir);
  const rootSegments = toSegments(root);
  if (homeSegments.length === 0 || rootSegments.length < homeSegments.length) {
    return root;
  }
  const isUnderHome = homeSegments.every((segment, index) => rootSegments[index] === segment);
  if (!isUnderHome) {
    return root;
  }
  // 表示は元の大文字小文字を保つ（比較だけ小文字で行う）。区切りは `/` に揃える
  const rest = splitSegments(root).slice(homeSegments.length);
  return rest.length > 0 ? `~/${rest.join("/")}` : "~";
}

/** `GET /health` を持つ Hono インスタンスを作る。`app.ts` が `/api` 配下にマウントする。 */
export function createHealthRoute(deps: HealthRouteDeps): Hono {
  const route = new Hono();

  route.get("/health", (c) => {
    return c.json({
      ok: true,
      version: deps.version,
      roots: deps.config.roots.map((root) => displayRoot(root, deps.homeDir)),
      watcher: deps.watcherMode?.() ?? "poll",
      processInfo: deps.index.isProcessInfoAvailable(),
      warnings: deps.index.getWarnings(),
    });
  });

  return route;
}
