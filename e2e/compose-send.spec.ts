// 指示送信（F-7 / T-033）の E2E。
// 実セッションが存在しない環境（フィクスチャには稼働中プロセスが無い）でも導線を検証できるよう、
// `page.route` でクライアントの API 応答をモックする。実 API の
// `POST /api/sessions/:tool/:id/message` は実セッションへは一切送らない
// （このファイル内でモックしたエンドポイントだけが呼ばれることを、呼び出し回数とリクエスト本文で確認する）。
// サーバ・クライアントの起動は main-flow.spec.ts と同じ（playwright.config.ts の webServer）。

import { expect, test } from "@playwright/test";

/** モックする稼働中 Claude セッションのキー（合成 UUID。実データではない）。 */
const RUNNING_KEY = "claude:00000000-0000-4000-8000-000000000099";
const RUNNING_ID = "00000000-0000-4000-8000-000000000099";
const RUNNING_TITLE = "E2E 送信テスト用セッション";
const RUNNING_CWD = "C:\\synthetic\\e2e-compose";

/** `GET /api/sessions` が返す `SessionSummary`（必須フィールドをすべて埋める）。 */
function buildRunningSession(nowIso: string) {
  return {
    key: RUNNING_KEY,
    tool: "claude",
    id: RUNNING_ID,
    title: RUNNING_TITLE,
    lastMessage: "モックされた最終メッセージです",
    lastRole: "assistant",
    cwd: RUNNING_CWD,
    branch: "main",
    model: "claude-sonnet-5",
    entrypoint: "cli",
    accountKey: "claude:cli",
    state: "running",
    stateReason: "process",
    pid: 4242,
    startedAt: nowIso,
    firstAt: nowIso,
    updatedAt: nowIso,
    logSizeBytes: 1234,
    subagentCount: 0,
    released: false,
  };
}

test("送信導線: 読み取り専用 OFF → 宛先選択 → 確認ダイアログ → 送信（モック）", async ({
  page,
}) => {
  const nowIso = new Date().toISOString();
  /** モック POST に届いたリクエスト本文（実送信でないことの担保として呼び出し回数と本文を検証する）。 */
  const messageRequests: Array<{ text: string }> = [];

  await test.step("API 応答をモックする（GET /api/sessions, GET /api/accounts, POST .../message）", async () => {
    await page.route("**/api/sessions", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sessions: [buildRunningSession(nowIso)],
          generatedAt: nowIso,
        }),
      });
    });

    await page.route("**/api/accounts", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ accounts: [] }),
      });
    });

    await page.route("**/api/sessions/claude/*/message", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.continue();
        return;
      }
      const body = request.postDataJSON() as { text: string };
      messageRequests.push({ text: body.text });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          sentAt: new Date().toISOString(),
          note: "配信されたか保留されたかは受信側の設定に従います",
        }),
      });
    });
  });

  await page.goto("/");

  const compose = page.locator('[data-feature="compose"]');
  await expect(compose).toBeVisible();

  const sendButton = compose.getByRole("button", { name: "送る" });
  const destinationSelect = compose.getByRole("combobox", { name: "宛先" });
  const textarea = compose.getByRole("textbox", { name: "指示" });

  await test.step("読み取り専用 ON（既定）: 「送る」が aria-disabled で理由が出る", async () => {
    await expect(sendButton).toHaveAttribute("aria-disabled", "true");
    await expect(
      compose.getByText("読み取り専用です。送るにはトグルを OFF にしてください"),
    ).toBeVisible();
  });

  await test.step("読み取り専用トグルを OFF にする", async () => {
    await page.getByRole("switch", { name: "読むだけ・送信はしない" }).click();
    await expect(page.getByText("送信できます（送る前に確認が出ます）")).toBeVisible();
  });

  await test.step("宛先セレクトに稼働中の Claude セッションが出る", async () => {
    await expect(destinationSelect).toHaveValue(RUNNING_KEY);
    await expect(destinationSelect.locator("option", { hasText: RUNNING_TITLE })).toHaveCount(1);
  });

  const bodyText = "E2E から送るテスト用の指示です";

  await test.step("テキストエリアに本文を入力する", async () => {
    await textarea.fill(bodyText);
    await expect(sendButton).not.toHaveAttribute("aria-disabled", "true");
  });

  await test.step("「送る」→ 確認ダイアログに宛先・本文が出る", async () => {
    await sendButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(RUNNING_TITLE, { exact: false })).toBeVisible();
    await expect(dialog.getByText(bodyText)).toBeVisible();
  });

  await test.step("Esc でダイアログを閉じる: モック POST はまだ呼ばれていない", async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(messageRequests).toHaveLength(0);
  });

  await test.step("もう一度「送る」→ ダイアログの「送る」でモック POST が 1 回呼ばれる", async () => {
    await sendButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes("/message") && response.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "送る" }).click(),
    ]);

    expect(messageRequests).toHaveLength(1);
    expect(messageRequests[0]?.text).toBe(bodyText);
  });

  await test.step("ヘッダ帯に「送信: 投函しました」が出て、テキストエリアが空になる", async () => {
    const sendStatus = page.getByRole("status").filter({ hasText: "送信:" });
    await expect(sendStatus).toHaveText("送信: 投函しました");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(textarea).toHaveValue("");
  });
});
