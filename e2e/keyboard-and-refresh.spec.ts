// キーボード操作・更新・API 応答の E2E（T-026 やること 1）。
// (a) ボード region にフォーカス → ArrowDown でカードにフォーカス → Enter で詳細パネルが開く
//     → Escape で閉じてフォーカスがカード（data-session-key の要素）に戻る。
// (b) 「更新」ボタン → POST /api/refresh が呼ばれる → role="status" に「自動更新: 接続」が出る。
// (c) GET /api/sessions の応答に lastMessage / title が含まれ、フィクスチャに仕込んだ
//     sk-ant- 形式の合成トークン（build-fixtures.mjs のセッション B の assistant メッセージ）が
//     「••••」にマスクされている（生のトークン文字列は応答に含まれない）。
// (d) 存在しない id の GET /api/sessions/claude/00000000-0000-4000-8000-0000000000ff が
//     404 で { error: { code, message, hint } } を返す。
// フィクスチャ・サーバ起動は main-flow.spec.ts と同じ（playwright.config.ts の webServer）。

import { expect, test } from "@playwright/test";

/** build-fixtures.mjs がセッション B の assistant メッセージに仕込む合成トークン（実際の鍵ではない）。 */
const SYNTHETIC_TOKEN = "sk-ant-FAKE1234567890abcdefFAKE";

test("ボード: ArrowDown → Enter で詳細パネル → Escape でカードにフォーカスが戻る", async ({
  page,
}) => {
  await page.goto("/");

  const board = page.locator('[data-feature="board"]');
  await expect(board).toBeVisible();
  // ボードの初期表示を待つ（列に最低 1 枚のカードが描画されるまで）。
  await expect(board.locator("[data-session-key]").first()).toBeAttached();

  await board.focus();
  await page.keyboard.press("ArrowDown");

  const focusedCard = page.locator("[data-session-key]:focus");
  await expect(focusedCard).toHaveCount(1);
  const focusedKey = await focusedCard.getAttribute("data-session-key");
  expect(focusedKey).not.toBeNull();

  await page.keyboard.press("Enter");

  const panel = page.locator('[data-feature="session-detail"][role="dialog"]');
  await expect(panel).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // フォーカスが元のカード（同じ data-session-key を持つ要素）に戻っている。
  const activeKey = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-session-key"),
  );
  expect(activeKey).toBe(focusedKey);
});

test("更新ボタン: POST /api/refresh が呼ばれ、自動更新ステータスが「接続」になる", async ({
  page,
}) => {
  await page.goto("/");

  // role="status" は詳細パネル読み込み中の Loading（aria-label="読み込み中"）とも一致するため、
  // LiveStatus 側だけを取りたい場合はテキストで絞り込む（ListRow.tsx 側と同様に厳密一致を使う）。
  const liveStatus = page.getByRole("status").filter({ hasText: "自動更新:" });
  // SSE 接続確立を待つ（初期表示直後はポーリング表示のことがあるため、既定のリトライ待ちで確認する）。
  await expect(liveStatus).toHaveText("自動更新: 接続");

  const refreshButton = page.getByRole("button", { name: "更新" });
  const [request] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/refresh") && response.request().method() === "POST",
    ),
    refreshButton.click(),
  ]);
  expect(request.ok()).toBe(true);
  const body = (await request.json()) as { ok: boolean };
  expect(body.ok).toBe(true);

  await expect(liveStatus).toHaveText("自動更新: 接続");
});

test("GET /api/sessions: lastMessage / title を含み、合成トークンがマスクされている", async ({
  request,
}) => {
  const response = await request.get("/api/sessions");
  expect(response.ok()).toBe(true);

  const body = (await response.json()) as {
    sessions: Array<{ key: string; title: string; lastMessage: string }>;
  };
  expect(body.sessions.length).toBeGreaterThan(0);
  for (const session of body.sessions) {
    expect(session).toHaveProperty("lastMessage");
    expect(session).toHaveProperty("title");
    expect(typeof session.lastMessage).toBe("string");
    expect(typeof session.title).toBe("string");
  }

  const raw = JSON.stringify(body);
  // 生のトークンは応答のどこにも含まれない。
  expect(raw).not.toContain(SYNTHETIC_TOKEN);
  // マスク後の伏せ字（先頭 4 文字 "sk-a" + "••••"）が含まれる。
  expect(raw).toContain("sk-a••••");
});

test("GET /api/sessions/claude/:id: 存在しない id は 404 で { error } を返す", async ({
  request,
}) => {
  const response = await request.get("/api/sessions/claude/00000000-0000-4000-8000-0000000000ff");
  expect(response.status()).toBe(404);

  const body = (await response.json()) as {
    error: { code: string; message: string; hint: string };
  };
  expect(body.error.code).toEqual(expect.any(String));
  expect(body.error.message).toEqual(expect.any(String));
  expect(body.error.hint).toEqual(expect.any(String));
});
