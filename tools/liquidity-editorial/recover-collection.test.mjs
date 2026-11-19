import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {decideRecovery,kstDay,recover} from './recover-collection.mjs';
const base={fresh:false,runs:[],today:'2026-10-23',now:new Date('2026-10-23T02:00:00Z')};
test('한국 날짜·신선한 자료·진행 중 수집 구분',()=>{
 assert.equal(kstDay('2026-10-22T23:00:00Z'),'2026-10-23');
 assert.equal(decideRecovery({...base,fresh:true}).action,'ready');
 assert.equal(decideRecovery({...base,fresh:true,runs:[{status:'in_progress',databaseId:1}]}).action,'wait');
 assert.equal(decideRecovery(base).action,'dispatch');
});
test('성공 후 게시 지연과 직접 실행 실패는 중복 수집하지 않음',()=>{
 const done={status:'completed',createdAt:'2026-10-23T01:50:00Z',updatedAt:'2026-10-23T01:55:00Z',conclusion:'success'};
 assert.equal(decideRecovery({...base,runs:[done]}).action,'wait');
 assert.equal(decideRecovery({...base,now:new Date('2026-10-23T02:20:00Z'),runs:[done]}).action,'attention');
 assert.equal(decideRecovery({...base,fresh:true,runs:[{...done,event:'workflow_dispatch',conclusion:'failure'}]}).action,'attention');
 assert.equal(decideRecovery({...base,attempt:{status:'requested'}}).action,'attention');
});
test('예약 실패에는 한 번 복구, 직접 실행 실패에는 조사 필요',()=>{
 const run={status:'completed',createdAt:'2026-10-23T01:00:00Z',conclusion:'failure',event:'schedule'};
 assert.equal(decideRecovery({...base,runs:[run]}).action,'dispatch');
 assert.equal(decideRecovery({...base,runs:[run],attempt:{status:'requested'}}).action,'attention');
});
test('중복 호출 및 요청 응답 유실에서도 dispatch는 하루 한 번',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'collection-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let count=0;
 const options={config:{records:'records'},now:base.now,get:async endpoint=>endpoint.includes('credit?')?{asOf:'2026-10-21',collectedAt:'2026-10-23T01:00:00Z',indicators:[{}]}:{weeks:[]},gh:async args=>{
  if(args[0]==='run')return '[]';count++;throw new Error('response lost');
 }};
 await assert.rejects(recover(root,options),/response lost/);
 assert.equal((await recover(root,options)).status,'needs_attention');assert.equal(count,1);
});
