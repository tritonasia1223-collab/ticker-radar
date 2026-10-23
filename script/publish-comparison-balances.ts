// Explicit, one-time additive publication through the same locked/audited API as editors.
// Default is dry-run. Never copy a preview document or restore a snapshot over live data.
import fs from "node:fs";
import { planBalanceSeed } from "./lib/comparison-balance-seed.js";
import { DIAGRAM_HEADER } from "../shared/comparison-compat.js";
import type { Resource, EditRequest } from "../shared/cap-collaboration.js";

const base = "https://ticker-radar-five.vercel.app/api/capitalism/collab/";
const apply = process.argv.includes("--apply");
const presets = JSON.parse(fs.readFileSync("data/comparison-insight-balances/2026-10-23.json", "utf8").replace(/^\uFEFF/, ""));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.mkdirSync("output", { recursive: true });
const journal = `output/balance-publication-${stamp}.json`;
const records: unknown[] = [];
const save = () => fs.writeFileSync(journal, JSON.stringify({ apply, records }, null, 2));
async function read(path: string) {
  const r = await fetch(base + path, { headers: { [DIAGRAM_HEADER]: "1" }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Read failed: ${r.status}`);
  return r.json();
}
const backup: Resource[] = await read("insights");
fs.writeFileSync(`output/insights-publication-backup-${stamp}.json`, JSON.stringify(backup, null, 2));
const session = crypto.randomUUID();
for (const entry of presets.entries) {
  const current: Resource = await read(`resource?key=${encodeURIComponent(entry.key)}`);
  const plan = planBalanceSeed(current, entry);
  if (!plan.changes.length) { records.push({ key: entry.key, skipped: plan.reason }); save(); continue; }
  const op: EditRequest = { id: crypto.randomUUID(), resource: entry.key, session, editor: "도표 초기 반영", schemaVersion: 2, ifVersion: current.version, changes: plan.changes };
  const record: any = { key: entry.key, before: current, op, status: apply ? "pending" : "planned" };
  records.push(record); save(); // Preserve exact request ID before any write for safe recovery.
  if (!apply) continue;
  const response = await fetch(base + "edit", { method: "POST", headers: { [DIAGRAM_HEADER]: "1", "Content-Type": "application/json" }, body: JSON.stringify(op), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  record.status = response.status; record.result = result; save();
  if (!response.ok && response.status !== 409) throw new Error(`Publication failed (${response.status}); journal: ${journal}`);
}
const after: Resource[] = await read("insights");
fs.writeFileSync(`output/insights-publication-after-${stamp}.json`, JSON.stringify(after, null, 2));
console.log(JSON.stringify({ apply, journal, activeBefore: backup.filter(r => r.doc).length, activeAfter: after.filter(r => r.doc).length, results: records.map((r: any) => ({ key: r.key, status: r.status, skipped: r.skipped })) }, null, 2));
