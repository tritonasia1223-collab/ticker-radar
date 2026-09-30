import type { Obs } from "./liquidity-beta.js";

// GDP는 FRED GDP: 명목·계절조정 연율, 금액은 지준과 같은 백만 달러로 변환된 값.
// FRED 날짜는 분기 첫날이므로 종료일로 비교해야 진행 중인 분기 전체 값을 끌어오지 않는다.
// 공시 당시 빈티지가 아니라 관측 기간 기준의 사후 수정치를 쓰는 페이지 정책을 따른다.
export function reservesGdp(reserves: number, asOf: string, observations: Obs[]) {
  if (!Number.isFinite(reserves) || reserves < 0 || !Number.isFinite(Date.parse(asOf))) return null;
  const rows = observations.filter(o => /^\d{4}-(01|04|07|10)-01$/.test(o.date)).map(o => {
    const year = Number(o.date.slice(0, 4)), month = Number(o.date.slice(5, 7));
    return { ...o, end: new Date(Date.UTC(year, month + 2, 0)).toISOString().slice(0, 10), quarter: `${year}년 ${Math.ceil(month / 3)}분기` };
  }).filter(o => o.end <= asOf).sort((a, b) => b.end.localeCompare(a.end));
  const gdp = rows[0];
  // 두 분기 넘게 갱신되지 않은 분모를 현재 비율처럼 표시하지 않는다.
  if (!gdp || !Number.isFinite(gdp.value) || gdp.value <= 0 || Date.parse(asOf) - Date.parse(gdp.end) > 183 * 86_400_000) return null;
  return { pct: reserves / gdp.value * 100, gdp: gdp.value, quarter: gdp.quarter, periodEnd: gdp.end };
}
