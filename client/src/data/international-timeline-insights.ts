import type { TimelineEvent, TimelineLane } from "./international-timeline";
import source from "./international-timeline-insights.txt?raw";

export const INSIGHT_TIMELINE_REVISION = "insight-five-countries-20261118-v1";
const names = { us: "미국", de: "독일", fr: "프랑스", uk: "영국", jp: "일본", eu: "유럽 공동" };
export const INSIGHT_EVENTS: TimelineEvent[] = source.split(/\r?\n/).filter(line => line && !line.startsWith("#")).map((line, index) => {
  const [date, lane, title, details, existing] = line.split("|");
  const [year, month] = date.split(".").map(Number);
  const id = existing ? existing.startsWith("m") ? `mark-revision-20261118-${existing.slice(1)}` : `us-source-20261118-${existing.slice(1)}` : `insight-20261118-${index}`;
  return {
    id, year, month: month || null, date, title, body: `${date}\n${title}\n${details}`,
    region: lane === "us" || lane === "global" ? "us" : lane === "jp" ? "japan" : "europe",
    country: names[lane as keyof typeof names] ?? "미국",
    lane: lane === "global" ? "us" : lane as TimelineLane,
    scope: lane === "global" ? "global" : "regional", descriptionOnly: true,
  };
});
