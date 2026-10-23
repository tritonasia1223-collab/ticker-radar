// Reviewed per-note changes only; dry run by default. Never overwrite a live snapshot.
import fs from "node:fs";
import assert from "node:assert/strict";
import { planNarrativeRevision, type NarrativeRevision } from "./lib/comparison-narrative.js";
import { insightProse } from "../shared/comparison-scenes.js";
import { DIAGRAM_HEADER, LABEL_HEADER } from "../shared/comparison-compat.js";
import type { Resource, EditRequest } from "../shared/cap-collaboration.js";
const apply = process.argv.includes("--apply");
const path = process.argv.find(v => v.startsWith("--plan="))?.slice(7);
if (!path) throw new Error("Pass --plan=path to reviewed JSON");
const entries: NarrativeRevision[] = JSON.parse(fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "")).entries;
const base = "https://ticker-radar-five.vercel.app/api/capitalism/collab/";
const headers = { [DIAGRAM_HEADER]: "1", [LABEL_HEADER]: "1", "Content-Type": "application/json" };
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const journal = `output/narrative-publication-${stamp}.json`;
const records: any[] = [];
fs.mkdirSync("output", { recursive: true });
const save = () => fs.writeFileSync(journal, JSON.stringify({ apply, plan: path, records }, null, 2));
const read = async (path: string): Promise<any> => {
  const r = await fetch(base + path, { headers, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Read failed ${r.status}`);
  return r.json();
};
const backup: Resource[] = await read("insights");
fs.writeFileSync(`output/narrative-backup-${stamp}.json`, JSON.stringify(backup, null, 2));
const session = crypto.randomUUID();
const preserved = (doc: any) => { const { balance, scenes, ...rest } = doc; return { ...rest, text: insightProse(rest.text) }; };
for (const entry of entries) {
  const current: Resource = await read(`resource?key=${encodeURIComponent(entry.key)}`);
  const plan = planNarrativeRevision(current, entry);
  if (!plan.changes.length) { records.push({ key: entry.key, skipped: plan.reason ?? "unchanged" }); save(); continue; }
  const op: EditRequest = { id: crypto.randomUUID(), session, editor: "인사이트 도표 재검토 반영", resource: entry.key, schemaVersion: 2, ifVersion: current.version, changes: plan.changes };
  const record: any = { key: entry.key, before: current, op, status: apply ? "pending" : "planned" };
  records.push(record); save();
  if (!apply) continue;
  const r = await fetch(base + "edit", { method: "POST", headers, body: JSON.stringify(op), signal: AbortSignal.timeout(30000) });
  record.status = r.status; record.result = await r.json(); save();
  if (r.ok) { assert.deepEqual(preserved(record.result.doc), preserved(current.doc)); record.preservedOriginalFields = true; save(); }
  else if (r.status !== 409) throw new Error(`Write failed ${r.status}; see ${journal}`);
}
const after: Resource[] = await read("insights");
fs.writeFileSync(`output/narrative-after-${stamp}.json`, JSON.stringify(after, null, 2));
console.log(JSON.stringify({ apply, journal, active: after.filter(r => r.doc).length, diagrams: after.filter(r => r.doc?.balance).length, results: records.map(r => ({ key: r.key, status: r.status, skipped: r.skipped, preserved: r.preservedOriginalFields })) }, null, 2));
