import imported from "@/data/international-timeline-classified.json";
import type { TimelineEvent } from "@/data/international-timeline";
import type { TimelineDraft } from "./international-timeline-draft";

export const CLASSIFIED_REVISION = "classified-1969-1985-20261119-v1";
export const CLASSIFIED_BACKUP = "fiscus-international-timeline-before-classified-20261119";
export const CLASSIFIED_IMPORT = imported as { event: TimelineEvent; replaces: string[] }[];

/** User-authorized replacement, using reviewed identities rather than fuzzy title matching.
 * Run once: subsequent edits/deletions must not be overwritten on reload.
 */
export function mergeClassifiedTimeline(draft: TimelineDraft): TimelineDraft {
  if (draft.imports?.includes(CLASSIFIED_REVISION)) return draft;
  const replaced = new Set(CLASSIFIED_IMPORT.flatMap(row => [row.event.id, ...row.replaces]));
  const active = new Map(draft.events.map(event => [event.id, event]));
  const deleted = new Set(draft.deleted.map(row => row.event.id));
  const events = draft.events.filter(event => !replaced.has(event.id));
  for (const { event, replaces } of CLASSIFIED_IMPORT) {
    const ids = [event.id, ...replaces];
    const previous = ids.map(id => active.get(id)).find(Boolean);
    // Do not resurrect events explicitly moved to the recoverable trash.
    if (deleted.has(event.id) || !previous && ids.some(id => deleted.has(id))) continue;
    events.push({ ...event, ...(previous?.labels ? { labels: previous.labels } : {}) });
  }
  return { ...draft, events, imports: [...(draft.imports ?? []), CLASSIFIED_REVISION] };
}
