// GET /api/sessions: 索引が持つセッション要約の一覧を返す。
// GET /api/sessions/:tool/:id: 索引が持つ jsonlPath から詳細（直近メッセージ）を取り出して返す（T-014）。
// ARCHITECTURE.md §2.1「server/routes → sources は禁止」に合わせ、詳細取得の実処理
// （readClaudeDetail / readCodexDetail）は型だけを import し、実物は必ず呼び出し側
// （app.ts 経由で index.ts）が渡す（T-015 第 2 段階でのレビュー引き継ぎ: 既定 import を撤去）。
// route はパスをリクエストパラメータから組み立てず、常に index.getSource() が返す jsonlPath だけを使う。

import { Hono } from "hono";
import { toApiError } from "../errors.js";
import type { readClaudeDetail } from "../sources/claude/detail.js";
import type { readCodexDetail } from "../sources/codex/detail.js";
import type { SessionIndex } from "../store/index.js";

/** id パラメータの検証用パターン（UUID / threadId 形式。大文字小文字を区別しない）。 */
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** createSessionsRoute の依存。 */
export interface SessionsRouteDeps {
  /** `getAll()` の要素（SessionSummary）は索引と共有参照なので加工しない（T-012 引き継ぎ）。 */
  index: Pick<SessionIndex, "getAll" | "get" | "getSource">;
  /** 現在時刻。省略時は `() => new Date()`（テストでの差し替え用）。 */
  now?: () => Date;
  /** 詳細取得の実処理。sources を直接 import しないため、呼び出し側が実物（またはテスト用フェイク）を渡す。 */
  readClaudeDetail: typeof readClaudeDetail;
  readCodexDetail: typeof readCodexDetail;
}

/** `GET /sessions`, `GET /sessions/:tool/:id` を持つ Hono インスタンスを作る。`app.ts` が `/api` 配下にマウントする。 */
export function createSessionsRoute(deps: SessionsRouteDeps): Hono {
  const now = deps.now ?? (() => new Date());
  const readClaudeDetail = deps.readClaudeDetail;
  const readCodexDetail = deps.readCodexDetail;
  const route = new Hono();

  route.get("/sessions", (c) => {
    return c.json({
      sessions: deps.index.getAll(),
      generatedAt: now().toISOString(),
    });
  });

  route.get("/sessions/:tool/:id", async (c) => {
    const toolParam = c.req.param("tool");
    const idParam = c.req.param("id");

    // 検証前の値でパス・key・ログを作らない。tool / id の形が合わなければここで即 400。
    if ((toolParam !== "claude" && toolParam !== "codex") || !ID_PATTERN.test(idParam)) {
      return c.json(
        toApiError({
          code: "invalid_id",
          message: "セッション ID の形式が不正です。",
          hint: "一覧から選択し直してください。",
        }),
        400,
      );
    }

    const key = `${toolParam}:${idParam.toLowerCase()}`;
    const summary = deps.index.get(key);
    const source = deps.index.getSource(key);

    if (summary === undefined || source === undefined) {
      return c.json(
        toApiError({
          code: "not_found",
          message: "セッションが見つかりません。",
          hint: "一覧を「更新」してから選択し直してください。",
        }),
        404,
      );
    }

    const detailResult =
      source.tool === "claude"
        ? await readClaudeDetail(source.jsonlPath)
        : await readCodexDetail(source.jsonlPath);

    if (!detailResult.ok) {
      // detailResult.error.message には実パスが含まれ得るため使わず、固定文言に置き換える。
      return c.json(
        toApiError({
          code: detailResult.error.code,
          message: "セッションログを読み取れませんでした。",
          hint: "ファイルが削除されていないか確認し、「更新」を押してください。",
        }),
        500,
      );
    }

    return c.json({
      ...summary,
      recentMessages: detailResult.value.recentMessages,
      parseWarnings: detailResult.value.parseWarnings,
    });
  });

  return route;
}
