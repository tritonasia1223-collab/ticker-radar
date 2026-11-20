// Vercel serverless entry point — serves the read API.
// The long-running collection (Apify) is disabled here via DEPLOY_TARGET=vercel
// and runs from a local/worker process instead (see script/collect.ts).
import express, { type Request, type Response } from "express";
// Static import so Vercel's bundler traces server/* into the function.
import { registerRoutes } from "../server/routes.js";
import { configureServerlessDatabase, databasePoolMode, acquireDatabaseRequest } from "../server/storage.js";
configureServerlessDatabase();

let app: express.Express | null = null;
function buildApp(): express.Express {
  const a = express();
  // 카드 저장은 카드 전체(붙여넣은 이미지 = base64 data URI 포함)를 통째로 POST 한다.
  // 기본 100KB 한도면 이미지 든 카드가 413 으로 거부돼 영구 저장 불가 → 넉넉히 상향.
  a.use(express.json({ limit: "8mb" }));
  a.use(express.urlencoded({ extended: false, limit: "8mb" }));
  registerRoutes(a);
  return a;
}

export default async function handler(req: Request, res: Response) {
  let release: (() => void) | undefined;
  try {
    // Non-secret transport diagnostic; makes the actual production pool selection verifiable.
    res.setHeader("X-Fiscus-Storage-Pool", databasePoolMode());
    release = await acquireDatabaseRequest();
    // A disconnected browser can close the response while its transaction still
    // runs. Release on the application's end(), never on socket close.
    if (!app) app = buildApp();
    // Keep the serverless invocation alive until Express has completed its
    // async route, rather than returning when Express merely dispatches it.
    await new Promise<void>((resolve) => {
      const end = res.end;
      res.end = function (...args: any[]) {
        try { return end.apply(this, args as any); }
        finally { release?.(); resolve(); }
      } as typeof res.end;
      res.once("finish", () => { release?.(); resolve(); });
      (app as unknown as (req: Request, res: Response) => void)(req, res);
    });
  } catch (err: any) {
    release?.();
    res.status(503).json({ error: "서버 연결을 확인하지 못했습니다. 기기 초안을 유지하고 다시 시도하세요." });
  }
}
