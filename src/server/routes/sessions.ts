// GET /api/sessions: 索引が持つセッション要約の一覧を返す。
// ARCHITECTURE.md §2.1「server/routes → sources は禁止」のため、SessionIndex だけを見る。
// GET /api/sessions/:tool/:id（詳細）は T-014 の担当なので、ここでは実装しない。

import { Hono } from "hono";
import type { SessionIndex } from "../store/index.js";

/** createSessionsRoute の依存。 */
export interface SessionsRouteDeps {
  /** `getAll()` の要素（SessionSummary）は索引と共有参照なので加工しない（T-012 引き継ぎ）。 */
  index: Pick<SessionIndex, "getAll">;
  /** 現在時刻。省略時は `() => new Date()`（テストでの差し替え用）。 */
  now?: () => Date;
}

/** `GET /sessions` を持つ Hono インスタンスを作る。`app.ts` が `/api` 配下にマウントする。 */
export function createSessionsRoute(deps: SessionsRouteDeps): Hono {
  const now = deps.now ?? (() => new Date());
  const route = new Hono();

  route.get("/sessions", (c) => {
    return c.json({
      sessions: deps.index.getAll(),
      generatedAt: now().toISOString(),
    });
  });

  return route;
}
