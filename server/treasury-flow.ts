import { DEBT_DAY, debtDate, debtWindow, type TreasuryFlow, type TreasuryFlowResponse } from "../shared/treasury-flow.js";

type Row = Record<string, unknown>;
type Totals = { issues: number; redemptions: number; inflation: number; billsNet: number };
const endpoint = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/public_debt_transactions";
const fields = "record_date,transaction_type,security_market,security_type,security_type_desc,transaction_fytd_amt,record_fiscal_year";
const types = new Set(["Bills", "Notes", "Bonds", "Inflation-Protected Securities Increment", "Federal Financing Bank"]);
const cache = new Map<string, { expires: number; data: TreasuryFlowResponse }>();
const pending = new Map<string, Promise<TreasuryFlowResponse>>();
const zero = (): Totals => ({ issues: 0, redemptions: 0, inflation: 0, billsNet: 0 });

// 연방 공휴일에는 DTS가 없다. 그 외 평일의 누락은 자료 없음으로 처리한다.
export function debtBusinessDate(date: string): string {
  const year = Number(date.slice(0, 4));
  const holidays = new Set<string>();
  for (const y of [year - 1, year, year + 1]) {
    const fixed = (m: number, d: number) => {
      const ms = Date.UTC(y, m - 1, d), weekday = new Date(ms).getUTCDay();
      holidays.add(debtDate(ms + (weekday === 6 ? -1 : weekday === 0 ? 1 : 0) * DEBT_DAY));
    };
    for (const [m, d] of [[1, 1], [7, 4], [11, 11], [12, 25]]) fixed(m, d);
    if (y >= 2021) fixed(6, 19);
    const nth = (m: number, weekday: number, n: number) => debtDate(Date.UTC(y, m - 1, 1 + (weekday - new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 7) % 7 + (n - 1) * 7));
    holidays.add(nth(1, 1, 3)); holidays.add(nth(2, 1, 3)); holidays.add(nth(9, 1, 1)); holidays.add(nth(10, 1, 2)); holidays.add(nth(11, 4, 4));
    const mayLast = Date.UTC(y, 4, 31); holidays.add(debtDate(mayLast - (new Date(mayLast).getUTCDay() + 6) % 7 * DEBT_DAY));
  }
  let ms = Date.parse(date);
  while ([0, 6].includes(new Date(ms).getUTCDay()) || holidays.has(debtDate(ms))) ms -= DEBT_DAY;
  return debtDate(ms);
}

function snapshot(rows: Row[], date: string): Totals {
  const selected = rows.filter(r => r.record_date === date && r.security_market === "Marketable");
  if (!selected.length) throw new Error(`${date} 발행·상환 자료 미공표`);
  const seen = new Set<string>(), totals = zero();
  for (const row of selected) {
    const type = String(row.security_type), transaction = String(row.transaction_type);
    if (!types.has(type) || !["Issues", "Redemptions"].includes(transaction)) throw new Error("DTS 분류 변경 · 집계 확인 필요");
    const key = `${transaction}:${type}:${row.security_type_desc}`;
    if (seen.has(key)) throw new Error("DTS 중복 항목");
    seen.add(key);
    if (type === "Federal Financing Bank") continue;
    const raw = row.transaction_fytd_amt;
    if (raw == null || String(raw).trim() === "" || !Number.isFinite(Number(raw))) throw new Error("DTS 금액 누락");
    const expectedYear = Number(date.slice(0, 4)) + (date.slice(5, 7) >= "10" ? 1 : 0);
    if (Number(row.record_fiscal_year) !== expectedYear) throw new Error("DTS 회계연도 불일치");
    const v = Number(raw), direction = transaction === "Issues" ? 1 : -1;
    if (type === "Inflation-Protected Securities Increment") totals.inflation += direction * v;
    else {
      totals[transaction === "Issues" ? "issues" : "redemptions"] += v;
      if (type === "Bills") totals.billsNet += direction * v;
    }
  }
  for (const transaction of ["Issues", "Redemptions"]) for (const type of ["Bills", "Notes", "Bonds"]) {
    if (!selected.some(r => r.transaction_type === transaction && r.security_type === type)) throw new Error(`${date} DTS 필수 항목 누락`);
  }
  for (const desc of ["Regular Series", "Cash Management Series"]) {
    if (!selected.some(r => r.transaction_type === "Issues" && r.security_type === "Bills" && r.security_type_desc === desc)) throw new Error(`${date} 단기채 발행 분류 누락`);
  }
  if (!selected.some(r => r.security_type === "Inflation-Protected Securities Increment")) throw new Error("DTS 물가 조정 항목 누락");
  return totals;
}

export function parseTreasuryFlow(rows: Row[], asOf: string, weeks: 4 | 13): TreasuryFlow {
  const window = debtWindow(asOf, weeks);
  const baselineDate = debtBusinessDate(window.from), observedThrough = debtBusinessDate(window.end);
  const first = snapshot(rows, baselineDate), last = snapshot(rows, observedThrough);
  const fy = (date: string) => Number(date.slice(0, 4)) + (date.slice(5, 7) >= "10" ? 1 : 0);
  // 연누계를 두 기준일에서 차감하므로 중간 휴장일·일별 반올림 누적 문제가 없다.
  const carried = fy(baselineDate) === fy(observedThrough) ? zero() : snapshot(rows, debtBusinessDate(`${fy(baselineDate)}-09-30`));
  const delta = Object.fromEntries(Object.keys(first).map(key => [key, last[key as keyof Totals] - first[key as keyof Totals] + carried[key as keyof Totals]])) as Totals;
  return { ...window, baselineDate, observedThrough, ...delta, net: delta.issues - delta.redemptions + delta.inflation };
}

export async function treasuryFlow(asOf: string, weeks: 4 | 13): Promise<TreasuryFlowResponse> {
  const key = `${asOf}:${weeks}`, cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;
  const ongoing = pending.get(key); if (ongoing) return ongoing;
  const task = (async () => {
    try {
      const window = debtWindow(asOf, weeks);
      const dates = new Set([debtBusinessDate(window.from), debtBusinessDate(window.end)]);
      for (let y = Number(window.from.slice(0, 4)); y <= Number(window.end.slice(0, 4)); y++) {
        const date = `${y}-09-30`; if (date >= window.from && date < window.end) dates.add(debtBusinessDate(date));
      }
      const params = new URLSearchParams({ fields, filter: `record_date:in:(${[...dates].sort().join(",")}),security_market:eq:Marketable`, "page[size]": "1000" });
      const response = await fetch(`${endpoint}?${params}`, { signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`재무부 자료 HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body.data) || !body.meta || Number(body.meta["total-pages"]) > 1 || Number(body.meta["total-count"]) !== body.data.length) throw new Error("재무부 응답 불완전");
      const data = { flow: parseTreasuryFlow(body.data, asOf, weeks), error: null };
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { data, expires: Date.now() + 6 * 60 * 60 * 1000 });
      return data;
    } catch (e) { return { flow: null, error: e instanceof Error ? e.message : "국채 발행·상환 조회 실패" }; }
  })().finally(() => pending.delete(key));
  pending.set(key, task); return task;
}
