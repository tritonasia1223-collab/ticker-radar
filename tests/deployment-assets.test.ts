import { describe, expect, it } from "vitest";
import { findMacroAsset } from "../shared/deployment-assets";
describe("monthly macro deployment verification", () => {
  it("finds a loader extracted into a shared route dependency", async () => {
    const chunks: Record<string, string> = { "Capitalism-a.js": 'import "./shared-b.js"; import "./index-c.js";', "shared-b.js": 'const url="/assets/capitalism-series-data.json";' };
    expect(await findMacroAsset("Capitalism-a.js", async n => chunks[n] ?? "")).toBe("capitalism-series-data.json");
  });
  it("stops cycles and does not follow external code", async () => {
    const reads: string[] = [];
    await expect(findMacroAsset("a.js", async n => { reads.push(n); return 'import "./a.js";import "https://external.test/b.js";'; })).rejects.toThrow("Missing macro");
    expect(reads).toEqual(["a.js"]);
  });
});
