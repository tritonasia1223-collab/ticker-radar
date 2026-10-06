import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { buildNominalTrade, buildRealTrade, verifyTradeOverlap } from "../../shared/trade-history.js";
import type { Point } from "../../shared/capitalism-refresh.js";

const pageUrl = "https://www.bea.gov/data/intl-trade-investment/international-trade-goods-and-services";
const fred = (id: string) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;

export async function fetchTradeHistory() {
  const sources: { url: string; sha256: string }[] = [];
  async function download(url: string) {
    const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    sources.push({ url, sha256: createHash("sha256").update(buffer).digest("hex") });
    return buffer;
  }
  async function csv(id: string): Promise<Point[]> {
    return (await download(fred(id))).toString("utf8").trim().split(/\r?\n/).slice(1).flatMap(line => {
      const [date, raw] = line.split(",");
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && raw?.trim() && Number.isFinite(Number(raw)) ? [[date, Number(raw)] as Point] : [];
    });
  }
  const page = (await download(pageUrl)).toString("utf8");
  const href = [...page.matchAll(/href=["']([^"']*\/trad\d+-time-series\.xlsx)["']/g)][0]?.[1];
  if (!href) throw new Error("BEA historical trade workbook link not found");
  const workbookUrl = new URL(href, pageUrl).href;
  const results = await Promise.allSettled([download(workbookUrl), ...["EXPGSCA", "IMPGSCA", "EXPGSC1", "IMPGSC1", "NETEXC", "BOPGSTB"].map(csv)]);
  const failed = results.find(r => r.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  const [xlsx, ae, ai, qe, qi, net, monthly] = results.map(r => (r as PromiseFulfilledResult<unknown>).value) as [Buffer, Point[], Point[], Point[], Point[], Point[], Point[]];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx as any);
  const sheet = workbook.getWorksheet("Table 1");
  if (!sheet || !String(sheet.getCell("A4").value).includes("Millions of dollars")) throw new Error("Unexpected BEA table/units");
  const annual: Point[] = [], workbookMonthly: Point[] = [];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  sheet.eachRow(row => {
    const period = String(row.getCell(1).value ?? "").trim(), value = row.getCell(2).value;
    if (typeof value !== "number") return;
    if (/^\d{4}$/.test(period)) annual.push([`${period}-01-01`, value]);
    const match = /^(\d{4}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?(?:\s+\([RP]\))?$/.exec(period);
    if (match) workbookMonthly.push([`${match[1]}-${String(months.indexOf(match[2]) + 1).padStart(2, "0")}-01`, value]);
  });
  // Reject mismatched releases instead of silently combining revised and unrevised sources.
  const monthlyOverlap = verifyTradeOverlap(monthly.map(([d,v]) => [d,v/1000]), workbookMonthly.map(([d,v]) => [d,v/1000]), monthly.length, .001);
  const nominal = buildNominalTrade(annual, monthly), real = buildRealTrade(ae, ai, qe, qi, net);
  return {
    trade_bal: nominal.points, trade: real.points,
    audit: { checkedAt: new Date().toISOString(), sources, nominalAnnualVsMonthly: nominal.overlap, monthlyVsWorkbook: monthlyOverlap, realCalculatedVsOfficial: real.overlap },
    history: {
      trade_bal: { modernFrom: "1992-01-01", segments: [
        { from: "1960-01-01", to: "1991-01-01", source: "BEA 상품·서비스 무역수지 · 연간÷12", short: "연간·월평균 환산", id: "BEA BOP annual ÷ 12", url: workbookUrl, note: "명목·국제수지 기준. 연간 합계÷12÷1000으로 십억 달러/월 환산. 연간 1개 관측이며 월별 움직임은 알 수 없습니다.", method: "append", proxy: false, factor: null },
      ] },
      trade: { modernFrom: "1970-01-01", segments: [
        { from: "1929-01-01", to: "1946-01-01", source: "BEA 실질 수출−수입 · 연간", short: "연간·계산값", id: "EXPGSCA − IMPGSCA", url: "https://fred.stlouisfed.org/graph/?id=EXPGSCA,IMPGSCA", note: "2017년 연쇄가격·십억 달러. 공식 수출−수입으로 직접 계산. 연간 1개 관측.", method: "append", proxy: false, factor: null },
        { from: "1947-01-01", to: "1969-10-01", source: "BEA 실질 수출−수입 · 분기 연율", short: "분기·계산값", id: "EXPGSC1 − IMPGSC1", url: "https://fred.stlouisfed.org/graph/?id=EXPGSC1,IMPGSC1", note: "2017년 연쇄가격·십억 달러·계절조정 연율. 공식 수출−수입으로 직접 계산. 명목 순수출을 섞었던 기존 값을 교정했습니다.", method: "append", proxy: false, factor: null },
      ] },
    },
  };
}
