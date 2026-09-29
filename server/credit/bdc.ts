import { load, type CheerioAPI } from "cheerio";
import { config, type Point, type Source, type Snapshot } from "../../shared/credit/schema.js";

type Filing = { date: string; filed: string; accn: string; doc: string; form: string };
type Fact = { start?: string; end: string; value: number; dimensional: boolean };
type Getter = (url: string, json?: boolean) => Promise<any>;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const text = (s: string) => s.replace(/\s+/g, " ").trim();
const percent = (n: number) => { if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error("공시 비율 범위 오류"); return n; };
const archive = (cik: string, f: Filing) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accn.replace(/-/g, "")}/${f.doc}`;
export function quarterlyFact(j: any, tag: string, end: string, filed: string): number | null {
  const rows = j.facts?.["us-gaap"]?.[tag]?.units?.USD;
  if (!Array.isArray(rows)) return null;
  const year = end.slice(0, 4), month = Number(end.slice(5, 7));
  const start = `${year}-${String(month - 2).padStart(2, "0")}-01`;
  const value = (from: string, to: string): number | null => {
    const matches = rows.filter((r: any) => r.start === from && r.end === to && r.filed <= filed && ["10-Q", "10-K", "10-Q/A", "10-K/A"].includes(r.form)).sort((a: any, b: any) => b.filed.localeCompare(a.filed));
    return matches.length && Number.isFinite(matches[0].val) ? matches[0].val : null;
  };
  const direct = value(start, end); if (direct !== null) return direct;
  if (month === 3) return null;
  const ytd = value(`${year}-01-01`, end), prior = value(`${year}-01-01`, iso(new Date(Date.UTC(Number(year), month - 3, 0))));
  return ytd !== null && prior !== null ? ytd - prior : null;
}
function inlineFacts($: CheerioAPI) {
  const contexts = new Map<string, Omit<Fact, "value">>();
  $("xbrli\\:context, context").each((_, el) => {
    const e = $(el); const end = e.find("xbrli\\:instant, instant, xbrli\\:endDate, xbrli\\:enddate, enddate").first().text();
    const start = e.find("xbrli\\:startDate, xbrli\\:startdate, startdate").first().text();
    contexts.set(e.attr("id")!, { end, start: start || undefined, dimensional: e.find("xbrldi\\:explicitMember, xbrldi\\:explicitmember, xbrldi\\:typedMember, xbrldi\\:typedmember").length > 0 });
  });
  const facts = new Map<string, Fact[]>();
  $("[name][contextref]").each((_, el) => {
    const e = $(el), c = contexts.get(e.attr("contextref")!); if (!c) return;
    const raw = text(e.text()).replace(/,/g, "");
    const v = /^[-—–]$/.test(raw) ? 0 : Number(raw.replace(/[()]/g, "")) * (raw.startsWith("(") ? -1 : 1);
    if (!raw || !Number.isFinite(v)) return;
    const value = v * 10 ** Number(e.attr("scale") ?? 0) * (e.attr("sign") === "-" ? -1 : 1);
    const name = e.attr("name")!.split(":").at(-1)!;
    facts.set(name, [...(facts.get(name) ?? []), { ...c, value }]);
  });
  return facts;
}
function uniqueFact(rows: Fact[], end: string, start?: string) {
  const values = [...new Set(rows.filter(r => !r.dimensional && r.end === end && r.start === start).map(r => r.value))];
  return values.length === 1 ? values[0] : null;
}
export function parseBdcReport(html: string, src: Source, filing: Filing, facts: any, previousPik: Point[]) {
  const $ = load(html); const rawPeriod = text($("[name='dei:DocumentPeriodEndDate']").first().text());
  const period = /^\d{4}-\d{2}-\d{2}$/.test(rawPeriod) ? rawPeriod : rawPeriod + " UTC";
  if (!Number.isFinite(Date.parse(period)) || iso(new Date(period)) !== filing.date || String(facts.cik).padStart(10, "0") !== src.cik) throw new Error("공시 회사·분기 불일치");
  const spec = src.credit!, fields = inlineFacts($); const result: Record<string, Point | undefined> = {};
  const point = (v: number, basis: string): Point => ({ date: filing.date, publishedAt: filing.filed, value: percent(v), basis, sourceUrl: archive(src.cik!, filing) });
  if (spec.method === "tagged") {
    for (const [metric, tag, basis] of [["nonaccrual_fv", spec.fairValueTag!, "fair_value"], ["nonaccrual_cost", spec.costTag!, "amortized_cost"]]) {
      const v = uniqueFact(fields.get(tag) ?? [], filing.date); if (v !== null) result[metric] = point(v * 100, basis);
    }
  } else if (spec.method === "table") {
    const dateLabel = new Date(filing.date).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
    const matches: number[][] = [];
    $("table").each((_, el) => {
      const table = $(el), title = text(table.text());
      if (!title.startsWith(`As of ${dateLabel}`) || !/Amortized Cost.*Percentage.*Fair value.*Percentage/i.test(title)) return;
      table.find("tr").each((_, row) => {
        const cells = $(row).find("td").map((_, cell) => text($(cell).text())).get().filter(Boolean);
        if (cells[0] !== "Non-accrual") return;
        const nums = cells.slice(1).filter(s => /^[\d,.]+$/.test(s)).map(s => Number(s.replace(/,/g, "")));
        if (nums.length >= 4) matches.push(nums);
      });
    });
    if (matches.length === 1) { result.nonaccrual_cost = point(matches[0][1], "amortized_cost"); result.nonaccrual_fv = point(matches[0][3], "fair_value"); }
  }
  const denominator = quarterlyFact(facts, spec.denominatorTag, filing.date, filing.filed);
  let numerator: number | null = null;
  if (spec.pikAccruedTag) {
    const month = Number(filing.date.slice(5, 7)), year = filing.date.slice(0, 4);
    const rows = fields.get(spec.pikAccruedTag) ?? [];
    numerator = uniqueFact(rows, filing.date, `${year}-${String(month - 2).padStart(2, "0")}-01`);
    if (numerator === null && month > 3) {
      const ytd = uniqueFact(rows, filing.date, `${year}-01-01`);
      const earlier = [3, 6, 9].filter(m => m < month).map(m => previousPik.find(p => p.date === iso(new Date(Date.UTC(Number(year), m, 0)))));
      if (ytd !== null && earlier.every(p => p?.components)) numerator = ytd - earlier.reduce((sum, p) => sum + p!.components!.numerator, 0);
    }
  } else {
    const values = spec.pikTags.map(tag => quarterlyFact(facts, tag, filing.date, filing.filed));
    if (values.every(v => v !== null)) numerator = values.reduce<number>((sum, v) => sum + v!, 0);
  }
  if (numerator !== null && denominator !== null && numerator >= 0 && denominator > 0) result.pik = { ...point(numerator / denominator * 100, "pik_income_over_total_investment_income"), components: { numerator, denominator } };
  return result;
}
export function parseBdcEarnings(html: string, date: string) {
  const $ = load(html), body = text($.text());
  const label = new Date(date).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
  const pattern = new RegExp(`As of ${label},? investments on non-accrual status represented ([\\d.]+)% and ([\\d.]+)% of the total investment portfolio at fair value and (?:amortized )?cost, respectively`, "i");
  const m = body.match(pattern); return m ? { nonaccrual_fv: percent(Number(m[1])), nonaccrual_cost: percent(Number(m[2])) } : null;
}
function filings(recent: any): Filing[] {
  return (recent.form ?? []).map((form: string, n: number) => ({ form, date: recent.reportDate[n], filed: recent.filingDate[n], accn: recent.accessionNumber[n], doc: recent.primaryDocument[n] }));
}
export async function collectBdc(src: Source, previous: Snapshot | null, get: Getter, today: string) {
  const j = await get(`https://data.sec.gov/submissions/CIK${src.cik}.json`, true);
  if (String(j.cik).padStart(10, "0") !== src.cik) throw new Error("공시 회사 식별자 불일치");
  const facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${src.cik}.json`, true);
  const all = filings(j.filings.recent), wanted = all.filter(f => ["10-Q", "10-K"].includes(f.form) && f.filed <= today).slice(0, src.credit!.maxFilings).reverse();
  const result: Record<string, Point[]> = Object.fromEntries(["nonaccrual_fv", "nonaccrual_cost", "pik"].map(metric => {
    const key = config.sources.find(s => s.provider === "sec_credit" && s.ticker === src.ticker && s.metric === metric)?.key;
    return [metric, [...(previous?.series.find(s => s.key === key)?.points ?? [])]];
  }));
  const warnings: string[] = [];
  for (const [n, f] of wanted.entries()) {
    if (n < wanted.length - 1 && Object.values(result).every(points => points.some(p => p.date === f.date && p.publishedAt === f.filed))) continue;
    try {
      const parsed = parseBdcReport(await get(archive(src.cik!, f)), src, f, facts, result.pik);
      if (src.credit!.method === "earnings") {
        const release = all.find(e => e.form === "8-K" && e.filed === f.filed);
        if (release) {
          const releaseUrl = archive(src.cik!, release), $ = load(await get(releaseUrl));
          const links = [...new Set($("a[href]").map((_, e) => /99[.\-]?1|ex99.?1/i.test($(e).text() + " " + $(e).attr("href")) ? new URL($(e).attr("href")!, releaseUrl).href : "").get().filter(u => u.startsWith(releaseUrl.slice(0, releaseUrl.lastIndexOf("/") + 1)) && /\.htm[l]?$/i.test(u)))];
          for (const url of links.slice(0, 3)) {
            const ratios = parseBdcEarnings(await get(url), f.date); if (!ratios) continue;
            for (const [metric, value] of Object.entries(ratios)) parsed[metric] = { date: f.date, publishedAt: f.filed, value, basis: metric.endsWith("fv") ? "fair_value" : "amortized_cost", sourceUrl: url };
            break;
          }
        }
      }
      for (const [metric, points] of Object.entries(result)) if (parsed[metric]) { const old = points.findIndex(p => p.date === f.date); if (old >= 0) points[old] = parsed[metric]!; else points.push(parsed[metric]!); }
      if (Object.keys(parsed).length < 3) warnings.push(`${f.date} 일부 공시 항목 추출 미확인`);
    } catch { warnings.push(`${f.date} 공시 연결·형식 확인 필요`); }
  }
  for (const points of Object.values(result)) points.sort((a, b) => a.date.localeCompare(b.date));
  return { points: result, latestReport: wanted.at(-1)?.date, warnings };
}
