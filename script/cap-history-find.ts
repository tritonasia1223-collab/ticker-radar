// 히스토리 스냅샷에서 잃어버린 텍스트를 찾는다(읽기전용).
//   실행: npm run cap:find -- "인민은행이 헤지펀드를 죽인"
//   노드 본문(text)·메모(ref)를 전 스냅샷에 걸쳐 검색해, '어느 시각 스냅샷의 어느 카드/노드'에
//   그 내용이 있었는지 보여준다. 가장 온전한(가장 긴) 버전을 골라 복원 근거로 삼는다.
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "cap-history");
const term = process.argv.slice(2).join(" ").trim();

function main() {
  if (!term) { console.log('사용법: npm run cap:find -- "찾을 텍스트"'); process.exit(1); }
  let files: string[] = [];
  try { files = readdirSync(OUT).filter((f) => /^snap\..*\.json$/.test(f)).sort(); } catch { /* no dir */ }
  if (!files.length) { console.log(`히스토리 없음(${OUT}). cap:history 를 켜 두면 쌓입니다.`); process.exit(0); }

  // nodeKey별 '가장 긴 매치'만 대표로 모음(중복 스냅샷 정리).
  const best = new Map<string, { len: number; when: string; slug: string; field: string; text: string }>();
  let hitFiles = 0;
  for (const f of files) {
    let d: any;
    try { d = JSON.parse(readFileSync(join(OUT, f), "utf8")); } catch { continue; }
    const when = d.takenAt ?? f;
    let fileHit = false;
    for (const n of d.nodes ?? []) {
      const slug = d.flows?.find((x: any) => x.id === n.flowId)?.slug ?? `#${n.flowId}`;
      for (const [field, val] of [["text", n.text], ["ref", n.ref]] as const) {
        if (val && String(val).includes(term)) {
          fileHit = true;
          const cur = best.get(`${n.nodeKey}:${field}`);
          if (!cur || String(val).length > cur.len) best.set(`${n.nodeKey}:${field}`, { len: String(val).length, when, slug, field, text: String(val) });
        }
      }
    }
    if (fileHit) hitFiles++;
  }

  console.log(`스냅샷 ${files.length}개 중 ${hitFiles}개에서 "${term}" 발견\n`);
  if (best.size === 0) { console.log("일치 없음."); process.exit(0); }
  for (const [k, v] of [...best.entries()].sort((a, b) => b[1].len - a[1].len)) {
    console.log(`━━ ${k}  [${v.field}, ${v.len}자, ${v.when}, ${v.slug}] ━━`);
    console.log(v.text + "\n");
  }
  process.exit(0);
}
main();
