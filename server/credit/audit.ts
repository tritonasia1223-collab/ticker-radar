import { config } from "../../shared/credit/schema.js";
import { analyze } from "../../shared/credit/signals.js";
import type { Snapshot } from "../../shared/credit/schema.js";

export function creditAudit(snapshot: Snapshot | null, asOf = new Date().toISOString().slice(0, 10)) {
  const results = analyze(snapshot, asOf);
  return { asOf, collectedAt: snapshot?.collectedAt ?? null, schedule: "한국시간 화~토 10:20 (UTC 화~토 01:20), 원격 워크플로 반영·활성화 필요", indicators: config.paths.flatMap(path => path.indicators.map(spec => {
    const result = results.find(i => i.id === spec.id)!;
    return { id: spec.id, name: spec.name, publication: spec.refresh?.publication, collection: spec.refresh?.collection, status: result.status, lines: result.lines.map(line => ({ label: line.label, observations: line.points.length, firstObservation: line.points[0]?.date, latestObservation: line.latest?.date, publishedAt: line.latest?.publishedAt, latestValue: line.latest?.value, observationStale: !!line.latest && line.stale && !line.collectionOverdue, collectionOverdue: !!line.collectionOverdue, sources: line.sources, errors: line.errors, notes: line.notes })) };
  })) };
}
