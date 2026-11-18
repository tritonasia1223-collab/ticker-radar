import type { TimelineEvent, TimelineLane, Region } from "@/data/international-timeline";

export const COUNTRY_LANES: { id: TimelineLane; name: string; region: Region; color: string }[] = [
  { id: "us", name: "미국", region: "us", color: "us" },
  { id: "de", name: "독일", region: "europe", color: "de" },
  { id: "fr", name: "프랑스", region: "europe", color: "fr" },
  { id: "uk", name: "영국", region: "europe", color: "uk" },
  { id: "jp", name: "일본", region: "japan", color: "jp" },
  { id: "emerging", name: "신흥국", region: "emerging", color: "emerging" },
  { id: "oil", name: "산유국", region: "oil", color: "oil" },
];
/** Country labels are optional annotations; removing one must not move its event. */
export function eventLanes(event: TimelineEvent): TimelineLane[] {
  if (event.lane) return event.lane === "eu" ? ["de", "fr", "uk"] : [event.lane];
  if (event.region !== "europe") return [event.region === "japan" ? "jp" : event.region];
  const matches: TimelineLane[] = [];
  if (/독일|서독/.test(event.country)) matches.push("de");
  if (/프랑스/.test(event.country)) matches.push("fr");
  if (/영국/.test(event.country)) matches.push("uk");
  return matches.length ? matches : ["de", "fr", "uk"];
}

/** Shared European events render once, spanning their visible country columns. */
export function eventLaneSpan(event: TimelineEvent, visible: TimelineLane[]) {
  const indexes = visible.flatMap((id, i) => eventLanes(event).includes(id) ? [i] : []);
  return indexes.length ? { start: indexes[0] + 2, span: indexes.at(-1)! - indexes[0] + 1 } : null;
}
