import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const BLOCKS = ['overview','amount','source','destination','issuance','auctions','ownership','rateContext','spread','nfci','facilities','h8_ci_loans','h8_loans_to_nondepository','sloos_ci_standards','sloos_ci_demand','h8_large_vs_small_banks','corporate_bond_issuance','bond-dashboard','leveraged_loans','cp-dashboard','bdc_price_to_nav','bdc_credit_quality'];
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const encode = v => JSON.stringify(v, null, 2) + '\n';
export const hash = v => createHash('sha256').update(typeof v === 'string' ? v : encode(v)).digest('hex');
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
const date = value => { ensure(/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0,10) === value, '잘못된 기준일'); return value; };
const prior = value => new Date(new Date(date(value)).getTime() - 7*86400000).toISOString().slice(0,10);
export function expectedWeek(now = new Date()) {
  const d = new Date(now.getTime() + 9*3600000);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay()+4)%7);
  return d.toISOString().slice(0,10);
}
function atomic(p, value) {
  const temp = `${p}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, value, {flag:'wx'});
  fs.renameSync(temp, p);
}
function immutable(p, value) {
  if (fs.existsSync(p)) { ensure(fs.readFileSync(p,'utf8') === value, `기존 기록 덮어쓰기 금지: ${path.basename(p)}`); return; }
  fs.writeFileSync(p, value, {flag:'wx'});
}
export function validateDraft(d) {
  date(d.asOf); ensure(d.previousAsOf === prior(d.asOf), '전주 기준일 불일치');
  ensure(typeof d.handoffHash === 'string' && d.handoffHash.length === 64, '읽은 인수인계서의 해시 필요');
  ensure(Array.isArray(d.sources), 'sources 필요');
  const ids = new Set();
  for (const s of d.sources) {
    ensure(s.id && !ids.has(s.id) && /^https?:\/\//.test(s.url) && s.title && s.claim && s.accessedAt, '출처 ID·URL·제목·확인 내용·확인일 필요'); ids.add(s.id);
  }
  ensure(d.blocks?.length === BLOCKS.length && new Set(d.blocks.map(b=>b.id)).size === BLOCKS.length, '모든 블록의 작성/유지/생략 결정을 기록');
  for (const b of d.blocks) {
    ensure(BLOCKS.includes(b.id) && ['write','carry','omit'].includes(b.decision) && b.reason?.trim(), '블록 ID·결정·이유 필요');
    ensure(Array.isArray(b.paragraphs) && b.paragraphs.every(p=>typeof p==='string' && p.trim()), '문단 형식 오류');
    ensure(b.decision === 'omit' ? b.paragraphs.length===0 : b.paragraphs.length>0, '작성/유지에는 문안, 생략에는 빈 문단 필요');
    ensure(Array.isArray(b.sourceIds) && b.sourceIds.every(id=>ids.has(id)), '출처 연결 오류');
    ensure(!b.materialChange || b.sourceIds.length>0 || b.researchUnresolved?.trim(), '주요 변화는 외부 조사 근거 또는 미확인 사유 필요');
  }
  return d;
}
function render(d) {
  return `# ${d.asOf} 주간 해설\n\n` + d.blocks.map(b=>`## ${b.id}\n\n${b.decision==='omit'?'(해설 생략)':b.paragraphs.join('\n\n')}\n\n편집 결정: ${b.decision} — ${b.reason}${b.unchangedNote ? '\n\n새 관측이 없어 지난주 해석을 유지합니다.' : ''}`).join('\n\n') + '\n';
}
export function createWorkflow(root, options = {}) {
  const config = options.config ?? read(path.join(root,'tools/liquidity-editorial/config.json'));
  const records = path.resolve(root, config.records), guide = path.resolve(root,config.handoff);
  fs.mkdirSync(records,{recursive:true});
  const now = () => options.now ?? new Date();
  const stamp = () => now().toISOString();
  const week = asOf => path.join(records,date(asOf));
  const get = options.get ?? (async endpoint => {
    const r = await fetch(config.origin+endpoint,{signal:AbortSignal.timeout(90000)});
    ensure(r.ok, `데이터 응답 오류 ${r.status}: ${endpoint}`); return r.json();
  });
  const locked = fn => {
    const lock = path.join(records,'.workflow.lock');
    let fd;
    try { fd = fs.openSync(lock,'wx'); } catch { throw new Error('다른 작업이 진행 중입니다. 잠금 파일을 확인하세요.'); }
    try { fs.writeFileSync(fd,encode({pid:process.pid,at:stamp()})); return fn(); }
    finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  };
  const stateAt = asOf => fs.existsSync(path.join(week(asOf),'state.json')) ? read(path.join(week(asOf),'state.json')) : null;
  async function prepare(asOf = expectedWeek(now())) {
    date(asOf); ensure(asOf <= expectedWeek(now()), '아직 도래하지 않은 주차');
    if (asOf <= config.baselineAsOf) return {status:'already_covered',asOf};
    const existing = stateAt(asOf);
    if (existing) return {status:existing.status==='prepared'?'resume_prepared':'already_written',asOf,revision:existing.revision};
    const previousAsOf = prior(asOf);
    const endpoints = {
      overview:'/api/fed/overview', context:'/api/liquidity/context',
      credit:`/api/liquidity/credit?asOf=${asOf}&basis=observation&years=3`,
      previousCredit:`/api/liquidity/credit?asOf=${previousAsOf}&basis=observation&years=3`,
      auctions:`/api/liquidity/auctions?asOf=${asOf}&months=1&weeks=4&basis=auction`,
      previousAuctions:`/api/liquidity/auctions?asOf=${previousAsOf}&months=1&weeks=4&basis=auction`
    };
    for (const [label,day] of [['current',asOf],['previous',previousAsOf]]) for (const n of [1,4,13]) endpoints[`${label}Flow${n}`] = `/api/liquidity/treasury-flow?asOf=${day}&weeks=${n}`;
    const entries = await Promise.all(Object.entries(endpoints).map(async ([k,v])=>[k,await get(v)]));
    const data = Object.fromEntries(entries), failures = [];
    for (const day of [asOf,previousAsOf]) {
      const row = data.overview.weeks?.find(w=>w.date===day);
      if (!row || ['total','reserves','rrp','tga'].some(k=>!Number.isFinite(row[k]))) failures.push(`H.4.1 ${day} 없음/결측`);
    }
    for (const [key,day] of [['credit',asOf],['previousCredit',previousAsOf]]) {
      const c = data[key];
      if (c.error || c.configChanged || c.asOf!==day || !c.collectedAt || c.collectedAt.slice(0,10)<day || !c.indicators?.length) failures.push(`${key} 미수집/설정 변경`);
    }
    for (const [k,v] of entries) if (v.error || v.errors?.auctions) failures.push(`${k} 수집 오류`);
    if (failures.length) return {status:'waiting_for_data',asOf,failures};
    return locked(()=>{
      if (stateAt(asOf)) return {status:'already_prepared',asOf};
      const dir=week(asOf); fs.mkdirSync(dir,{recursive:true});
      const handoff=fs.readFileSync(guide,'utf8');
      const packet={asOf,previousAsOf,capturedAt:stamp(),endpoints,data};
      // Partial writes remain visible; a retry never silently replaces captured inputs.
      if (!fs.existsSync(path.join(dir,'inputs.json'))) immutable(path.join(dir,'inputs.json'),encode(packet));
      if (!fs.existsSync(path.join(dir,'handoff-at-prepare.md'))) immutable(path.join(dir,'handoff-at-prepare.md'),handoff);
      const template={asOf,previousAsOf,handoffHash:hash(handoff),sources:[],blocks:BLOCKS.map(id=>({id,decision:'omit',reason:'',paragraphs:[],sourceIds:[],materialChange:false}))};
      if (!fs.existsSync(path.join(dir,'draft-template.json'))) immutable(path.join(dir,'draft-template.json'),encode(template));
      atomic(path.join(dir,'state.json'),encode({asOf,status:'prepared',revision:0,createdAt:stamp(),inputHash:hash(read(path.join(dir,'inputs.json')))}));
      return {status:'prepared',asOf,directory:dir};
    });
  }
  function saveDraft(d) {
    validateDraft(d);
    return locked(()=>{
      const dir=week(d.asOf), state=stateAt(d.asOf); ensure(state,'먼저 prepare를 실행하세요');
      const original=path.join(dir,'draft-original.json');
      if (state.revision>0) { ensure(state.origin!=='existing_baseline','기존 기준본 수정은 feedback 명령을 사용하세요'); ensure(hash(read(original))===hash(d),'원본은 덮어쓸 수 없습니다. 사용자 수정은 feedback 명령을 사용하세요'); return {status:'already_written'}; }
      const handoff=fs.readFileSync(guide,'utf8'); ensure(hash(handoff)===d.handoffHash,'인수인계서가 바뀌었습니다. 다시 읽고 해시를 갱신하세요');
      immutable(path.join(dir,'handoff-at-draft.md'),handoff);
      for (const name of ['draft-original','revision-001']) {
        immutable(path.join(dir,`${name}.json`),encode(d)); immutable(path.join(dir,`${name}.md`),render(d));
      }
      atomic(path.join(dir,'state.json'),encode({...state,status:'awaiting_feedback',revision:1,draftedAt:stamp()}));
      return {status:'awaiting_feedback',asOf:d.asOf};
    });
  }
  function adoptExisting(d) {
    validateDraft(d);
    ensure(d.asOf<=config.baselineAsOf,'신규 주차는 prepare와 draft를 사용하세요');
    return locked(()=>{
      const dir=week(d.asOf); ensure(!stateAt(d.asOf),'이미 기록된 주차입니다');
      const handoff=fs.readFileSync(guide,'utf8'); ensure(hash(handoff)===d.handoffHash,'인수인계서를 다시 읽으세요');
      fs.mkdirSync(dir,{recursive:true});
      immutable(path.join(dir,'existing-baseline.json'),encode(d));
      immutable(path.join(dir,'revision-001.json'),encode(d));
      immutable(path.join(dir,'revision-001.md'),render(d));
      immutable(path.join(dir,'provenance.md'),'이 기록은 시스템 도입 당시 실제 반영 문안입니다. 사용자 수정 전 최초 초안을 복구한 기록이 아닙니다. 과거 원본은 인수인계서의 별도 복구 파일을 참고합니다.\n');
      atomic(path.join(dir,'state.json'),encode({asOf:d.asOf,status:'human_revised',revision:1,origin:'existing_baseline',createdAt:stamp()}));
      return {status:'existing_baseline_saved',asOf:d.asOf};
    });
  }
  function feedback(f) {
    ensure(/^[a-zA-Z0-9_-]{8,100}$/.test(f.id),'안전하고 고유한 피드백 ID 필요');
    ensure(f.source?.kind==='human' && f.source.quote?.trim() && f.source.reference?.trim(),'직접 받은 사용자 발언과 대화 참조 필요');
    validateDraft(f.after); ensure(f.after.asOf===f.asOf,'피드백 주차 불일치');
    ensure(Array.isArray(f.lessons),'lessons 필요 (재사용 규칙이 없으면 빈 배열)');
    for (const l of f.lessons) ensure(['week','indicator','general','data'].includes(l.scope) && ['explicit','inferred','one_off','correction'].includes(l.kind) && l.text?.trim(),'학습 범위·상태·내용 필요');
    return locked(()=>{
      const dir=week(f.asOf), state=stateAt(f.asOf); ensure(state?.revision>0,'원본 초안이 먼저 필요합니다');
      const eventPath=path.join(dir,`feedback-${f.id}.json`);
      let event;
      if (fs.existsSync(eventPath)) { event=read(eventPath); ensure(hash(event.input)===hash(f),'같은 피드백 ID에 다른 내용 사용 금지'); }
      else {
        ensure(f.baseRevision===state.revision,'수정본 버전 충돌: 최신 문안에 다시 적용하세요');
        ensure(f.handoffHash===hash(fs.readFileSync(guide,'utf8')),'인수인계서 버전 충돌');
        event={input:f,before:read(path.join(dir,`revision-${String(state.revision).padStart(3,'0')}.json`)),revision:state.revision+1,recordedAt:stamp()};
        immutable(eventPath,encode(event));
      }
      const revision=`revision-${String(event.revision).padStart(3,'0')}`;
      immutable(path.join(dir,revision+'.json'),encode(f.after)); immutable(path.join(dir,revision+'.md'),render(f.after));
      const marker=`<!-- human-feedback:${f.id} -->`, handoff=fs.readFileSync(guide,'utf8');
      if (!handoff.includes(marker)) {
        ensure(hash(handoff)===f.handoffHash,'복구 중 인수인계서 충돌: 기록을 확인하고 병합하세요');
        immutable(path.join(dir,`handoff-before-${f.id}.md`),handoff);
        const lessonText=f.lessons.length ? f.lessons.map(l=>`- [${l.scope} / ${l.kind}] ${l.text}`).join('\n') : '- 해당 주차 문안만 수정. 새 공통 규칙 없음.';
        const link=path.relative(path.dirname(guide),eventPath).replaceAll('\\','/');
        atomic(guide,handoff+`\n${marker}\n### 사용자 피드백 ${f.asOf} · ${f.id}\n\n- 원문: ${f.source.quote.replaceAll('\n',' ')}\n- 근거: ${f.source.reference}\n- [수정 전후 기록](${link})\n\n${lessonText}\n`);
      }
      if (state.revision<event.revision) atomic(path.join(dir,'state.json'),encode({...state,status:'human_revised',revision:event.revision,feedbackAt:event.recordedAt}));
      return {status:'human_revised',asOf:f.asOf,revision:event.revision};
    });
  }
  return {prepare,saveDraft,adoptExisting,feedback,status:()=>({expectedWeek:expectedWeek(now()),baselineAsOf:config.baselineAsOf,weeks:fs.readdirSync(records).filter(n=>/^\d{4}-\d{2}-\d{2}$/.test(n)).map(stateAt).filter(Boolean)})};
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const localRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
    const root=read(path.join(localRoot,'tools/liquidity-editorial/config.json')).canonicalRoot ?? localRoot;
    const workflow=createWorkflow(root), [command,arg]=process.argv.slice(2);
    const result=command==='prepare' ? await workflow.prepare(arg) : command==='draft' ? workflow.saveDraft(read(arg)) : command==='adopt' ? workflow.adoptExisting(read(arg)) : command==='feedback' ? workflow.feedback(read(arg)) : command==='status' ? workflow.status() : null;
    ensure(result,'사용법: workflow.mjs prepare [YYYY-MM-DD] | draft FILE | adopt FILE | feedback FILE | status');
    console.log(encode(result));
  } catch(e) { console.error(e.message); process.exitCode=1; }
}
