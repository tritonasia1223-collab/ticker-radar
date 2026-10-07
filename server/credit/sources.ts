import { config, type Point, type Series, type Snapshot, type Source } from "../../shared/credit/schema.js";
import { clean, DAY } from "../../shared/credit/signals.js";
import { configHash } from "./config.js";
import { parseIssuanceWorkbook } from "./excel.js";
import { collectBdc } from "./bdc.js";

export { configHash } from "./config.js";
const UA = process.env.EDGAR_UA || "Fiscus research admin@tritonasia1223.com";
async function get(url: string, json = false) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: json ? "application/json" : "text/csv,text/html" }, signal: AbortSignal.timeout(config.settings.sourceTimeoutMs) });
  if (!r.ok) throw new Error(`원천 응답 HTTP ${r.status}`);
  return json ? r.json() : r.text();
}
export function parseFredCsv(text: string): Point[] {
  const points: Point[] = [];
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const [date, raw] = line.split(",");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !raw?.trim() || raw.trim() === ".") continue;
    const value = Number(raw); if (Number.isFinite(value)) points.push({ date, value });
  }
  return clean(points);
}
async function fred(src: Source, start: string) {
  const key = process.env.FRED_API_KEY;
  if (key) {
    const params = new URLSearchParams({ series_id: src.seriesId!, api_key: key, file_type: "json", observation_start: start });
    const j = await get("https://api.stlouisfed.org/fred/series/observations?" + params, true);
    if (!Array.isArray(j.observations)) throw new Error("FRED 관측 응답 형식 오류");
    return { points: clean(j.observations.flatMap((o: any) => o.value !== "." && String(o.value).trim() && Number.isFinite(Number(o.value)) ? [{ date: o.date, value: Number(o.value) }] : [])), transport: "FRED API", notes: [] };
  }
  const text = await get("https://fred.stlouisfed.org/graph/fredgraph.csv?" + new URLSearchParams({ id: src.seriesId!, cosd: start }));
  return { points: parseFredCsv(text), transport: "FRED 공개 CSV", notes: ["API 키 없이 기존 페이지와 같은 FRED 공개 CSV로 수집했습니다."] };
}
export function parsePrices(j: any, src: Source, today: string): Point[] {
  const r = j?.chart?.result?.[0];
  if (!r || r.meta?.symbol?.toUpperCase() !== src.ticker || !Array.isArray(r.timestamp)) throw new Error("가격 응답 종목·형식 불일치");
  const values = src.adjusted ? r.indicators?.adjclose?.[0]?.adjclose : r.indicators?.quote?.[0]?.close;
  if (!Array.isArray(values)) throw new Error("가격 관측 없음");
  const splits = Object.values(r.events?.splits ?? {}) as { date: number; numerator: number; denominator: number }[];
  return clean(r.timestamp.flatMap((t: number, idx: number) => {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: r.meta.exchangeTimezoneName || "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t * 1000));
    const value = values[idx]; if (date >= today || typeof value !== "number" || !Number.isFinite(value)) return [];
    // Yahoo 종가는 과거 분할을 조정하므로 P/NAV에는 당시 주식수 기준으로 되돌린다.
    const factor = src.adjusted ? 1 : splits.filter(s => s.date > t).reduce((n, s) => n * s.numerator / s.denominator, 1);
    const adjustedValue = r.indicators?.adjclose?.[0]?.adjclose?.[idx];
    return [{ date, value: value * factor, ...(!src.adjusted && typeof adjustedValue === "number" && Number.isFinite(adjustedValue) ? { adjustedValue } : {}) }];
  }));
}
export function parseNav(j: any, src: Source): Point[] {
  if (String(j.cik).padStart(10, "0") !== src.cik) throw new Error("SEC 회사 식별자 불일치");
  const rows = j.facts?.[src.namespace!]?.[src.tag!]?.units?.[src.factUnit!];
  if (!Array.isArray(rows)) throw new Error("검증된 주당 NAV 태그 없음");
  const seen = new Set<string>(); const points: Point[] = [];
  for (const r of rows) {
    if (!["10-Q", "10-K", "10-Q/A", "10-K/A"].includes(r.form) || !(r.val > 0) || !r.filed || !r.end || (r.start && r.start !== r.end)) continue;
    const key = r.end + ":" + r.filed; if (seen.has(key)) continue; seen.add(key);
    // 공시 시각이 없을 때는 공시 다음 날짜부터 적용하는 보수적 처리.
    const effectiveAt = new Date(Date.parse(r.filed) + DAY).toISOString().slice(0, 10);
    points.push({ date: r.end, value: r.val, publishedAt: r.filed, effectiveAt, sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(src.cik)}/${String(r.accn).replace(/-/g, "")}/` });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date) || a.publishedAt!.localeCompare(b.publishedAt!));
}
export async function collectCredit(previous: Snapshot | null, now = new Date(), backfill = false, onlyKeys?: string[]): Promise<Snapshot> {
  const collectedAt = now.toISOString(), today = collectedAt.slice(0, 10), start = new Date(now.getTime() - config.settings.historyYears * 365.25 * DAY).toISOString().slice(0, 10);
  const prior = new Map(previous?.series.map(s => [s.key, s]) ?? []);
  const series: Series[] = onlyKeys ? [...prior.values()].filter(s => !onlyKeys.includes(s.key)) : [];
  const requests = new Map<string, Promise<any>>();
  const once = (url: string, json = false) => { if (!json) return get(url); if (!requests.has(url)) requests.set(url, get(url, json)); return requests.get(url)!; };
  const bdcs = new Map<string, ReturnType<typeof collectBdc>>();
  // 필수 지표 원계열부터 수집. 키와 순서는 JSON에서 가져온다.
  const essential = new Set(config.paths.flatMap(p => p.indicators).filter(i => i.essential).flatMap(i => i.chart.lines.flatMap(l => [l.key, ...(l.navKey ? [l.navKey] : [])])));
  const sources = config.sources.filter(s => !onlyKeys || onlyKeys.includes(s.key)).sort((a, b) => Number(essential.has(b.key)) - Number(essential.has(a.key)));
  for (let offset = 0; offset < sources.length; offset += config.settings.concurrency) {
    series.push(...await Promise.all(sources.slice(offset, offset + config.settings.concurrency).map(async src => {
      const old = prior.get(src.key);
      if (src.provider === "manual") return old ?? { key: src.key, checkedAt: collectedAt, transport: "수동 CSV", points: [], notes: ["CSV 입력 대기"] };
      try {
        let result: { points: Point[]; transport: string; notes: string[] };
        if (src.provider === "fred") result = await fred(src, start);
        else if (src.provider === "sec") result = { points: parseNav(await once(`https://data.sec.gov/api/xbrl/companyfacts/CIK${src.cik}.json`, true), src), transport: "SEC Company Facts", notes: ["NAV 관측일·공시일을 분리 저장합니다. 관측 기준 조회는 분기말부터, 공시 기준 조회는 공시 다음날부터 연결합니다."] };
        else if (src.provider === "xlsx") {
          const response = await fetch(src.workbook!.downloadUrl, { signal: AbortSignal.timeout(config.settings.sourceTimeoutMs) });
          if (!response.ok) throw new Error(`원천 응답 HTTP ${response.status}`);
          const downloaded = await parseIssuanceWorkbook(Buffer.from(await response.arrayBuffer()), src, today);
          if (old?.points.length && downloaded.at(-1)!.date < old.points.at(-1)!.date) throw new Error("원천 최신 관측이 이전 수집보다 과거입니다");
          const merged = new Map(old?.points.map(p => [p.date, p]) ?? []); downloaded.forEach(p => merged.set(p.date, p));
          result = { points: [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)), transport: "SIFMA 공개 엑셀", notes: ["월별 전체 회사채 발행액 · 등급별 IG/HY와 구분 · 개별 발표일 이력 미확인"] };
        }
        else if (src.provider === "sec_credit") {
          if (!bdcs.has(src.cik!)) bdcs.set(src.cik!, collectBdc(src, previous, once, today, backfill));
          const bdc = await bdcs.get(src.cik!)!; const points = bdc.points[src.metric!];
          result = { points, transport: "SEC 분기 공시 자동 추출", notes: bdc.warnings };
          if (!points.length || points.at(-1)!.date !== bdc.latestReport || bdc.warnings.some(w => w.startsWith(bdc.latestReport!) && w.includes("연결"))) throw new Error("공시 최신 분기 추출 미확인");
        }
        else { const params = new URLSearchParams({ interval: "1d", period1: String(Math.floor(Date.parse(start) / 1000)), period2: String(Math.floor(now.getTime() / 1000)), events: "splits,div", includeAdjustedClose: "true" }); result = { points: parsePrices(await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(src.ticker!)}?${params}`, true), src, today), transport: "Yahoo 일별 가격", notes: [src.adjusted ? "분배금·분할 수정 가격" : "P/NAV용 당시 주식수 기준 종가 · 당일 미완료 봉 제외"] }; }
        if (!result.points.length) throw new Error("유효 관측 없음");
        if (old?.points.length && result.points.at(-1)!.date < old.points.at(-1)!.date) throw new Error("원천 최신 관측이 이전 수집보다 과거입니다");
        if (["fred", "yahoo"].includes(src.provider) && old?.points.length) {
          const first = result.points[0].date;
          result.points = clean([...old.points.filter(p => p.date < first), ...result.points]);
        }
        return { key: src.key, checkedAt: collectedAt, ...result };
      } catch (error) {
        // 외부 오류 URL에는 키가 포함될 수 있으므로 원문 메시지를 기록하지 않는다.
        return { key: src.key, points: old?.points ?? [], checkedAt: collectedAt, transport: old?.transport ?? src.provider, error: error instanceof Error && /^(원천 응답 HTTP|유효 관측 없음|검증된 주당|원천 최신|SEC 회사|가격 응답|가격 관측|엑셀|공시)/.test(error.message) ? error.message : "원천 연결·응답 확인 실패", notes: [...new Set([...(old?.notes ?? []), "마지막 유효 자료가 있으면 보존합니다."])] };
      }
    })));
  }
  return { version: 1, collectedAt, configHash: configHash(), series };
}
export async function verifySource(src: Source) {
  if (src.provider !== "fred") return { key: src.key, status: "별도 소스", provider: src.provider };
  if (!process.env.FRED_API_KEY) {
    const result = await fred(src, new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10));
    return { key: src.key, status: result.points.length ? "공개 CSV 관측 확인 · 인증 메타데이터 미검증" : "관측 없음", count: result.points.length, from: result.points[0]?.date, to: result.points.at(-1)?.date, expectedFrequency: src.frequency, expectedUnit: src.unit };
  }
  const j = await get("https://api.stlouisfed.org/fred/series?" + new URLSearchParams({ series_id: src.seriesId!, api_key: process.env.FRED_API_KEY, file_type: "json" }), true);
  const m = j.seriess?.[0]; if (!m) throw new Error("계열 메타데이터 없음");
  const matchesFrequency = String(m.frequency).toLowerCase().startsWith(src.frequency);
  const matchesUnit = src.unit === "billions" ? /billions/i.test(m.units) : ["percent", "pp"].includes(src.unit) ? m.units === "Percent" : false;
  return { key: src.key, status: matchesFrequency && matchesUnit ? "API 정의·주기·단위 확인" : "설정 불일치", title: m.title, frequency: m.frequency, units: m.units, seasonalAdjustment: m.seasonal_adjustment, from: m.observation_start, to: m.observation_end };
}
