import config from "./treasury-ownership-config.json";

export const ownershipGroups = config.groups;
export type Issuer = "circle" | "tether";
export interface OwnerQuarter {
  date: string;
  total: number; // Z.1 보유자 자산 합계, 백만 달러. 발행 잔액과 평가 기준이 다르다.
  outstanding: number;
  bills: number;
  groups: Record<string, number>;
  domesticHedgeFunds: number;
}
export interface IssuerHolding {
  issuer: string;
  date: string;
  publishedAt?: string | null;
  treasuries: number;
  fund?: number;
  direct?: number;
  source: string;
  frequency: string;
}
export interface OwnershipData {
  collectedAt: string;
  ownershipSource: string;
  ownership: OwnerQuarter[];
  issuers: IssuerHolding[];
}

/** 관측 기준일로 되돌아본다. 공시일은 표시하되 과거 선택에서 늦게 공시된 자료를 배제하지 않는다. */
export function atOrBefore<T extends { date: string }>(rows: T[], date: string): T | null {
  return rows.reduce<T | null>((found, r) => r.date <= date && (!found || r.date > found.date) ? r : found, null);
}

export function ownershipView(data: OwnershipData, asOf: string) {
  const quarter = atOrBefore(data.ownership, asOf);
  if (!quarter || !Number.isFinite(quarter.total) || quarter.total <= 0) return null;
  const previous = atOrBefore(data.ownership, new Date(Date.parse(quarter.date) - 86400000).toISOString().slice(0, 10));
  const issuers = (["circle", "tether"] as const).map(id => {
    const all = data.issuers.filter(r => r.issuer === id && Number.isFinite(r.treasuries) && r.treasuries >= 0);
    const candidate = atOrBefore(all, quarter.date);
    // 휴일로 월말 관측이 직전 영업일인 경우만 허용. 서로 다른 분기 수치를 합치지 않는다.
    const holding = candidate && Date.parse(quarter.date) - Date.parse(candidate.date) <= 7 * 86400000 ? candidate : null;
    const prevCandidate = previous ? atOrBefore(all, previous.date) : null;
    const prev = prevCandidate && previous && Date.parse(previous.date) - Date.parse(prevCandidate.date) <= 7 * 86400000 ? prevCandidate : null;
    return { id, holding, latest: atOrBefore(all, asOf), delta: holding && prev ? holding.treasuries - prev.treasuries : null };
  });
  const complete = issuers.every(i => i.holding !== null);
  const sum = complete ? issuers.reduce((n, i) => n + i.holding!.treasuries, 0) : null;
  const maxValue = Math.max(0, ...issuers.map(i => i.holding?.treasuries ?? 0));
  // 확대 막대의 축은 실제 금액으로 표시한다. 보유액이 작아도 최소 폭으로 부풀리지 않는다.
  const zoomMax = Math.max(10000, Math.ceil(maxValue / 25000) * 25000);
  return { quarter, previous, issuers, complete, sum, zoomMax,
    share: sum === null ? null : sum / quarter.total * 100,
    billShare: sum === null || quarter.bills <= 0 ? null : sum / quarter.bills * 100,
    ageDays: Math.floor((Date.parse(asOf) - Date.parse(quarter.date)) / 86400000),
    rows: ownershipGroups.map(g => ({ ...g, value: quarter.groups[g.id],
      share: quarter.groups[g.id] / quarter.total * 100,
      delta: previous ? quarter.groups[g.id] - previous.groups[g.id] : null })),
  };
}
