// Vercel build: client (vite) + a fully self-contained serverless function bundle.
//
// Why: @vercel/node traces a .ts entrypoint and may fail to include sibling
// server/*.ts + shared/*.ts files, causing `Cannot find module '/var/task/server/routes'`
// at runtime. We sidestep tracing entirely by pre-bundling api/index.ts into a single
// self-contained CommonJS file (api/index.js) with esbuild. Vercel then uses that
// already-bundled file as the function — no tracing of local imports required.
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

async function run() {
  console.log("[vercel-build] building client (vite)...");
  await viteBuild();

  console.log("[vercel-build] bundling serverless function (esbuild)...");
  await esbuild({
    entryPoints: ["api/_handler.ts"],
    platform: "node",
    target: "node20",
    bundle: true,
    format: "cjs",
    outfile: "api/index.js", // Vercel will use this bundled file as the function
    // Bundle ALL dependencies into the function so nothing relies on Vercel's
    // file tracing or node_modules layout. Keep optional native bits external.
    external: ["bufferutil", "utf-8-validate"],
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "info",
  });

  console.log("[vercel-build] done.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
