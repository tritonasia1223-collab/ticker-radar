// Verify transaction-pool compatibility in a fresh schema; never touches public research rows.
import "dotenv/config";
import assert from "node:assert/strict";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { runtimeDatabaseUrl } from "../server/database-connection.js";
import { initializeInternational, getResource, applyCollaborativeEdit, CollaborationConflict, syncState } from "../server/cap-collaboration.js";
import { diff, type Document } from "../shared/cap-collaboration.js";
const schema = `storage_pool_test_${Date.now()}`;
if (!/^storage_pool_test_\d+$/.test(schema)) throw new Error("Invalid synthetic schema");
const client = postgres(runtimeDatabaseUrl(process.env.DATABASE_URL!, true), { prepare:false, max:3, idle_timeout:5, connect_timeout:20 });
const raw = drizzle(client), isolated = { transaction: (work: any) => raw.transaction(async tx => { await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}"`)); return work(tx); }) } as typeof raw;
const event = {title:"Synthetic pool test",body:"original",type:"policy",labels:[],timing:{year:1974,month:9,date:"1974.9",endY:null,endM:null,endYear:null,endMonth:null},position:{region:"europe",country:"유럽",lane:"eu",scope:"regional"},extra:{},deletedAt:null};
const key="intl:pool-fixture", op=(before:Document,after:Document)=>({id:crypto.randomUUID(),session:crypto.randomUUID(),editor:"Pool test",resource:key,schemaVersion:2 as const,changes:diff(before,after)});
let created=false;
try {
  await client.unsafe(`CREATE SCHEMA "${schema}"`); created=true;
  await isolated.transaction(async tx=>{
    for(const definition of [
      "CREATE TABLE cap_flows(slug TEXT PRIMARY KEY,updated_at BIGINT)",
      "CREATE TABLE cap_settings(key TEXT PRIMARY KEY,value TEXT,updated_at BIGINT NOT NULL)",
      "CREATE TABLE cap_edit_operations(id TEXT PRIMARY KEY,resource TEXT,editor TEXT,session TEXT,taken_at BIGINT,changes TEXT,request TEXT)",
      "CREATE TABLE cap_editors(session TEXT PRIMARY KEY,editor TEXT,resource TEXT,seen_at BIGINT)",
    ]) await tx.execute(sql.raw(definition));
  });
  await Promise.all([initializeInternational([{key,doc:event}],isolated),initializeInternational([{key,doc:event}],isolated)]);
  const base=(await getResource(key,isolated)).doc;
  await Promise.all([applyCollaborativeEdit(op(base,{...base,body:"A"}),isolated),applyCollaborativeEdit(op(base,{...base,labels:["독일"]}),isolated)]);
  const merged=(await getResource(key,isolated)).doc;
  assert.equal(merged!.body,"A"); assert.deepEqual(merged!.labels,["독일"]);
  await assert.rejects(()=>applyCollaborativeEdit(op(base,{...base,body:"B"}),isolated),CollaborationConflict);
  const retry=op(merged,{...merged,title:"first save"});
  await Promise.all([applyCollaborativeEdit(retry,isolated),applyCollaborativeEdit(retry,isolated)]);
  const after=(await getResource(key,isolated)).doc;
  await applyCollaborativeEdit(op(after,{...after,title:"newer save"}),isolated);
  assert.equal((await applyCollaborativeEdit(retry,isolated)).doc!.title,"newer save");
  const active=(await getResource(key,isolated)).doc;
  await applyCollaborativeEdit(op(active,{...active,deletedAt:"2026-11-20"}),isolated);
  await assert.rejects(()=>applyCollaborativeEdit(op(active,{...active,body:"late"}),isolated),CollaborationConflict);
  const state=await isolated.transaction(tx=>syncState({session:crypto.randomUUID(),editor:"Pool test",resource:key,scopes:["international"]},tx as any)) as any;
  assert.equal(state.international.length,1);assert.deepEqual(state.flows,[]);
  console.log("PASS: transaction pool init races, concurrent field merge, same-field/deletion conflict, duplicate and lost-response retry, scoped sync; public data unchanged.");
} finally {
  if(created) await client.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await client.end({timeout:5});
}
