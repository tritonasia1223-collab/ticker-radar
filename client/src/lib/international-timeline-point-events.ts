import { plainText, splitRichTextAt } from "./capitalism-richtext";
import type { TimelineEvent } from "@/data/international-timeline";

export const POINT_EVENT_REVISION = "major-event-dates-20261118-v1";

// These dates identify discrete decisions, not the duration of their economic effects.
export const POINT_EVENT_UPDATES = {
  "mark-revision-20261118-12": {
    date: "1973.10.17", title: "1차 오일쇼크 · OAPEC 감산 결정",
    decision: "10.17 OAPEC, 단계적 원유 감산 결정.",
    effects: "이후 영향 (1973~75)",
    source: "https://history.state.gov/historicaldocuments/frus1969-76v36/d223",
  },
  "mark-revision-20261118-29": {
    date: "1979.10.6", title: "볼커 긴축 전환",
    decision: "10.6 연준, 은행 준비금·통화량 관리에 중점을 두는 정책 운용 방식으로 전환.",
    effects: "이후 유럽 3국의 상황 (1979~82)",
    source: "https://www.frbsf.org/research-and-insights/publications/economic-letter/2004/12/october-6-1979/",
  },
} as const;

/** Migrate only the two requested entries once; keep their edited explanatory text. */
export function applyPointEventRevision(event: TimelineEvent): TimelineEvent {
  const update = POINT_EVENT_UPDATES[event.id as keyof typeof POINT_EVENT_UPDATES];
  if (!update || event.pointRevision === POINT_EVENT_REVISION) return { ...event };
  const description = event.body.startsWith(`${event.date}\n`) ? event.body.slice(event.date.length + 1) : event.body;
  const headingEnd = plainText(description).indexOf("\n");
  const details = headingEnd < 0 ? "" : splitRichTextAt(description, headingEnd + 1).after.trim();
  return {
    ...event, month: 10, date: update.date, endYear: null, endMonth: null,
    title: update.title, pointRevision: POINT_EVENT_REVISION,
    body: [update.date, update.title, update.decision, ...(details ? [update.effects, details] : [])].join("\n"),
  };
}
