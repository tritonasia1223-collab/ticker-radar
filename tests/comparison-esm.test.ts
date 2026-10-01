import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

it("loads comparison schemas in native Node ESM without a bundler", () => {
  // Serverless runs emitted ESM; Vite's extension resolution can hide broken imports.
  const directory = mkdtempSync(join(process.cwd(), ".comparison-esm-"));
  try {
    writeFileSync(join(directory, "package.json"), '{"type":"module"}');
    for (const name of ["cap-comparison", "comparison-alignment"]) {
      const source = readFileSync(join(process.cwd(), "shared", `${name}.ts`), "utf8");
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      writeFileSync(join(directory, `${name}.js`), outputText);
    }
    writeFileSync(join(directory, "check.mjs"), `
      import { comparisonInsightSchema } from "./cap-comparison.js";
      if (typeof comparisonInsightSchema.safeParse !== "function") process.exit(1);
    `);
    const result = spawnSync(process.execPath, [join(directory, "check.mjs")], {
      encoding: "utf8", timeout: 15000, env: { ...process.env, NODE_OPTIONS: "" },
    });
    expect(result.error, result.error?.message).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
