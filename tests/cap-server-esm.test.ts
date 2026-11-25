import { it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ts from "typescript";

it("loads collaboration and merges text under native server ESM without a TS resolver", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cap-server-esm-"));
  try {
    await writeFile(path.join(dir, "package.json"), '{"type":"module"}');
    for (const name of ["cap-collaboration", "cap-text-merge"]) {
      const source = await readFile(path.join(process.cwd(), "shared", `${name}.ts`), "utf8");
      const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
      await writeFile(path.join(dir, `${name}.js`), result.outputText);
    }
    const moduleUrl = pathToFileURL(path.join(dir, "cap-collaboration.js")).href;
    const script = `const {merge}=await import(${JSON.stringify(moduleUrl)}); const r=merge({text:'수출 수요가 소폭 늘었습니다.'},[{path:['text'],before:'수요가 소폭 늘었습니다.',after:'수요가 크게 늘었습니다.'}]); if(r.conflicts.length||r.doc.text!=='수출 수요가 크게 늘었습니다.') process.exit(2); console.log('native ESM merge OK');`;
    const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], { windowsHide: true });
    expect(result.stdout.trim()).toBe("native ESM merge OK");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
