import fs from 'node:fs';
const base='https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/';
const jobs=['operating_cash_balance','deposits_withdrawals_operating_cash'].map(k=>[k,base+'dts/'+k+'?filter=record_date:gte:2026-11-12,record_date:lte:2026-11-18&page[size]=10000&sort=record_date']);
jobs.push(['auctions-raw',base+'od/auctions_query?filter=auction_date:gte:2026-10-22,auction_date:lte:2026-11-18&page[size]=1000&sort=auction_date']);
await Promise.all(jobs.map(async([key,url])=>{try{const r=await fetch(url);if(!r.ok)throw Error(String(r.status));const j=await r.json();fs.writeFileSync(new URL(key+'.json',import.meta.url),JSON.stringify({url,accessedAt:new Date().toISOString(),...j},null,2)+'\n');console.log(key,j.data.length,j.meta);}catch(e){console.log(key,String(e));process.exitCode=1;}}));
