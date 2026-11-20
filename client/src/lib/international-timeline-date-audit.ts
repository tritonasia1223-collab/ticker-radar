import reviewed from "@/data/international-timeline-date-audit.json";
import type { TimelineEvent } from "@/data/international-timeline";
import type { TimelineDraft } from "./international-timeline-draft";

export const DATE_AUDIT_REVISION = reviewed.revision;
export const DATE_AUDIT_BACKUP = "fiscus-international-timeline-before-date-audit-20261120";
export const DATE_AUDIT = reviewed.rows as {
  id: string; before: TimelineEvent; patch: Partial<TimelineEvent>;
  additions: TimelineEvent[]; sources: string[]; existing: string[];
}[];

const protectedFields = ["title", "body", "year", "month", "date", "endY", "endM", "endYear", "endMonth", "region", "country", "lane", "scope"] as const;

/** Explicit, reviewed replacements only. Edited/deleted parents never spawn new children. */
export function mergeDateAuditTimeline(draft: TimelineDraft): TimelineDraft {
  if (draft.imports?.includes(DATE_AUDIT_REVISION)) return draft;
  const rules = new Map(DATE_AUDIT.map(rule => [rule.id, rule]));
  if (!draft.events.some(event => rules.has(event.id))) return draft;
  const present = new Set([...draft.events.map(e => e.id), ...draft.deleted.map(d => d.event.id)]);
  const additions: TimelineEvent[] = [];
  const events = draft.events.map(event => {
    const rule = rules.get(event.id);
    if (!rule || protectedFields.some(key => (event[key] ?? null) !== (rule.before[key] ?? null))) return event;
    for (const child of rule.additions) {
      if (present.has(child.id)) continue;
      present.add(child.id);
      additions.push({ ...child, labels: child.lane === event.lane ? event.labels ?? child.labels : child.labels });
    }
    return { ...event, ...rule.patch, labels: event.labels,
      // A user's custom classification wins over the reviewed default.
      type: event.type !== rule.before.type ? event.type : rule.patch.type ?? event.type };
  });
  return { ...draft, events: [...events, ...additions], imports: [...(draft.imports ?? []), DATE_AUDIT_REVISION] };
}
