// Vercel serverless entry point — serves the read API.
// The long-running collection (Apify) is disabled here via DEPLOY_TARGET=vercel
// and runs from a local/worker process instead (see script/collect.ts).
import express, { type Request, type Response } from "express";
// Static import so Vercel's bundler traces server/* into the function.
import { registerRoutes } from "../server/routes";

let app: express.Express | null = null;
function buildApp(): express.Express {
  const a = express();
  a.use(express.json());
  a.use(express.urlencoded({ extended: false }));
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
