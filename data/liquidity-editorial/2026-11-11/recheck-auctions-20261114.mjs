import fs from 'node:fs';
import {createHash} from 'node:crypto';
const dir=new URL('./',import.meta.url);
const jobs=[
 ['raw','https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query?filter=auction_date:gte:2026-10-15,auction_date:lte:2026-11-11&page[size]=1000&sort=auction_date'],
 ['app','https://ticker-radar-five.vercel.app/api/liquidity/auctions?asOf=2026-11-11&months=1&weeks=4&basis=auction']
];
const results=await Promise.all(jobs.map(async([key,url])=>{try{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('HTTP '+r.status);return {key,url,status:r.status,data:await r.json()};}catch(e){return {key,url,error:String(e)};}}));
const prev=JSON.parse(fs.readFileSync(new URL('auctions-raw.json',dir),'utf8'));
const raw=results.find(r=>r.key==='raw')?.data?.data;
const app=results.find(r=>r.key==='app')?.data?.agg;
const fields=['cusip','auction_date','security_term','total_accepted','primary_dealer_accepted','direct_bidder_accepted','indirect_bidder_accepted'];
const relevant=a=>a.map(r=>fields.map(k=>r[k])).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const summary={checkedAt:new Date().toISOString(),sameRelevantRaw:raw?hash(relevant(raw))===hash(relevant(prev.data)):null,rawCount:raw?.length,rawLatest:raw?.map(r=>r.auction_date).sort().at(-1),rawValid:raw?.filter(r=>r.total_accepted!=='null'&&Number.isFinite(Number(r.total_accepted))).length,app:app?{counted:app.counted,skipped:app.skipped,lastIncluded:app.rows?.map(r=>r.auctionDate).sort().at(-1)}:null,errors:results.filter(r=>r.error).map(r=>({key:r.key,error:r.error}))};
fs.writeFileSync(new URL('auction-recheck-20261114.json',dir),JSON.stringify({summary,results},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary,null,2));
