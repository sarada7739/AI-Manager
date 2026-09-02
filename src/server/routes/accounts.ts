// GET /api/accounts: 索引が集計したアカウント一覧を返す。
// ARCHITECTURE.md §2.1 のとおり、routes は SessionIndex だけを見る（sources を直接 import しない）。

import { Hono } from "hono";
import type { SessionIndex } from "../store/index.js";

/** createAccountsRoute の依存。 */
export interface AccountsRouteDeps {
  index: Pick<SessionIndex, "getAccounts">;
}

/** `GET /accounts` を持つ Hono インスタンスを作る。`app.ts` が `/api` 配下にマウントする。 */
export function createAccountsRoute(deps: AccountsRouteDeps): Hono {
  const route = new Hono();

  route.get("/accounts", (c) => {
    return c.json({ accounts: deps.index.getAccounts() });
  });

  return route;
}
