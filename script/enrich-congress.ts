// 위원회/정당 enrich — unitedstates/congress-legislators(YAML) 로 실 의원의
// 정당·주·소속 위원회를 채운다. collect:congress 로 거래를 넣은 뒤 실행.
//   실행:  npm run enrich:congress
//
// FMP 의원(이름) ↔ legislators(bioguide) 를 이름+원(院)+주 로 매칭하고,
// committees-current / committee-membership-current 로 위원회와 소속을 구성한다.
import "dotenv/config";
import yaml from "js-yaml";
import { storage } from "../server/storage";

const RAW = "https://raw.githubusercontent.com/unitedstates/congress-legislators/main";

async function fetchYaml(file: string): Promise<any> {
  const res = await fetch(`${RAW}/${file}`, { headers: { "User-Agent": "ticker-radar/enrich" } });
  if (!res.ok) throw new Error(`${file} ${res.status}`);
  return yaml.load(await res.text());
}

const partyCode = (p: string) => (/^d/i.test(p) ? "D" : /^r/i.test(p) ? "R" : "I");

const KO: [RegExp, string][] = [
  [/armed services/i, "군사위원회"], [/agriculture/i, "농업위원회"], [/appropriations/i, "세출위원회"],
  [/banking/i, "은행위원회"], [/\bfinance\b/i, "재정위원회"], [/foreign relations|foreign affairs/i, "외교위원회"],
  [/judiciary/i, "법사위원회"], [/intelligence/i, "정보위원회"], [/energy and commerce/i, "에너지·통상위원회"],
  [/natural resources|energy and natural/i, "에너지·자원위원회"], [/health|h\.e\.l\.p|labor and pensions|help/i, "보건위원회"],
  [/financial services/i, "금융서비스위원회"], [/ways and means/i, "세입위원회"], [/budget/i, "예산위원회"],
  [/commerce, science/i, "통상·과학위원회"], [/homeland security/i, "국토안보위원회"], [/oversight/i, "감독위원회"],
  [/veterans/i, "보훈위원회"], [/environment/i, "환경위원회"], [/small business/i, "중소기업위원회"],
  [/\brules\b/i, "규칙위원회"], [/ethics/i, "윤리위원회"], [/education/i, "교육위원회"],
  [/transportation/i, "교통위원회"], [/science, space|space, and tech/i, "과학위원회"], [/indian affairs/i, "원주민위원회"],
  [/aging/i, "고령화위원회"], [/foreign/i, "외교위원회"],
];
function koName(name: string, chamber: string): string {
  const prefix = chamber === "senate" ? "상원 " : "하원 ";
  for (const [re, ko] of KO) if (re.test(name)) return prefix + ko;
  return prefix + name.replace(/^(House|Senate) Committee on /i, "");
}

async function main() {
  console.log("congress-legislators 데이터 로드…");
  const [legs, committeesData, membership] = await Promise.all([
    fetchYaml("legislators-current.yaml"),
    fetchYaml("committees-current.yaml"),
    fetchYaml("committee-membership-current.yaml"),
  ]) as [any[], any[], Record<string, any[]>];

  // legislator 인덱스 (last|first → 정보, last → 목록)
  const byKey = new Map<string, any>();
  const byLast = new Map<string, any[]>();
  for (const m of legs) {
    const term = m.terms[m.terms.length - 1];
    const info = {
      bioguide: m.id.bioguide,
      party: partyCode(term.party || ""),
      state: term.state,
      chamber: term.type === "sen" ? "senate" : "house",
      first: (m.name.first || "").toLowerCase(),
      last: (m.name.last || "").toLowerCase(),
    };
    byKey.set(`${info.last}|${info.first}`, info);
    if (!byLast.has(info.last)) byLast.set(info.last, []);
    byLast.get(info.last)!.push(info);
  }

  // 우리 DB 의원과 매칭 → 정당/주/bioguide 갱신
  const pols = await storage.listPoliticians();
  const bioToPolId = new Map<string, number>();
  let matched = 0;
  for (const p of pols) {
    const toks = p.name.trim().toLowerCase().split(/\s+/);
    const last = toks[toks.length - 1], first = toks[0];
    let info = byKey.get(`${last}|${first}`);
    if (!info) {
      const cands = (byLast.get(last) || []).filter((c) => c.chamber === p.chamber);
      info = cands.find((c) => p.state && c.state === p.state)
        || cands.find((c) => c.first.startsWith(first) || first.startsWith(c.first))
        || (cands.length === 1 ? cands[0] : undefined);
    }
    if (!info) continue;
    matched++;
    bioToPolId.set(info.bioguide, p.id);
    await storage.upsertPolitician({
      slug: p.slug, name: p.name, party: info.party, chamber: p.chamber,
      state: p.state || info.state, bioguideId: info.bioguide, createdAt: p.createdAt,
    });
  }
  console.log(`  의원 매칭 ${matched}/${pols.length}명`);

  // 위원회 재구성 (real)
  await storage.clearCommitteesAndLinks();
  const topLevelIds = new Set<string>();
  for (const c of committeesData) {
    if (c.type !== "house" && c.type !== "senate") continue;
    const id = c.thomas_id;
    if (!id) continue;
    topLevelIds.add(id);
    await storage.upsertCommittee({ id, ko: koName(c.name, c.type), name: c.name, chamber: c.type });
  }

  // 소속 링크 (top-level 위원회만, 우리 의원만)
  let links = 0;
  for (const [committeeId, members] of Object.entries(membership)) {
    if (!topLevelIds.has(committeeId)) continue; // 소위원회 제외
    for (const mem of members as any[]) {
      const polId = mem.bioguide ? bioToPolId.get(mem.bioguide) : undefined;
      if (polId) { await storage.linkPoliticianCommittee(polId, committeeId); links++; }
    }
  }
  console.log(`✅ enrich 완료 — 위원회 ${topLevelIds.size}개 · 소속 링크 ${links}건`);
  process.exit(0);
}

main().catch((e) => { console.error("enrich 실패:", e); process.exit(1); });
