import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expectedWeek } from './workflow.mjs';

const exec = promisify(execFile);
export const kstDay = value => new Date(new Date(value).getTime()+9*3600000).toISOString().slice(0,10);
export function decideRecovery({fresh,runs,today,now,attempt}) {
  const active=runs.find(r=>r.status!=='completed');
  if(active) return {action:'wait',reason:'수집 실행 중',runId:active.databaseId,url:active.url};
  const latest=runs[0];
  if(latest && kstDay(latest.createdAt)===today && latest.conclusion!=='success') {
    if(latest.event==='workflow_dispatch' || attempt) return {action:'attention',reason:'직접 실행한 수집 실패: 로그 확인 필요',runId:latest.databaseId,url:latest.url};
  } else if(fresh) return {action:'ready',reason:'원자료 기준일과 수집 시각 확인'};
  if(attempt) return {action:'attention',reason:'오늘 복구 요청을 이미 전송함. 실행 결과/게시 지연 확인 필요',attempt};
  if(latest?.conclusion==='success' && kstDay(latest.createdAt)===today) {
    const age=now-new Date(latest.updatedAt);
    return {action:age<10*60000?'wait':'attention',reason:'수집은 성공했지만 API 자료가 아직 오래됨: 캐시 또는 원자료 게시 확인',url:latest.url};
  }
  return {action:'dispatch',reason:'필요한 자료가 없고 진행 중인 수집도 없음'};
}

export async function recover(root, options={}) {
  const config=options.config ?? JSON.parse(fs.readFileSync(path.join(root,'tools/liquidity-editorial/config.json'),'utf8'));
  const now=options.now ?? new Date(), today=kstDay(now), asOf=expectedWeek(now);
  const gh=options.gh ?? (async args=>(await exec('gh',args,{cwd:root,timeout:60000,maxBuffer:1024*1024})).stdout.trim());
  const get=options.get ?? (async endpoint=>{
    const r=await fetch(config.origin+endpoint,{signal:AbortSignal.timeout(45000),cache:'no-store'});
    if(!r.ok)throw new Error(`API ${r.status}: ${endpoint}`);return r.json();
  });
  const dir=path.join(root,config.records,'collection-recovery');fs.mkdirSync(dir,{recursive:true});
  const lock=path.join(dir,'.lock');let fd;
  try {fd=fs.openSync(lock,'wx');}catch{throw new Error('다른 수집 복구 확인이 실행 중입니다.');}
  try {
    fs.writeFileSync(fd,JSON.stringify({pid:process.pid,at:now.toISOString()}));
    const repo=config.repository ?? 'tritonasia1223-collab/ticker-radar';
    const definitions=[{id:'fed',workflow:'fed.yml',endpoint:'/api/fed/overview'},
      {id:'credit',workflow:'credit-monitor.yml',endpoint:`/api/liquidity/credit?asOf=${asOf}&basis=observation&years=3`}];
    const reads=await Promise.all(definitions.map(async item=>{
      const [data,list]=await Promise.all([get(item.endpoint),gh(['run','list','--repo',repo,'--workflow',item.workflow,'--branch','master','--limit','20','--json','databaseId,event,status,conclusion,createdAt,updatedAt,url'])]);
      if(data.error)throw new Error(`${item.id}: ${data.error}`);
      const runs=JSON.parse(list).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      const row=data.weeks?.find(w=>w.date===asOf);
      const fresh=item.id==='fed' ? !!row && ['total','reserves','tga','rrp'].every(k=>Number.isFinite(row[k])) :
        data.asOf===asOf && !!data.collectedAt && kstDay(data.collectedAt)>=today && !data.configChanged && !!data.indicators?.length;
      return {...item,data,fresh,runs};
    }));
    const results=[];
    for(const item of reads) {
      const attemptPath=path.join(dir,`${today}-${item.id}.json`);
      const attempt=fs.existsSync(attemptPath)?JSON.parse(fs.readFileSync(attemptPath,'utf8')):null;
      const decision=decideRecovery({...item,today,now,attempt});
      if(decision.action==='dispatch') {
        // Record intent before the network mutation; an unknown result must not cause repeated dispatches.
        fs.writeFileSync(attemptPath,JSON.stringify({at:now.toISOString(),workflow:item.workflow,asOf,status:'requested'},null,2),{flag:'wx'});
        const output=await gh(['workflow','run',item.workflow,'--repo',repo,'--ref','master']);
        results.push({id:item.id,action:'dispatched',reason:decision.reason,output});
      } else results.push({id:item.id,...decision});
    }
    const status=results.every(r=>r.action==='ready')?'ready':results.some(r=>r.action==='attention')?'needs_attention':'collecting';
    const report={checkedAt:now.toISOString(),asOf,status,results};
    fs.writeFileSync(path.join(dir,`${today}-latest.json`),JSON.stringify(report,null,2)+'\n');
    return report;
  } finally {fs.closeSync(fd);fs.unlinkSync(lock);}
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const local=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
    const root=JSON.parse(fs.readFileSync(path.join(local,'tools/liquidity-editorial/config.json'),'utf8')).canonicalRoot ?? local;
    console.log(JSON.stringify(await recover(root),null,2));
  } catch(e) {console.error(e.message);process.exitCode=1;}
}
