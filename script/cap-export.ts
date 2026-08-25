// 자본주의 경제사 카드를 'Claude 가 읽기 좋은' 마크다운으로 카드별 내보내기(읽기전용).
//   실행: npm run cap:export   → script/cap-export/ 에 카드별 .md + 00-INDEX.md 생성.
// 마커([[색|텍스트]])는 **굵게**, 링크는 텍스트만, 불릿은 리스트로, 표는 md 표로, 메모·인사이트 포함.
import "dotenv/config";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { listFlows, getSetting } from "../server/capitalism.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "cap-export");

// 마커 문자열 → 읽기용 텍스트. 색/하이라이트=**굵게**, 링크=텍스트, 불릿(\t*• )=들여쓴 리스트.
function md(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.replace(/\[\[(link:[A-Za-z0-9_-]+|[a-z-]+)\|([^\]]*)\]\]/g,
    (_m, key: string, txt: string) => (key.startsWith("link:") ? txt : `**${txt}**`));
  s = s.split("\n").map((line) => {
    const m = line.match(/^(\t*)•\s?(.*)$/);
    return m ? `${"  ".repeat(m[1].length)}- ${m[2]}` : line;
  }).join("\n");
  s = s.replace(/\*{3,}/g, "**"); // 원문에 이미 ** 가 있던 마크에서 생기는 ****/****** 정리
  return s.trim();
}

function mdTable(t: { title?: string; widths: number[]; cells: string[][] } | null | undefined): string {
  if (!t || !t.cells || !t.cells.length) return "";
  const rows = t.cells.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "").replace(/\n/g, " ")) : []));
  const cols = Math.max(...rows.map((r) => r.length), 1);
  const pad = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? "");
  let out = t.title ? `**${t.title}**\n\n` : "";
  out += "| " + pad(rows[0]).join(" | ") + " |\n";
  out += "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |\n";
  for (const r of rows.slice(1)) out += "| " + pad(r).join(" | ") + " |\n";
  return out + "\n";
}

const colLabel = (c: string | null | undefined) => (c === "left" ? "좌" : c === "right" ? "우" : "중앙");

function renderBlocks(blocks: any[]): string {
  const parts: string[] = [];
  for (const b of blocks ?? []) {
    if (b.type === "text") { const t = md(b.text); if (t) parts.push(t); }
    else if (b.type === "table") parts.push(mdTable(b.table));
    else if (b.type === "chart") parts.push(`_[그래프: ${b.chart.series} · ${b.chart.from}~${b.chart.to}]_`);
    else if (b.type === "image") parts.push(`_[이미지]_`);
    else if (b.type === "html") parts.push(`_[미니앱(인터랙티브)]_`);
    else if (b.type === "divider") parts.push("---");
  }
  return parts.join("\n\n");
}

// 통합본용 카드 섹션(제목 헤딩 ## + 앵커, 소제목은 굵게 — 통합 문서 내 계층 충돌 없게).
function cardSection(f: any, idx: number): string {
  const when = f.endDate ? `${f.date} ~ ${f.endDate}` : f.date;
  let out = `## <a id="c${String(idx).padStart(3, "0")}"></a>${idx}. ${when} · ${f.title}\n\n`;
  out += `<sub>분류 ${f.category} · 배치 ${f.layout} · id \`${f.slug}\`</sub>\n\n`;
  out += `**사건 흐름**\n\n`;
  f.nodes.forEach((n: any, i: number) => {
    const colTag = f.layout === "branch" ? `**[${colLabel(n.col)}]** ` : "";
    out += `${i + 1}. ${colTag}${md(n.text) || "_(빈 칸)_"}\n`;
    if (n.ref && n.ref.trim()) out += `\n   > 📝 ${md(n.ref).replace(/\n/g, "\n   > ")}\n`;
    if (n.table) out += `\n${mdTable(n.table)}`;
    out += `\n`;
  });
  const ins = f.insight;
  if (ins && (ins.text?.trim() || ins.blocks?.length || ins.tables?.length || ins.charts?.length)) {
    out += `**인사이트 (과거↔현재 연결)**\n\n`;
    out += (ins.blocks?.length ? renderBlocks(ins.blocks)
      : [md(ins.text), ...(ins.tables ?? []).map(mdTable)].filter(Boolean).join("\n\n")) + "\n";
  }
  return out;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (/\.md$/.test(f)) { try { unlinkSync(join(OUT, f)); } catch { /* noop */ } }

  const flows = (await listFlows()).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sortOrder - b.sortOrder));
  const pad = (n: number) => String(n).padStart(3, "0");

  // 메타(전체 관통) 인사이트 섹션 — 특정 사건에 안 묶이는 app-level 카드(cap_settings).
  let metaSection = "";
  let metaCount = 0;
  try {
    const v2 = await getSetting("insight_overview_v2");
    const metaCards: any[] = v2 ? (JSON.parse(v2).cards ?? []) : [];
    const legacy = await getSetting("insight_overview");
    metaCount = metaCards.length;
    if (metaCards.length || (legacy && legacy.trim())) {
      metaSection = `## <a id="meta"></a>[메타] 전체 관통 인사이트\n\n특정 사건에 안 묶이는, 자본주의 경제사 전체를 관통하는 테제/패턴.\n\n`;
      metaCards.forEach((c, i) => {
        metaSection += `### ${c.title?.trim() || `메타 인사이트 ${i + 1}`}\n\n`;
        metaSection += (c.blocks?.length ? renderBlocks(c.blocks)
          : [md(c.text), ...(c.tables ?? []).map(mdTable)].filter(Boolean).join("\n\n")) + "\n\n";
      });
      if (legacy && legacy.trim()) metaSection += `### (레거시) 초기 메타 테제\n\n${md(legacy)}\n\n`;
    }
  } catch (e) { console.error("메타 인사이트 건너뜀:", (e as Error).message); }

  // ── 목차(인덱스) ──
  const toc: string[] = [];
  if (metaSection) toc.push(`- [**[메타] 전체 관통 인사이트**](#meta)`);
  flows.forEach((f, i) => {
    const when = f.endDate ? `${f.date} ~ ${f.endDate}` : f.date;
    const badge = f.insight && (f.insight.text?.trim() || f.insight.blocks?.length) ? " ⭐" : "";
    toc.push(`${i + 1}. [${when} · ${f.title}](#c${pad(i + 1)})${badge}`);
  });

  // ── 통합본 조립 ──
  let doc = `# 자본주의 경제사 (통합본)\n\n`;
  doc += `카드 **${flows.length}개** · 날짜순 · 메타 인사이트 ${metaCount}개 포함. (⭐ = 사건별 인사이트 있음)\n\n`;
  doc += `## 목차\n\n${toc.join("\n")}\n\n---\n\n`;
  if (metaSection) doc += metaSection + "\n---\n\n";
  flows.forEach((f, i) => { doc += cardSection(f, i + 1) + "\n---\n\n"; });

  const file = join(OUT, "자본주의-경제사-통합.md");
  writeFileSync(file, doc, "utf8");
  console.log(`✅ 통합본 생성 완료 — 카드 ${flows.length} + 메타 ${metaCount}`);
  console.log(`   파일: ${file}  (${(doc.length / 1024).toFixed(0)} KB)`);
  process.exit(0);
}
main().catch((e) => { console.error("내보내기 실패:", e); process.exit(1); });
