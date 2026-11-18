import type { TimelineEvent } from "@/data/international-timeline";
import { REVISED_EVENTS } from "@/data/international-timeline-revision";
import { US_SOURCE_EVENTS, US_TIMELINE_REVISION } from "@/data/international-timeline-us";
import { plainText } from "./capitalism-richtext";

function text(event: TimelineEvent) {
  return event.body.startsWith(`${event.date}\n`) ? event.body.slice(event.date.length + 1) : event.body;
}

/** One incremental import; never reapply it to later edits, deletions or additions. */
export function mergeUsTimeline(saved: TimelineEvent[]): TimelineEvent[] {
  if (saved.some(event => event.usRevision === US_TIMELINE_REVISION)) return saved;
  const incoming = new Map(US_SOURCE_EVENTS.map(event => [event.id, event]));
  const baselines = new Map(REVISED_EVENTS.map(event => [event.id, event]));
  const merged = saved.map(event => {
    const addition = incoming.get(event.id);
    const marker = { usRevision: US_TIMELINE_REVISION };
    if (!addition) return { ...event, ...marker };
    incoming.delete(event.id);
    const baseline = baselines.get(event.id)!;
    const unedited = event.body === baseline.body;
    const date = event.date === baseline.date ? addition.date : event.date;
    // Replace untouched US wording; preserve every user edit and existing shared/Japan detail.
    if (unedited && event.region === "us" && event.scope !== "global") {
      return { ...event, ...marker, title: addition.title, date, body: `${date}\n${text(addition)}` };
    }
    const current = text(event);
    const extra = text(addition).split("\n").filter(line => !plainText(current).includes(line));
    return { ...event, ...marker, date, body: `${event.body.startsWith(`${event.date}\n`) ? `${date}\n` : ""}${current}${extra.length ? `\n${extra.join("\n")}` : ""}` };
  });
  // Deleted existing entries stay deleted; only truly new source IDs are appended.
  return [...merged, ...[...incoming.values()].filter(event => !baselines.has(event.id))];
}
