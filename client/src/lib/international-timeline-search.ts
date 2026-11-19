import type { TimelineEvent, TimelineLane } from "@/data/international-timeline";
import { eventLanes } from "./international-timeline-lanes";
import { eventLabels } from "./international-timeline";
import { plainText } from "./capitalism-richtext";

/** Types are data, not an enum: new values need no UI or parser changes. */
export function timelineTypes(events: TimelineEvent[]): string[] {
  return [...new Set(events.map(event => event.type ?? "event"))].sort();
}

export function searchTimeline(events: TimelineEvent[], search: string, lanes: TimelineLane[], editingId: string | null = null): TimelineEvent[] {
  const types = new Set<string>();
  const query = search.replace(/(?:^|\s)type:([^\s]+)/gi, (_, type: string) => {
    types.add(type.toLowerCase());
    return " ";
  }).trim().toLowerCase();
  return events.filter(event => {
    // Major-event bands provide context regardless of text, type or country filters.
    if (event.scope === "global") return true;
    if (!eventLanes(event).some(lane => lanes.includes(lane))) return false;
    if (types.size && !types.has((event.type ?? "event").toLowerCase())) return false;
    return event.id === editingId || `${event.year} ${event.date} ${event.country} ${eventLabels(event).join(" ")} ${plainText(event.body)}`.toLowerCase().includes(query);
  });
}
