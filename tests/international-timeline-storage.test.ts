import { describe, it, expect } from "vitest";
import { eventDocument, documentEvent, draftResources, resourcesDraft, localImportChanges } from "../client/src/lib/international-timeline-storage";
import { readTimelineDraft } from "../client/src/lib/international-timeline-draft";
import { merge, diff } from "../shared/cap-collaboration";
import { periodEnd } from "../client/src/lib/international-timeline-period";
import { validateEdit } from "../server/cap-collaboration";
const baseline = readTimelineDraft(null);
const event = baseline.events[0];
describe("international event storage", () => {
  it("round-trips all seed records including legacy periods, metadata and rich text", () => {
    const restored = resourcesDraft(draftResources(baseline));
    expect(restored.events).toHaveLength(baseline.events.length);
    expect(() => readTimelineDraft(JSON.stringify(restored))).not.toThrow();
    for (const e of baseline.events) {
      const next = restored.events.find(r => r.id === e.id)!;
      expect(next.body).toEqual(e.body); expect(next.date).toBe(e.date);
      expect(periodEnd(next)).toEqual(periodEnd(e));
    }
  });
  it("imports only local differences, explicit deletions and custom events", () => {
    expect(localImportChanges(baseline,baseline)).toEqual([]);
    const changed = { ...baseline, events: baseline.events.map((e,i) => i === 0 ? {...e,body:"사용자 메모"} : e) };
    expect(localImportChanges(baseline,changed)).toHaveLength(1);
    const deleted = { ...baseline, events: baseline.events.slice(1), deleted: [{event,deletedAt:"2026-11-20"}] };
    expect(localImportChanges(baseline,deleted)[0].changes[0].path).toEqual([]);
    const unchanged = { ...baseline, events: baseline.events.slice(1) };
    expect(localImportChanges(baseline,unchanged)).toEqual([]);
    const custom = { ...baseline, events: [...baseline.events,{...event,id:"custom"}] };
    expect(localImportChanges(baseline,custom)[0].key).toBe("intl:custom");
  });
  it("merges body and date independently but conflicts on the same body and deletion/edit", () => {
    const base = eventDocument(event), a = eventDocument({...event,body:"A"}), b = eventDocument({...event,date:"1975.1",year:1975,month:1});
    const result = merge(a,diff(base,b)); expect(result.conflicts).toEqual([]); expect(result.doc!.body).toBe("A");
    expect(merge(a,diff(base,eventDocument({...event,body:"B"}))).conflicts).toHaveLength(1);
    const deleted = eventDocument(event,"2026-11-20");
    expect(merge(deleted,diff(base,a)).conflicts[0].path).toEqual([]);
    expect(merge(a,diff(base,deleted)).conflicts).toHaveLength(1);
    expect(documentEvent({key:`intl:${event.id}`,version:1,doc:deleted}).deletedAt).toBe("2026-11-20");
  });
  it("validates international protocol paths and arbitrary future types", () => {
    const doc = eventDocument({...event,type:"flow"});
    const op = {id:crypto.randomUUID(),session:crypto.randomUUID(),resource:`intl:${event.id}`,editor:"test",changes:diff(null,doc)};
    expect(validateEdit(op)).toEqual(op);
    expect(() => validateEdit({...op,changes:[{path:["unknown"],before:null,after:"oops"}]})).toThrow();
  });
});
