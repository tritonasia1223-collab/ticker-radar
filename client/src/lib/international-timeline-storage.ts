import type { TimelineEvent } from "@/data/international-timeline";
import type { TimelineDraft } from "./international-timeline-draft";
import { copy, diff, type Document, type Resource } from "../../../shared/cap-collaboration";
import { internationalDocumentSchema } from "../../../shared/international-storage";

export function eventDocument(event: TimelineEvent, deletedAt: string | null = null): Document {
  const { id, title, body, type, labels, year, month, date, endY, endM, endYear, endMonth, region, country, lane, scope, ...extra } = event;
  return copy({ title, body, type: type ?? "event", labels: labels ?? [],
    timing: { year, month: month ?? null, date, endY: endY !== undefined ? endY : endYear ?? null, endM: endY !== undefined ? endM ?? null : endMonth ?? null, endYear: endYear ?? null, endMonth: endMonth ?? null },
    position: { region, country, lane: lane ?? null, scope: scope ?? "regional" }, extra, deletedAt });
}
export function documentEvent(resource: Resource) {
  const doc = internationalDocumentSchema.parse(resource.doc), p = doc.position;
  const event = { ...doc.extra, id: resource.key.slice(5), title: doc.title, body: doc.body, type: doc.type, labels: doc.labels,
    ...doc.timing, region: p.region, country: p.country, ...(p.lane ? { lane: p.lane } : {}), scope: p.scope } as TimelineEvent;
  return { event, deletedAt: doc.deletedAt };
}
export function draftResources(draft: TimelineDraft): Resource[] {
  return [...draft.events.map(event => ({ key: `intl:${event.id}`, version: 0, doc: eventDocument(event) })),
    ...draft.deleted.map(({ event, deletedAt }) => ({ key: `intl:${event.id}`, version: 0, doc: eventDocument(event, deletedAt) }))];
}
export function resourcesDraft(resources: Resource[], imports: string[] = []): TimelineDraft {
  const draft: TimelineDraft = { schemaVersion: 1, events: [], deleted: [], imports };
  for (const resource of resources) {
    if (!resource.doc) continue;
    const { event, deletedAt } = documentEvent(resource);
    if (deletedAt) draft.deleted.push({ event, deletedAt }); else draft.events.push(event);
  }
  draft.deleted.sort((a,b) => b.deletedAt.localeCompare(a.deletedAt));
  return draft;
}
/** Only explicit local changes, never a replacement of the remote collection. */
export function localImportChanges(baseline: TimelineDraft, local: TimelineDraft) {
  const base = new Map(draftResources(baseline).map(r => [r.key, r.doc]));
  const records = draftResources(local);
  // An explicitly empty old collection remains intentional; preserve its missing seeds as tombstones.
  if (!local.events.length && !local.deleted.length) for (const event of baseline.events) records.push({ key: `intl:${event.id}`, version: 0, doc: eventDocument(event, new Date().toISOString()) });
  return records.map(r => ({ key: r.key, changes: diff(base.get(r.key) ?? null, r.doc) })).filter(r => r.changes.length);
}
