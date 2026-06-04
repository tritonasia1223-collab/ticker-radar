// #25 — orphan(insider FK 끊김) 링크 복구. insiders id 시퀀스 리셋(드물게 db:push 재생성)으로
//   옛 저-id insiders 행이 증발 → insider_trades 가 존재하지 않는 insider_id 참조. 이름이 로컬에 없어
//   EDGAR Form4(accession) 에서 rptOwnerName 재유도 → insiders upsert → 끊긴 행 relink.
//
//   실행:  npx tsx script/repair-orphan-links.ts            (dry-run: 복구계획만 출력, DB 변경 없음)
//          npx tsx script/repair-orphan-links.ts --apply    (운영 DB relink 수행)
//
//   안전: #24 교차티커 중복(A; 예 GOOG=GOOGL 복제본)은 되살리면 이중합산이라 **자기분류로 제외** —
//         같은 accession 에 다른 심볼 healthy 쌍둥이가 있으면 skip(가드와 독립적 2중 안전망). 진짜 깨짐(B)만 복구.
//   검증: 복구 후 script/orphan-classify.ts 의 'B 진짜 링크깨짐' 0행, diag-clusters ④ 중 SYM 만 +2행/$0.17M.
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, storage } from "../server/storage";

const UA = "ticker-radar congress/insider research (contact: dev@local)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown"; // collect-insider 와 동일
const accOf = (e: string | null) => { const m = /^fin:([^:]+):/.exec(String(e || "")); return m ? m[1] : ""; };

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const tag = (xml: string, t: string) => { const m = xml.match(new RegExp("<" + t + ">([\\s\\S]*?)</" + t + ">")); return m ? decode(m[1]) : ""; };
const truthy = (s: string) => /^(1|true)$/i.test(s);

async function tickerCikMap(): Promise<Map<string, number>> {
  const j = (await (await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": UA } })).json()) as any;
  const m = new Map<string, number>();
  for (const k in j) m.set(String(j[k].ticker).toUpperCase(), Number(j[k].cik_str));
  return m;
}
function parseForm4(xml: string): { name: string | null; role: string | null } {
  const owner = (xml.match(/<reportingOwner>([\s\S]*?)<\/reportingOwner>/) || [])[1] || xml;
  const name = tag(owner, "rptOwnerName") || null;
  const rel = (xml.match(/<reportingOwnerRelationship>([\s\S]*?)<\/reportingOwnerRelationship>/) || [])[1] || "";
  const parts: string[] = [];
  const title = tag(rel, "officerTitle");
  if (title) parts.push(title); else if (truthy(tag(rel, "isOfficer"))) parts.push("Officer");
  if (truthy(tag(rel, "isDirector"))) parts.push("Director");
  if (truthy(tag(rel, "isTenPercentOwner"))) parts.push("10% Owner");
  return { name, role: parts.join(" · ") || null };
}
async function fetchForm4(cik: number, accession: string): Promise<{ name: string | null; role: string | null }> {
  const accNo = accession.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNo}`;
  let idx: any;
  try { idx = await (await fetch(`${base}/index.json`, { headers: { "User-Agent": UA } })).json(); } catch { return { name: null, role: null }; }
  const xmls = (idx?.directory?.item || []).map((i: any) => i.name).filter((n: string) => /\.xml$/i.test(n) && !n.includes("/"));
  await sleep(130);
  for (const name of xmls) {
    try { const xml = await (await fetch(`${base}/${name}`, { headers: { "User-Agent": UA } })).text(); if (xml.includes("<ownershipDocument")) return parseForm4(xml); }
    catch { /* skip */ }
    await sleep(130);
  }
  return { name: null, role: null };
}

async function main() {
  const apply = process.argv.includes("--apply");
  // 1) orphan 행 + 교차티커(healthy 쌍둥이) 판별용 전체 P/S 심볼/건강성
  const all = (await db.execute(sql`
    SELECT it.id, it.symbol, it.insider_id AS iid, it.side, it.role, it.external_id AS ext, (i.id IS NOT NULL) AS healthy
    FROM insider_trades it LEFT JOIN insiders i ON i.id = it.insider_id
    WHERE it.side IN ('buy','sell')
  `)) as any[];
  const healthyAccSym = new Map<string, Set<string>>();      // accession → healthy 행이 있는 심볼들
  for (const r of all) if (r.healthy) { const a = accOf(r.ext); const s = healthyAccSym.get(a) || new Set(); s.add(r.symbol); healthyAccSym.set(a, s); }
  const orphans = all.filter((r) => !r.healthy);

  // 2) 자기분류: A(교차티커 중복 — 다른 심볼에 healthy 쌍둥이) 제외, B(진짜 깨짐)만
  const repairable = orphans.filter((r) => { const hs = healthyAccSym.get(accOf(r.ext)); return !(hs && [...hs].some((s) => s !== r.symbol)); });
  const skippedA = orphans.length - repairable.length;
  console.log(`orphan P/S ${orphans.length}행 — A(교차티커중복) 제외 ${skippedA} · B(복구대상) ${repairable.length}  [${apply ? "APPLY" : "DRY-RUN"}]`);

  // 3) (oldId, symbol) 그룹별로 대표 accession 으로 이름·직책 1회 조회
  type Grp = { oldId: number; symbol: string; rows: number[]; acc: string; roleAny: string | null };
  const grps = new Map<string, Grp>();
  for (const r of repairable) {
    const k = r.iid + "|" + r.symbol; let g = grps.get(k);
    if (!g) { g = { oldId: Number(r.iid), symbol: r.symbol, rows: [], acc: accOf(r.ext), roleAny: r.role || null }; grps.set(k, g); }
    g.rows.push(Number(r.id)); if (!g.roleAny && r.role) g.roleAny = r.role;
  }
  const cikMap = await tickerCikMap();
  let relinkedRows = 0, ok = 0, miss = 0;
  for (const g of grps.values()) {
    const cik = cikMap.get(g.symbol.toUpperCase());
    const f = cik ? await fetchForm4(cik, g.acc) : { name: null, role: null };
    if (!f.name) { miss++; console.log(`  ✗ ${g.symbol.padEnd(7)} oldId=${g.oldId} acc=${g.acc} — 이름 미상 (skip)`); continue; }
    ok++;
    const slug = slugify(f.name);
    console.log(`  ✓ ${g.symbol.padEnd(7)} oldId=${g.oldId} → "${f.name}" [${f.role || "직책미상"}] · ${g.rows.length}행 relink`);
    if (apply) {
      const newId = await storage.upsertInsider({ slug, name: f.name, createdAt: Date.now() });
      const ids = g.rows;
      await db.execute(sql`UPDATE insider_trades SET insider_id = ${newId}
        ${f.role ? sql`, role = COALESCE(NULLIF(role,''), ${f.role})` : sql``}
        WHERE id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
      relinkedRows += ids.length;
    }
  }
  console.log(`\n${apply ? `✅ relink 완료 — ${relinkedRows}행 / 인사이더 확인 ${ok} · 미상 ${miss}` : `(dry-run) 복구가능 ${ok}그룹 · 미상 ${miss} — 실제 적용은 --apply`}`);
  process.exit(0);
}
main().catch((e) => { console.error("복구 실패:", e); process.exit(1); });
