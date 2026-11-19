import supplement from "@/data/international-timeline-supplement.json";
import type { TimelineEvent } from "@/data/international-timeline";
import type { TimelineDraft } from "./international-timeline-draft";

export const SUPPLEMENT_REVISION = "insight-audit-supplement-20261119-v1";
export const SUPPLEMENT_BACKUP = "fiscus-international-timeline-before-audit-supplement-20261119";
export const SUPPLEMENT = supplement as {
  additions: { event: TimelineEvent; sources: string[] }[];
  amendments: { id: string; expectedTitle: string; expectedBody: string; title: string; body: string; sources: string[] }[];
};

/** One reviewed import. Never infer identity or financial direction from edited prose. */
export function mergeSupplementTimeline(draft: TimelineDraft): TimelineDraft {
  if (draft.imports?.includes(SUPPLEMENT_REVISION)) return draft;
  const amendments = new Map(SUPPLEMENT.amendments.map(row => [row.id, row]));
  // Respect collections whose owner removed the original research entirely.
  if (!draft.events.some(event => amendments.has(event.id))) return draft;
  const present = new Set([...draft.events.map(event => event.id), ...draft.deleted.map(row => row.event.id)]);
  const events = draft.events.map(event => {
    const patch = amendments.get(event.id);
    if (!patch || event.body !== patch.expectedBody || event.title !== patch.expectedTitle) return event;
    // Dates, country/labels, type and other user metadata survive unchanged.
    return { ...event, title: patch.title, body: patch.body };
  });
  for (const { event } of SUPPLEMENT.additions) if (!present.has(event.id)) events.push({ ...event });
  return { ...draft, events, imports: [...(draft.imports ?? []), SUPPLEMENT_REVISION] };
}
