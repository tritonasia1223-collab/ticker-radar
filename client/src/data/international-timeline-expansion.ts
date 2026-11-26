import rows from "./international-timeline-expansion.json";
import type { TimelineEvent, TimelineLane } from "./international-timeline";
import { parseTimelineDate } from "../lib/international-timeline-date";

export const EXPANSION_REVISION = "insight-soviet-emerging-20261126-v1";
export const EXPANSION_SOURCE = { key: "meta:meta-mwk6nv3f-dlck", version: 1795587557038, title: "유로달러와 미국 패권 추적(1969~)" };
export const EXPANSION_EVENTS: TimelineEvent[] = rows.map(row => {
  const timing = parseTimelineDate(row.date);
  if (!timing || timing.year > 1992) throw new Error(`Invalid expansion date: ${row.id}`);
  return {
    ...timing, id: `insight-expansion-20261126-${row.id}`, type: row.type,
    region: "emerging", lane: row.lane as TimelineLane, country: row.country,
    labels: row.country === "신흥국" ? [] : row.country.split("·"),
    title: row.title, body: `${timing.date}\n${row.title}\n${row.details}`,
    scope: "regional", descriptionOnly: true, revision: EXPANSION_REVISION,
    sourceRef: row.sourceRef, sourceResource: EXPANSION_SOURCE.key, sourceVersion: EXPANSION_SOURCE.version,
  } as TimelineEvent;
});
