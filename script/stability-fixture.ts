// Disposable audit harness: all API writes stay in memory; never imports DB code.
import express from 'express';
import { flowDocument, documentFlow, metaDocument, diff, merge } from '../shared/cap-collaboration.js';
import { createServer } from 'vite';
const app = express();
app.use(express.json({limit:'10mb'}));
let flows: any[] = [], settings: Record<string,string> = {}, log: any[] = [];
let operations = new Map<string, any>(), peers = new Map<string, any>(), metaVersion = 100;
let patchDelay = 0, metaDelay = false, failReads = false, seq = 0;
const clone = (x: any) => JSON.parse(JSON.stringify(x));
function reset() {
  flows = [1971,1973,1980].map((year,i)=>({id:i+1,slug:`audit-${year}`,date:`${year}-01-01`,endDate:null,year,title:`Audit ${year}`,category:'경제',layout:'stack',sortOrder:i,updatedAt:100,
    insight:{text:`Insight ${year}`,charts:[],blocks:[{type:'text',text:`Insight ${year}`}]},
    nodes:[{id:`n${i}a`,kind:'cause',text:`Original A ${year}`,inLabel:null,ref:null,col:null,table:null},{id:`n${i}b`,kind:'effect',text:`Original B ${year}`,inLabel:null,ref:null,col:null,table:null}],edges:[]}));
  settings={insight_overview_v2:JSON.stringify({cards:[{id:'m1',title:'Meta original',text:'Meta body',tables:[],images:[],blocks:[{type:'text',text:'Meta body'}]}]})};
  operations.clear(); peers.clear(); metaVersion=100;
  log=[]; patchDelay=0;metaDelay=false;failReads=false;seq=0;
}
reset();
app.post('/__audit/reset',(_q,r)=>{reset();r.json({ok:true});});
app.post('/__audit/config',(q,r)=>{patchDelay=q.body.patchDelay??patchDelay;metaDelay=q.body.metaDelay??metaDelay;failReads=q.body.failReads??failReads;r.json({ok:true});});
app.get('/__audit/state',(_q,r)=>r.json({flows,settings,log}));
app.use('/api',async(q,r)=>{
  const path=q.path, id=++seq, body=clone(q.body??{});
  log.push({id,method:q.method,path,body,phase:'start'});
  if(failReads && q.method==='GET') return r.status(500).json({error:'Simulated read failure'});
  if(path.startsWith('/capitalism/collab/')) {
    const resource = (key:string) => ({key, version:key.startsWith('flow:') ? (flows.find(f=>f.slug===key.slice(5))?.updatedAt ?? 0) : metaVersion,
      doc:key.startsWith('flow:') ? flowDocument(flows.find(f=>f.slug===key.slice(5))) : metaDocument(JSON.parse(settings.insight_overview_v2).cards.find((c:any)=>c.id===key.slice(5)))});
    if(path.endsWith('/state')) return r.json({flows:flows.map(f=>({key:f.slug,version:f.updatedAt})),metaVersion,peers:[...peers.values()].filter(p=>p.seenAt>Date.now()-45000)});
    if(path.endsWith('/presence')) {peers.set(body.session,{...body,seenAt:Date.now()});return r.json({ok:true});}
    if(path.endsWith('/resource')) return r.json(resource(String(q.query.key)));
    if(path.endsWith('/history-resources'))return r.json([...new Set([...operations.values()].map(o=>o.resource))].map(key=>({key})));
    if(path.endsWith('/history')) return r.json([...operations.values()].filter(o=>o.resource===q.query.resource).reverse());
    if(path.includes('/history/')) return r.json(operations.get(path.split('/').at(-1)!));
    if(path.endsWith('/edit')) {
      if(patchDelay) await new Promise(resolve=>setTimeout(resolve,patchDelay));
      if(operations.has(body.id))return r.json({...resource(body.resource),operation:body.id});
      const current=resource(body.resource), result=merge(current.doc,body.changes);
      if(result.conflicts.length)return r.status(409).json({current,conflicts:result.conflicts});
      if(body.resource.startsWith('flow:')) {
        flows=flows.filter(f=>f.slug!==body.resource.slice(5));
        if(result.doc)flows.push(documentFlow(body.resource,result.doc,Math.max(Date.now(),current.version+1),Date.now()));
      } else {
        const cards=JSON.parse(settings.insight_overview_v2).cards.filter((c:any)=>c.id!==body.resource.slice(5));
        if(result.doc)cards.push(result.doc);settings.insight_overview_v2=JSON.stringify({cards});metaVersion=Math.max(Date.now(),metaVersion+1);
      }
      operations.set(body.id,{...body,changes:diff(current.doc,result.doc),takenAt:Date.now()});
      return r.json({...resource(body.resource),operation:body.id});
    }
  }
  if(path==='/capitalism/flows' && q.method==='GET') return r.json(flows);
  if(path==='/capitalism/links') return r.json([]);
  if(path.startsWith('/capitalism/settings/')) {
    const key=path.split('/').at(-1)!;
    if(q.method==='GET')return r.json({value:settings[key]??null});
    if(metaDelay && body.value?.includes('Meta older'))await new Promise(resolve=>setTimeout(resolve,6000));
    settings[key]=body.value;log.push({id,phase:'done'});return r.json({ok:true});
  }
  if(path==='/capitalism/flows' && q.method==='POST') {
    const idx=flows.findIndex(f=>f.slug===body.slug), old=flows[idx];
    if(old && body.baseVersion!=null && body.baseVersion!==old.updatedAt)return r.status(409).json({conflict:true});
    const f={...old,...body,id:old?.id??Date.now(),updatedAt:Date.now(),nodes:body.nodes.map((n:any)=>({...n,id:n.nodeKey}))};
    if(idx<0)flows.push(f);else flows[idx]=f;
    return r.json(f);
  }
  const match=path.match(/^\/capitalism\/flows\/([^/]+)(?:\/nodes\/([^/]+)|\/(insight))?$/);
  if(match) {
    const f=flows.find(f=>f.slug===match[1]);
    if(q.method==='DELETE'){flows=flows.filter(f=>f.slug!==match[1]);return r.status(204).end();}
    if(!f)return r.status(404).json({error:'missing flow'});
    if(q.method==='PATCH') {
      if(patchDelay)await new Promise(resolve=>setTimeout(resolve,patchDelay));
      const n=f.nodes.find((n:any)=>n.id===match[2]);if(!n)return r.status(404).json({notFound:true});
      Object.assign(n,body);f.updatedAt=Date.now();log.push({id,phase:'done'});return r.json({updatedAt:f.updatedAt});
    }
    if(q.method==='PUT'){f.insight=body.insight;f.updatedAt=Date.now();return r.json({updatedAt:f.updatedAt});}
  }
  return r.status(503).json({error:'Unimplemented audit fixture (no production proxy)'});
});
const vite=await createServer({server:{middlewareMode:true},appType:'spa'});
app.use(vite.middlewares);
app.listen(5178,'127.0.0.1',()=>console.log('Audit fixture http://127.0.0.1:5178 - memory APIs only'));
