import { serve } from "@hono/node-server";
import { Hono } from "hono";

// サーバの起動エントリ。第 1 段階の最小構成（GET /api/health のみ）
const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

const HOSTNAME = "127.0.0.1";
const PORT = 4317;

serve({
  fetch: app.fetch,
  hostname: HOSTNAME,
  port: PORT,
});
