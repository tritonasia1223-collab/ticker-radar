// Vercel serverless entry point — serves the read API.
// The long-running collection (Apify) is disabled here via DEPLOY_TARGET=vercel
// and runs from a local/worker process instead (see script/collect.ts).
//
// routes/storage are imported lazily inside the handler so that any
// module-init failure (e.g. a missing DATABASE_URL throwing at import time)
// is surfaced as a readable JSON error instead of an opaque
// FUNCTION_INVOCATION_FAILED.
import express, { type Express, type Request, type Response } from "express";

let appPromise: Promise<Express> | null = null;

async function getApp(): Promise<Express> {
  if (!appPromise) {
    appPromise = (async () => {
      const { registerRoutes } = await import("../server/routes");
      const app = express();
      app.use(express.json());
      app.use(express.urlencoded({ extended: false }));
      registerRoutes(app);
      return app;
    })().catch((err) => {
      // Reset so a later invocation can retry, but rethrow for this one.
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

export default async function handler(req: Request, res: Response) {
  try {
    const app = await getApp();
    return (app as unknown as (req: Request, res: Response) => void)(req, res);
  } catch (err: any) {
    res.status(500).json({
      error: "API init failed",
      message: String(err?.message || err),
      hint: "Check that DATABASE_URL is set in Vercel env vars (Production).",
    });
  }
}
