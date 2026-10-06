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
  portfolio?: { total: number; components: Partial<Record<string, number>> };
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

export function ownershipInsights(data: OwnershipData, asOf: string) {
  const view = ownershipView(data, asOf);
  if (!view) return { owners: [] as string[], issuers: {} as Record<string, string> };
  const { quarter, previous } = view;
  const owners: string[] = [];
  const year = data.ownership.find(q => q.date === `${Number(quarter.date.slice(0, 4)) - 1}${quarter.date.slice(4)}`);
  if (year && quarter.total > 0 && year.total > 0) {
    const changes = ownershipGroups.map(g => ({ ...g, delta: quarter.groups[g.id] - year.groups[g.id] })).filter(g => Number.isFinite(g.delta)).sort((a,b) => b.delta-a.delta);
    const lead = changes[0], total = quarter.total-year.total;
    if (lead && lead.delta>0) owners.push(`지난 1년 보유액이 가장 많이 늘어난 주체는 ${lead.label}입니다.${total>0 ? ` 전체 보유액 순증가분 대비 약 ${(lead.delta/total*100).toFixed(1)}% 규모입니다.` : ''} 보유액에는 평가 변화도 반영되므로 같은 금액의 신규 국채를 매입했다는 뜻은 아닙니다.`);
    const value = quarter.groups.foreign-year.groups.foreign, share = quarter.groups.foreign/quarter.total-year.groups.foreign/year.total;
    owners.push(`해외 투자자의 보유액은 1년 전보다 ${value>0?'늘었고':value<0?'줄었고':'같고'}, 전체에서 차지하는 비중은 ${share>0?'높아졌습니다':share<0?'낮아졌습니다':'같습니다'}. 보유액과 비중은 서로 다른 정보입니다.`);
  }
  if (previous) {
    const mmf=quarter.groups.mmf-previous.groups.mmf, bills=quarter.bills-previous.bills;
    owners.push(`최근 분기 단기채 잔액은 ${bills>0?'늘었고':bills<0?'줄었고':'같고'}, MMF의 국채 보유는 ${mmf>0?'늘었습니다':mmf<0?'줄었습니다':'같습니다'}. 두 변화는 함께 볼 단서지만, MMF 보유 전체를 단기채로 간주하거나 개별 매입 경로를 확정하지는 않습니다.`);
  }
  const issuers:Record<string,string>={};
  for (const item of view.issuers) {
    const h=item.holding;
    if (!h) continue;
    const portfolio=h.portfolio, repo=portfolio?.components.overnight_repo;
    issuers[item.id]=`${h.date} 기준 국채 보유는 ${item.delta==null?'직전 분기 비교 자료가 없습니다':item.delta>0?'전분기보다 늘었습니다':item.delta<0?'전분기보다 줄었습니다':'전분기와 같습니다'}.${portfolio&&repo!=null&&portfolio.total>0?` 준비자산 중 국채 담보 역레포·익일물은 ${(repo/portfolio.total*100).toFixed(1)}%입니다. 국채 보유와 담보를 받고 현금을 빌려주는 거래를 구분해서 봅니다.`:''}`;
  }
  return {owners,issuers};
}
