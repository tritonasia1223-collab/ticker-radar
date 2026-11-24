// Isolated browser verification server. No environment, database or production API is loaded.
// Start: npx tsx script/preview-cap-conflicts.ts   Open /conflict-preview.html
import { createServer, mergeConfig } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import config from "../vite.config";
import { copy, merge, type Resource, type EditRequest } from "../shared/cap-collaboration";
const key = "meta:conflict-preview";
let resource: Resource = { key, version: 1, doc: { id: "conflict-preview", title: "1969~1973 연도별 상황표", text: "기업의 자율성이 소폭 확대됐습니다. 잔액은 20억 달러입니다.", tables: [], images: [], blocks: null } };
const ledger = new Map<string, string>();
const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
  if (!req.url?.startsWith("/api/")) return next();
  const reply = (status: number, data: unknown) => { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(data)); };
  try {
    if (req.method === "GET" && req.url.startsWith("/api/capitalism/collab/resource")) return reply(200, copy(resource));
    if (req.method === "POST" && req.url === "/api/capitalism/collab/edit") {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const op: EditRequest = JSON.parse(raw);
      if (op.resource !== key) return reply(400, { message: "합성 카드만 저장할 수 있습니다." });
      if (ledger.has(op.id)) { if (ledger.get(op.id) !== raw) return reply(400, { message: "요청 ID 재사용" }); return reply(200, { ...copy(resource), operation: op.id }); }
      const result = merge(resource.doc, op.changes);
      if (result.conflicts.length) return reply(409, { current: copy(resource), conflicts: result.conflicts });
      resource = { ...resource, version: resource.version + 1, doc: result.doc }; ledger.set(op.id, raw);
      return reply(200, { ...copy(resource), operation: op.id });
    }
    return reply(404, { message: "이 미리보기에는 운영 API가 연결되어 있지 않습니다." });
  } catch (e) { return reply(500, { message: (e as Error).message }); }
};
const app = await createServer(mergeConfig(config, { plugins: [{ name: "synthetic-api", configureServer(server) { server.middlewares.use(handle); } }], server: { host: "127.0.0.1", port: 5041, strictPort: true, fs: { allow: [process.cwd(), "C:/ticker-radar-master/node_modules"], deny: ["**/.env*", "**/.git/**"] } } }));
await app.listen();
console.log("Synthetic collaboration preview: http://127.0.0.1:5041/conflict-preview.html");
