// Vercel serverless entry point — serves the read API.
// The long-running collection (Apify) is disabled here via DEPLOY_TARGET=vercel
// and runs from a local/worker process instead (see script/collect.ts).
import express from "express";
import { registerRoutes } from "../server/routes";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

registerRoutes(app);

export default app;
