import express from "express";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createServer as createViteServer } from "vite";
import viteConfig from "../vite.config";

// Offline UI preview. No credentials, production routes, proxies, or database.
const app = express();
const server = createServer(app);
app.use("/api", (_req, res) => {
  res.status(403).json({ error: "화면 미리보기에서는 서버 자료에 접근하지 않습니다." });
});
const vite = await createViteServer({
  ...viteConfig, configFile: false, appType: "custom",
  cacheDir: process.env.COMPANION_PREVIEW_CACHE_DIR || "node_modules/.vite-companion",
  server: { ...viteConfig.server, middlewareMode: true, hmr: { server }, allowedHosts: ["localhost", "127.0.0.1"] },
});
app.use(vite.middlewares);
app.use(async (req, res, next) => {
  if (req.method !== "GET") { res.sendStatus(405); return; }
  try {
    const template = await readFile(new URL("../client/index.html", import.meta.url), "utf8");
    res.type("html").send(await vite.transformIndexHtml(req.originalUrl, template));
  } catch (error) { next(error); }
});
const port = Number(process.env.COMPANION_PREVIEW_PORT || 5197);
server.listen(port, "127.0.0.1", () => {
  console.log(`Companion preview: http://127.0.0.1:${port}/#/international-timeline`);
  console.log("Local example replies only. No GPT or database connection.");
});
async function shutdown() { await vite.close(); server.close(); }
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
