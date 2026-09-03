// 主要導線の E2E（T-026）。
// ボード表示 → リスト切替 → 「Claude」で絞り込み → 行クリックで詳細パネル → Esc で閉じる → ボードに戻す。
// 加えて GET /api/health の疎通も確認する。
// フィクスチャは e2e/setup/build-fixtures.mjs が生成する合成データ（Claude 3 件 / Codex 1 件、
// 実データ・実パス・実 UUID は含まない）。playwright.config.ts の webServer が起動前に毎回作り直す。

import { expect, test } from "@playwright/test";

/** フィクスチャの総セッション数（Claude 3 件 + Codex 1 件）。build-fixtures.mjs と合わせる。 */
const TOTAL_SESSION_COUNT = 4;
/** フィクスチャの Claude セッション数。 */
const CLAUDE_SESSION_COUNT = 3;

test("ボード → リスト → 絞り込み → 詳細パネル → Esc → ボード", async ({ page, request }) => {
  await test.step("GET /api/health が疎通し、roots が 2 件返る", async () => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { ok: boolean; roots: string[] };
    expect(body.ok).toBe(true);
    expect(body.roots).toHaveLength(2);
    // フィクスチャの roots で起動していること（既定の実 roots へ静かにフォールバックしていない）
    for (const root of body.roots) {
      expect(root.replace(/\\/g, "/")).toContain("local-data/e2e/");
    }
  });

  await test.step("初期表示: ボードに列が出る", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AI-Manager" })).toBeVisible();
    const board = page.locator('[data-feature="board"]');
    await expect(board).toBeVisible();
    await expect(board.locator("[data-column-key]").first()).toBeVisible();
    expect(await board.locator("[data-column-key]").count()).toBeGreaterThan(0);
  });

  const displaySegment = page.getByRole("group", { name: "表示" });
  const filterSegment = page.getByRole("group", { name: "絞り込み" });

  await test.step("リストへ切替: グリッドと行がフィクスチャ件数分ある", async () => {
    await displaySegment.getByRole("button", { name: "リスト" }).click();
    const grid = page.locator('[data-feature="list"][role="grid"]');
    await expect(grid).toBeVisible();
    const rows = grid.locator('[role="row"][data-session-key]');
    await expect(rows).toHaveCount(TOTAL_SESSION_COUNT);
  });

  await test.step("「Claude」で絞り込み: Codex の行が消え、件数が一致する", async () => {
    const claudeButton = filterSegment.getByRole("button", { name: "Claude" });
    await claudeButton.click();
    await expect(claudeButton).toHaveAttribute("aria-pressed", "true");

    const grid = page.locator('[data-feature="list"][role="grid"]');
    const rows = grid.locator('[role="row"][data-session-key]');
    await expect(rows).toHaveCount(CLAUDE_SESSION_COUNT);
    await expect(page.getByText(`表示 ${CLAUDE_SESSION_COUNT} 件`)).toBeVisible();
  });

  await test.step("行をクリック: 詳細パネルが開く", async () => {
    const grid = page.locator('[data-feature="list"][role="grid"]');
    await grid.locator('[role="row"][data-session-key]').first().click();

    const panel = page.locator('[data-feature="session-detail"][role="dialog"]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("aria-label", "セッション詳細");
    await expect(panel.locator("h2")).not.toBeEmpty();
    await expect(panel.getByRole("heading", { name: /最近のメッセージ/ })).toBeVisible();
  });

  await test.step("Esc で詳細パネルが閉じる", async () => {
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-feature="session-detail"][role="dialog"]')).toHaveCount(0);
  });

  await test.step("ボードに戻して列が出ることを確認する", async () => {
    await displaySegment.getByRole("button", { name: "ボード" }).click();
    const board = page.locator('[data-feature="board"]');
    await expect(board).toBeVisible();
    expect(await board.locator("[data-column-key]").count()).toBeGreaterThan(0);
  });
});
