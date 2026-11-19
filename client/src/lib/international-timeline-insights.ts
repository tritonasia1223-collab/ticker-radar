import { INSIGHT_EVENTS, INSIGHT_TIMELINE_REVISION } from "@/data/international-timeline-insights";
import type { TimelineEvent } from "@/data/international-timeline";
import type { TimelineDraft } from "./international-timeline-draft";
import { mergeTimelineRevision } from "./international-timeline";

/** Explicit IDs only: never infer replacements from edited prose. */
export function mergeInsightTimeline(draft: TimelineDraft): TimelineDraft {
  if (draft.imports?.includes(INSIGHT_TIMELINE_REVISION)) return draft;
  const baseline = new Map(mergeTimelineRevision().map(e => [e.id, e]));
  const imported = new Map(INSIGHT_EVENTS.map(e => [e.id, e]));
  const present = new Set([...draft.events.map(e => e.id), ...draft.deleted.map(d => d.event.id)]);
  // An intentionally empty or fully custom collection is not a seed to overwrite.
  if (!draft.events.some(e => baseline.has(e.id))) return draft;
  const events = draft.events.map(saved => {
    const next = imported.get(saved.id);
    const old = baseline.get(saved.id);
    if (!next || !old) return saved;
    const textEdited = saved.body !== old.body;
    const dateEdited = textEdited || ["year", "month", "date", "endYear", "endMonth"].some(key => saved[key as keyof TimelineEvent] !== old[key as keyof TimelineEvent]);
    const countryEdited = saved.country !== old.country || saved.region !== old.region || saved.lane !== old.lane;
    const date = dateEdited ? saved.date : next.date;
    return {
      ...saved, ...next,
      type: saved.type ?? next.type ?? "event",
      ...(dateEdited ? { year: saved.year, month: saved.month, date: saved.date, endYear: saved.endYear, endMonth: saved.endMonth } : { endYear: null, endMonth: null }),
      // Preserve the exact rich text, including its hidden date prefix, when edited.
      ...(textEdited ? { title: saved.title, body: saved.body } : { body: next.body.replace(`${next.date}\n`, `${date}\n`) }),
      ...(countryEdited ? { country: saved.country, region: saved.region, lane: saved.lane } : {}),
      ...(saved.scope !== old.scope ? { scope: saved.scope } : {}),
      ...(saved.groupId !== old.groupId ? { groupId: saved.groupId } : {}),
    };
  });
  for (const event of INSIGHT_EVENTS) {
    // Missing old IDs may have been deleted before the recoverable-trash feature.
    if (!present.has(event.id) && !baseline.has(event.id)) events.push(event);
  }
  return { ...draft, events, imports: [...(draft.imports ?? []), INSIGHT_TIMELINE_REVISION] };
}
