import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BLOCKS, createWorkflow, expectedWeek, hash } from './workflow.mjs';

function fixture(t, tweak = {}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'editorial-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'guide.md'),'# 사용자 원칙\n');
  const config={records:'records',handoff:'guide.md',baselineAsOf:'2026-10-14'};
  const get=async endpoint=>{
    if (endpoint==='/api/fed/overview') return {weeks:['2026-10-21','2026-10-14'].map(date=>({date,total:100,reserves:50,rrp:10,tga:20}))};
    if (endpoint.startsWith('/api/liquidity/credit?')) return {asOf:new URL('https://x'+endpoint).searchParams.get('asOf'),collectedAt:'2026-10-23T00:00:00Z',indicators:[{}],...tweak};
    return {};
  };
  const options={config,get,now:new Date('2026-10-23T02:00:00Z')};
  const w=createWorkflow(root,options), dir=path.join(root,'records/2026-10-21');
  const draft=()=>({asOf:'2026-10-21',previousAsOf:'2026-10-14',handoffHash:hash(fs.readFileSync(path.join(root,'guide.md'),'utf8')),sources:[],blocks:BLOCKS.map(id=>({id,decision:'write',reason:'새 관측 비교',paragraphs:['해당 주차 해설'],sourceIds:[]}))});
  const feedback=()=>({id:'human-20261023-001',asOf:'2026-10-21',baseRevision:1,handoffHash:hash(fs.readFileSync(path.join(root,'guide.md'),'utf8')),source:{kind:'human',quote:'숫자 나열 말고 원인을 먼저 설명해줘',reference:'이 대화의 사용자 메시지'},after:draft(),lessons:[{scope:'general',kind:'explicit',text:'원인을 먼저 설명하고 핵심 수치만 남긴다.'}]});
  return {root,w,dir,draft,feedback,options};
}
test('한국 시간 금요일의 기준 주차와 기존 발행 주차 중복 방지',async t=>{
  const f=fixture(t); assert.equal(expectedWeek(new Date('2026-10-22T22:00:00Z')),'2026-10-21');
  assert.equal((await f.w.prepare('2026-10-14')).status,'already_covered');
  await assert.rejects(f.w.prepare('2026-10-28'),/아직/);
});
test('수집 미완료는 새 초안 저장 공간을 만들지 않음',async t=>{
  const f=fixture(t,{collectedAt:'2026-10-13T00:00:00Z'});
  assert.equal((await f.w.prepare()).status,'waiting_for_data'); assert.equal(fs.existsSync(f.dir),false);
});
test('원자료와 원본 보존, 재실행 멱등, 수정본 재조회',async t=>{
  const f=fixture(t); await f.w.prepare();
  assert.equal((await f.w.prepare()).status,'resume_prepared');
  const d=f.draft(); f.w.saveDraft(d);
  const original=fs.readFileSync(path.join(f.dir,'draft-original.json'),'utf8');
  assert.equal(f.w.saveDraft(d).status,'already_written');
  assert.equal((await f.w.prepare()).status,'already_written');
  d.blocks[0].paragraphs=['덮어쓰기']; assert.throws(()=>f.w.saveDraft(d),/덮어/);
  const feedback=f.feedback(); feedback.after.blocks[0].paragraphs=['사용자 수정'];
  f.w.feedback(feedback); f.w.feedback(feedback);
  assert.equal(fs.readFileSync(path.join(f.dir,'draft-original.json'),'utf8'),original);
  assert.equal(createWorkflow(f.root,f.options).status().weeks[0].revision,2);
  assert.equal(fs.readFileSync(path.join(f.root,'guide.md'),'utf8').match(/<!-- human-feedback:/g).length,1);
});
test('자동 초안은 학습하지 않고 직접 사용자 근거와 최신 버전 필요',async t=>{
  const f=fixture(t); await f.w.prepare(); f.w.saveDraft(f.draft());
  assert.equal(fs.readFileSync(path.join(f.root,'guide.md'),'utf8'),'# 사용자 원칙\n');
  const bad=f.feedback(); bad.source.kind='agent'; assert.throws(()=>f.w.feedback(bad),/직접/);
  const stale=f.feedback(); stale.baseRevision=0; assert.throws(()=>f.w.feedback(stale),/버전 충돌/);
  const staleGuide=f.feedback(); fs.appendFileSync(path.join(f.root,'guide.md'),'새 규칙');
  assert.throws(()=>f.w.feedback(staleGuide),/인수인계서 버전/);
});
test('주요 변화의 조사 기록 및 최신 인수인계 읽기 강제',async t=>{
  const f=fixture(t); await f.w.prepare(); const d=f.draft(); d.blocks[0].materialChange=true;
  assert.throws(()=>f.w.saveDraft(d),/외부 조사/);
  d.blocks[0].researchUnresolved='공식 자료를 검색했으나 해당 주차 원인을 확인하지 못함';
  fs.appendFileSync(path.join(f.root,'guide.md'),'갱신'); assert.throws(()=>f.w.saveDraft(d),/다시 읽고/);
  d.handoffHash=hash(fs.readFileSync(path.join(f.root,'guide.md'),'utf8')); f.w.saveDraft(d);
});
test('중간 실패 후 같은 피드백 ID로 복구해도 학습 중복 없음',async t=>{
  const f=fixture(t); await f.w.prepare(); f.w.saveDraft(f.draft()); const event=f.feedback();
  const statePath=path.join(f.dir,'state.json'), stateBefore=fs.readFileSync(statePath,'utf8');
  f.w.feedback(event);
  // Simulate a crash after guide/revision writes, before the state update.
  fs.writeFileSync(statePath,stateBefore);
  assert.equal(f.w.feedback(event).revision,2);
  assert.equal(f.w.status().weeks[0].revision,2);
  assert.equal(fs.readFileSync(path.join(f.root,'guide.md'),'utf8').match(/<!-- human-feedback:/g).length,1);
  event.source.quote='다른 피드백'; assert.throws(()=>f.w.feedback(event),/다른 내용/);
});
test('동시 작업 잠금을 임의로 해제하지 않음',async t=>{
  const f=fixture(t); await f.w.prepare();
  const lock=path.join(f.root,'records/.workflow.lock'); fs.writeFileSync(lock,'existing owner');
  assert.throws(()=>f.w.saveDraft(f.draft()),/진행 중/); assert.equal(fs.readFileSync(lock,'utf8'),'existing owner');
});
test('기존 반영 문안의 등록은 최초 초안 복구로 표시하지 않음',t=>{
  const f=fixture(t), d=f.draft(); d.asOf='2026-10-14'; d.previousAsOf='2026-10-07';
  f.w.adoptExisting(d);
  const dir=path.join(f.root,'records/2026-10-14');
  assert.equal(fs.existsSync(path.join(dir,'draft-original.json')),false);
  assert.match(fs.readFileSync(path.join(dir,'provenance.md'),'utf8'),/최초 초안을 복구한 기록이 아닙니다/);
  assert.throws(()=>f.w.adoptExisting(d),/이미/);
  const event=f.feedback(); event.asOf=d.asOf; event.after=d;
  assert.equal(f.w.feedback(event).revision,2);
});
