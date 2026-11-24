import { afterEach, describe, expect, it, vi } from "vitest";
import { CollaborationEngine, RemoteConflict } from "../client/src/lib/cap-collab-engine";
import { copy, merge, type Document, type Resource } from "../shared/cap-collaboration";
const doc = (): Document => ({title:"old",body:"old",deletedAt:null});
function setup() {
  const records = new Map<string,Resource>(), pending = new Map<string,any>(); let active=0, maximum=0;
  const engine = new CollaborationEngine(crypto.randomUUID(),"test",{
    read:async key=>copy(records.get(key) ?? {key,version:0,doc:null}),
    send:async op=>{ active++; maximum=Math.max(active,maximum); await new Promise(r=>setTimeout(r,20)); active--;
      const current=records.get(op.resource) ?? {key:op.resource,version:0,doc:null}, next=merge(current.doc,op.changes);
      if(next.conflicts.length) throw new RemoteConflict(current,next.conflicts);
      const result={key:op.resource,version:current.version+1,doc:next.doc,operation:op.id};records.set(op.resource,result);return result;
    }
  },{all:async()=>[...pending.values()],put:async d=>{pending.set(d.id,copy(d));},remove:async id=>{pending.delete(id);}},()=>{},100000);
  return {engine,records,pending,maximum:()=>maximum};
}
afterEach(()=>vi.useRealTimers());
describe("standard storage safety",()=>{
  it("bounds bulk import sends without dropping resources",async()=>{
    const h=setup(); for(let i=0;i<8;i++)h.engine.edit(`intl:${i}`,doc());
    await h.engine.flushAll(); expect(h.maximum()).toBe(2);expect(h.records.size).toBe(8);expect(h.engine.drafts.size).toBe(0);
  });
  it("holds remote reads in a focused automatic editor while still acknowledging saves",async()=>{
    const h=setup(), key="intl:a";h.records.set(key,{key,version:1,doc:doc()});h.engine.seed(h.records.get(key)!);
    const release=h.engine.holdRemoteReads(key);
    h.engine.edit(key,{...doc(),body:"mine"});await h.engine.flushAll();
    expect(h.engine.drafts.size).toBe(0);expect(h.engine.confirmed.get(key)!.doc!.body).toBe("mine");
    await h.engine.receive({key,version:3,doc:{...doc(),body:"remote"}});expect(h.engine.get(key)!.body).toBe("mine");
    release();expect(h.engine.canReceive(key)).toBe(true);
    await h.engine.receive({key,version:3,doc:{...doc(),body:"remote"}});expect(h.engine.get(key)!.body).toBe("remote");
  });
  it.each(["remote","local"] as const)("keeps deletion/edit conflict until explicit %s choice",async choice=>{
    const h=setup(),key="intl:a",base=doc();h.records.set(key,{key,version:2,doc:{...base,deletedAt:"2026-11-20"}});
    h.engine.seed({key,version:1,doc:base});h.engine.edit(key,{...base,body:"mine"});await h.engine.flushAll();
    expect(h.engine.drafts.get(key)!.conflicts?.[0].path).toEqual([]);
    if(choice==="local")expect(()=>h.engine.resolve(key,{"[]":choice})).toThrow(/복원/);
    h.engine.resolve(key,{"[]":choice},choice==="local");await h.engine.flushAll();
    expect(h.records.get(key)!.doc!.deletedAt).toBe(choice==="remote"?"2026-11-20":null);
    expect(h.records.get(key)!.doc!.body).toBe(choice==="remote"?"old":"mine");
  });
});
