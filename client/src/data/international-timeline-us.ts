import type { TimelineEvent } from "./international-timeline";
import { TIMELINE_REVISION } from "./international-timeline-revision";
import { formatTimelineSource } from "@/lib/international-timeline-format";
import source from "./international-timeline-us-source.txt?raw";

export const US_TIMELINE_REVISION = "us-1970-1988-20261118-v1";
const entries = [...source.matchAll(/^\*\*([^*]+)\*\*\s*(.+)$/gm)];
// Match established IDs explicitly: do not guess identity from a user's edited title.
const existing: Record<number, number> = { 0: 0, 6: 9, 12: 23, 19: 39, 20: 42, 21: 49, 22: 57, 23: 60 };
const ends: Record<number, [number, number | null]> = { 1: [1971, null], 9: [1978, null], 15: [1980, 7], 17: [1982, 11], 18: [1985, null] };

function makeEvent(index: number, date: string, body: string, global: boolean, suffix = ""): TimelineEvent {
  const formatted = formatTimelineSource(body.replace(/🔴\s*/g, "").replace(/\s*\(대사건\)/g, "").replace(/\(대사건, G5\)/g, "(G5)"));
  const parts = date.match(/^(\d{4})(?:\.(\d{1,2}))?/)!;
  return {
    id: existing[index] !== undefined && !suffix ? `mark-revision-20261118-${String(existing[index]).padStart(2, "0")}` : `us-source-20261118-${index}${suffix}`,
    year: Number(parts[1]), month: parts[2] ? Number(parts[2]) : null, date,
    region: index === 20 ? "japan" : "us", country: index === 20 ? "일본" : "미국",
    scope: global ? "global" : "regional", title: formatted.split("\n")[0], body: `${date}\n${formatted}`,
    descriptionOnly: true, revision: TIMELINE_REVISION, usRevision: US_TIMELINE_REVISION,
    ...(ends[index] ? { endYear: ends[index][0], endMonth: ends[index][1] } : {}),
  };
}

export const US_SOURCE_EVENTS: TimelineEvent[] = entries.flatMap((entry, index) => {
  const date = entry[1].replace(/ \((?:MMF|401k)\)/, "");
  if (index === 23) {
    const [criticism, crash] = entry[2].split(" → 10.19 ");
    return [makeEvent(index, date, criticism, false), makeEvent(index, "1987.10.19", crash, true, "-black-monday")];
  }
  return [makeEvent(index, date, entry[2], entry[2].includes("🔴") || index === 22)];
});
