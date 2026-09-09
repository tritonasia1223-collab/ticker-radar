import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extractLinks, newLinks, validateRto, type Link, type Source } from "../shared/world-refresh.js";

const statePath = ".github/data/world-source-state.json", reportPath = "docs/data-refresh/world-latest.md";
const outDir = "script/cap-export", mapPath = "client/src/data/us-rto-regions.json";
const sources: Source[] = JSON.parse(readFileSync("script/world-refresh-sources.json", "utf8"));
type Snapshot = { seen: Link[]; pending: Link[]; lastSuccess?: string };
const state: Record<string, Snapshot> = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const checkedAt = new Date().toISOString();
const report: { source: string; status: string; added?: number; error?: string }[] = [];
mkdirSync(outDir, { recursive: true });
mkdirSync(".github/data", { recursive: true });
mkdirSync("docs/data-refresh", { recursive: true });

async function fetchText(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Mozilla/5.0 (compatible; FISCUS/1.0)" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.length < 100 || /<title>[^<]*(access denied|just a moment|captcha)/i.test(text)) throw new Error("Source blocked or incomplete");
      return text;
    } catch (error) { if (attempt >= 1) throw error; }
  }
}

// Capture failed sources independently; never erase their last successful snapshot or pending review list.
async function scan(source: Source) {
  if (source.manual) { report.push({ source: source.id, status: "manual", error: source.manual }); return; }
  try {
    const html = await fetchText(source.url);
    if (!extractLinks(html, { ...source, topic: undefined }).length) throw new Error("No article links: manual check / selector update needed");
    const links = extractLinks(html, source);
    const previous = state[source.id] ?? { seen: [], pending: [] };
    const added = newLinks(previous.seen, links);
    state[source.id] = { seen: [...previous.seen, ...added], pending: [...previous.pending, ...added], lastSuccess: checkedAt };
    report.push({ source: source.id, status: previous.lastSuccess ? "ok" : "baseline", added: added.length });
  } catch (error) { report.push({ source: source.id, status: "error", error: String(error) }); }
}

async function main() {
  // The NRC annual index follows the calendar year; avoid silently checking 2026 forever.
  const nrc = sources.find(x => x.id === "nrc");
  if (nrc) nrc.url = nrc.url.replace("/2026/", `/${new Date().getUTCFullYear()}/`);
  for (let i = 0; i < sources.length; i += 4) await Promise.all(sources.slice(i, i + 4).map(scan));
  const before = readFileSync(mapPath, "utf8");
  let mapStatus = "unchanged";
  try {
    execFileSync(process.execPath, ["--import", "tsx", "script/build-us-rto.ts"], { stdio: "inherit", timeout: 180000 });
    const after = readFileSync(mapPath, "utf8");
    validateRto(JSON.parse(before), JSON.parse(after));
    if (after !== before) mapStatus = "updated";
  } catch (error) {
    writeFileSync(mapPath, before);
    mapStatus = "error (original preserved)";
    report.push({ source: "rto", status: "error", error: String(error).slice(0, 500) });
  }
  const safe = (s: string) => s.replace(/[\[\]<>|`]/g, " ").replace(/\r?\n/g, " ");
  const lines = ["# 세계 현황판 월간 검토 목록", "", `확인: ${checkedAt}`, "", "공식 출처 목록의 새 링크를 수집한 검토 후보입니다. 사실 확인이나 사이트 반영 완료를 뜻하지 않습니다. 첫 실행은 기존 게시물도 포함한 기준 목록을 만듭니다.", "", `전력시장 경계: ${mapStatus}. 7개 권역·좌표·면적 변화 검증 후에만 자동 반영합니다.`, "", "| 출처 | 조회 결과 | 새 후보 | 마지막 성공 |", "|---|---|---|---|"];
  for (const source of sources) {
    const result = report.find(x => x.source === source.id)!;
    lines.push(`| [${source.name}](${source.url}) | ${result.error ? safe(result.error) : result.status} | ${result.added ?? "—"} | ${state[source.id]?.lastSuccess ?? "없음"} |`);
  }
  lines.push("", "## 검토 대기", "", "후보를 검토한 뒤 `.github/data/world-source-state.json`의 해당 `pending` 항목만 제거합니다. `seen`은 유지해 같은 링크를 다시 제안하지 않게 합니다. 링크 제목은 원문 목록의 표시이며 요약이나 확정 사실이 아닙니다.");
  for (const source of sources) {
    const pending = state[source.id]?.pending ?? [];
    if (!pending.length) continue;
    lines.push("", `### ${source.name} (${pending.length}건)`, "");
    for (const item of pending) lines.push(`- [${safe(item.title)}](${item.url.replace(/\(/g, "%28").replace(/\)/g, "%29")})`);
  }
  lines.push("", "## 범위와 한계", "", "등록한 출처의 공개 목록 페이지만 비교합니다. 목록에서 빠진 과거 기사·같은 URL의 본문 수정·전체 웹의 새 발표를 포괄하지 않습니다. 원전/분쟁/항만의 새 버전은 검토 후보이며, 자료 정의와 수작업 보강을 확인한 뒤 반영합니다. 기업별 미등록 출처·영토 분쟁 서술·송전선 전체·기본 지형은 자동 갱신 범위 밖입니다. 조회 실패는 변화 없음으로 취급하지 않습니다.");
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  writeFileSync(reportPath, lines.join("\n") + "\n");
  writeFileSync(`${outDir}/world-refresh-latest.json`, JSON.stringify({ checkedAt, mapStatus, sources: report }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.slice(0, 9 + sources.length).join("\n") + `\n\n[검토 목록](https://github.com/${process.env.GITHUB_REPOSITORY}/blob/master/${reportPath})\n`);
  console.log(JSON.stringify({ mapStatus, sources: report }));
  // Reports still publish, while the workflow is visibly degraded if a source is unavailable.
  if (report.some(x => x.status === "error")) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
