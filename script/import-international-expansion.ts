// Preview by default. --apply only creates missing approved records; never replaces an existing event.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { isDeepStrictEqual as equal } from "node:util";
import { EXPANSION_EVENTS, EXPANSION_REVISION, EXPANSION_SOURCE } from "../client/src/data/international-timeline-expansion.js";
import { eventDocument } from "../client/src/lib/international-timeline-storage.js";
import { internationalDocumentSchema } from "../shared/international-storage.js";
import type { EditRequest, Resource } from "../shared/cap-collaboration.js";

const api = "https://ticker-radar-five.vercel.app/api/capitalism/collab";
const recordArg = process.argv.find(arg => arg.startsWith("--record="))?.slice(9);
const recordFile = path.resolve(recordArg || "output/international-lane-expansion-20261126.json");
const read = async () => {
  const response = await fetch(api + "/international", { cache: "no-store", signal: AbortSignal.timeout(30000) });
  assert(response.ok, `Read failed: ${response.status}`);
  return (await response.json()).resources as Resource[];
};
const before = await read();
const known = new Map(before.map(resource => [resource.key, resource]));
const planned = EXPANSION_EVENTS.map(event => ({ key: `intl:${event.id}`, doc: eventDocument(event) }));
for (const resource of planned) internationalDocumentSchema.parse(resource.doc);
const missing = planned.filter(resource => !known.has(resource.key));
console.log(JSON.stringify({ mode: process.argv.includes("--apply") ? "apply" : "preview", existing: before.length, additions: missing.length, preservedExistingIds: planned.length - missing.length }));
if (!process.argv.includes("--apply")) process.exit(0);

type ImportRecord = { revision: string; source: typeof EXPANSION_SOURCE; before: Resource[]; requests: EditRequest[]; completed: string[]; status: string; [key: string]: unknown };
let record: ImportRecord;
try {
  record = JSON.parse(await fs.readFile(recordFile, "utf8"));
  assert.equal(record.revision, EXPANSION_REVISION);
  for (const request of record.requests) {
    const resource = planned.find(item => item.key === request.resource);
    assert(resource && equal(request.changes, [{ path: [], before: null, after: resource.doc }]), "Resume plan changed; inspect before writing");
  }
} catch (error: any) {
  if (error.code !== "ENOENT") throw error;
  const session = crypto.randomUUID();
  record = { revision: EXPANSION_REVISION, source: EXPANSION_SOURCE, before, requests: missing.map(resource => ({ id: crypto.randomUUID(), session, editor: "Codex · 소련·신흥국 1992까지 추가", schemaVersion: 2, resource: resource.key, changes: [{ path: [], before: null, after: resource.doc }] })), completed: [], status: "prepared", createdAt: new Date().toISOString() };
}
await fs.mkdir(path.dirname(recordFile), { recursive: true });
let writes = Promise.resolve();
const save = () => {
  const snapshot = JSON.stringify(record, null, 2);
  writes = writes.then(async () => { await fs.writeFile(recordFile + ".tmp", snapshot); await fs.rename(recordFile + ".tmp", recordFile); });
  return writes;
};
await save();
let cursor = 0;
const worker = async () => {
  while (cursor < record.requests.length) {
    const request = record.requests[cursor++];
    if (record.completed.includes(request.id)) continue;
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(api + "/edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(30000) });
        break;
      } catch (error) { if (attempt) throw error; }
    }
    const result = await response!.json();
    if (!response!.ok) { record.status = "needs-review"; record.failure = { resource: request.resource, status: response!.status, result }; await save(); throw new Error(`Compare-save rejected ${response!.status}; no overwrite attempted`); }
    assert(equal(result.doc, request.changes[0].after), "Unexpected saved content");
    record.completed.push(request.id);
    await save();
    if (record.completed.length % 10 === 0) console.log(JSON.stringify({ saved: record.completed.length, total: record.requests.length }));
  }
};
// Bound concurrent writes to the same limit as the shared browser engine.
const results = await Promise.allSettled([worker(), worker()]);
await writes;
for (const result of results) if (result.status === "rejected") throw result.reason;
const after = await read(), final = new Map(after.map(resource => [resource.key, resource]));
for (const request of record.requests) assert(equal(final.get(request.resource)?.doc, request.changes[0].after), `Verify new event ${request.resource}`);
const concurrentExistingChanges = record.before.filter(resource => !equal(final.get(resource.key)?.doc, resource.doc)).map(resource => resource.key);
record.status = "verified"; record.verifiedAt = new Date().toISOString(); record.afterCount = after.length;
record.originalResourcesPreserved = record.before.length - concurrentExistingChanges.length;
record.concurrentExistingChanges = concurrentExistingChanges;
await save();
console.log(JSON.stringify({ status: record.status, added: record.requests.length, originalResourcesPreserved: record.originalResourcesPreserved, concurrentExistingChanges, afterCount: after.length, recordFile }));
