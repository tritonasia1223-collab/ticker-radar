import { REGIONS, type TimelineEvent } from "@/data/international-timeline";
import { mergeTimelineRevision, validEnd } from "./international-timeline";

export type DeletedTimelineEvent = { event: TimelineEvent; deletedAt: string };
export type TimelineDraft = { schemaVersion: 1; events: TimelineEvent[]; deleted: DeletedTimelineEvent[]; imports?: string[] };

function validEvent(e: TimelineEvent) {
  return e && typeof e.id === "string" && Number.isInteger(e.year) && e.year >= 1800 && e.year <= 2100
    && (e.month == null || Number.isInteger(e.month) && e.month >= 1 && e.month <= 12)
    && (e.scope == null || e.scope === "regional" || e.scope === "global")
    && (e.groupId == null || typeof e.groupId === "string") && (e.endYear == null || validEnd(e))
    && REGIONS.some(r => r.id === e.region) && [e.date, e.country, e.title, e.body].every(v => typeof v === "string")
    && (e.lane === undefined || ["us", "de", "fr", "uk", "jp", "eu", "emerging", "oil"].includes(e.lane))
    && (e.labels === undefined || Array.isArray(e.labels) && e.labels.every(v => typeof v === "string"));
}
function validEvents(value: unknown): value is TimelineEvent[] {
  return Array.isArray(value) && value.every(validEvent) && new Set(value.map(e => e.id)).size === value.length;
}

export function readTimelineDraft(raw: string | null): TimelineDraft {
  if (!raw) return { schemaVersion: 1, events: mergeTimelineRevision(), deleted: [] };
  const value = JSON.parse(raw);
  // Old array drafts receive the completed source migrations once before being wrapped.
  if (validEvents(value)) return { schemaVersion: 1, events: mergeTimelineRevision(value), deleted: [] };
  if (value?.schemaVersion !== 1 || !validEvents(value.events) || !Array.isArray(value.deleted)
    || (value.imports !== undefined && (!Array.isArray(value.imports) || !value.imports.every((v: unknown) => typeof v === "string")))
    || !value.deleted.every((d: DeletedTimelineEvent) => d && validEvent(d.event) && typeof d.deletedAt === "string")
    || !validEvents(value.deleted.map((d: DeletedTimelineEvent) => d.event))
    || value.deleted.some((d: DeletedTimelineEvent) => value.events.some((e: TimelineEvent) => e.id === d.event.id))) throw new Error("Invalid timeline draft");
  // An intentionally empty collection stays empty, even after every seeded event was deleted.
  return value;
}

export function deleteTimelineEvent(draft: TimelineDraft, id: string): TimelineDraft {
  const event = draft.events.find(e => e.id === id);
  if (!event) return draft;
  return { ...draft, events: draft.events.filter(e => e.id !== id), deleted: [{ event, deletedAt: new Date().toISOString() }, ...draft.deleted] };
}
export function restoreTimelineEvent(draft: TimelineDraft, id: string): TimelineDraft {
  const entry = draft.deleted.find(d => d.event.id === id);
  if (!entry || draft.events.some(e => e.id === id)) return draft;
  return { ...draft, events: [...draft.events, entry.event], deleted: draft.deleted.filter(d => d.event.id !== id) };
}
