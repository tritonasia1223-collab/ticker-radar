// Vercel serverless entry point — serves the read API.
// The long-running collection (Apify) is disabled here via DEPLOY_TARGET=vercel
// and runs from a local/worker process instead (see script/collect.ts).
import express, { type Request, type Response } from "express";
// Static import so Vercel's bundler traces server/* into the function.
import { registerRoutes } from "../server/routes.js";

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

export default function handler(req: Request, res: Response) {
  try {
    if (!app) app = buildApp();
    return (app as unknown as (req: Request, res: Response) => void)(req, res);
  } catch (err: any) {
    res.status(500).json({ error: "API init failed", message: String(err?.message || err) });
  }
}
