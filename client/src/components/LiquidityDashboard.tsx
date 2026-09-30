import type { ReactNode } from "react";
import { BIDDER_SUBJECT, type HowMuch, type WhereFrom, type WhereTo, type WhoBought, type Stress } from "@shared/liquidity-read";
import { fmt, s1 } from "@shared/liquidity-sentences";

const changeColor = (value: number) => !Number.isFinite(value) || fmt.isZeroEok(value) ? "#5F5C54" : value > 0 ? "#1F7A4D" : "#B3402E";
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
type BalanceRow = { label: string; detail: string; value: number };

function Changes({ rows, maximum }: { rows: BalanceRow[]; maximum: number }) {
  return <div className="mt-5 space-y-4">{rows.map(row => <div key={row.label}>
    <div className="flex items-baseline justify-between gap-3 text-sm"><span className="font-medium">{row.label}</span><strong className="shrink-0 text-lg tabular-nums" style={{ color: changeColor(row.value) }}>{Number.isFinite(row.value) ? fmt.signedEok(row.value) : "—"}</strong></div>
    <div className="mt-1 text-xs text-[#5F5C54]">{row.detail}</div>
    <div className="mt-2 h-1.5 rounded-full bg-[#EAE7DE]"><div className="h-full rounded-full" style={{ width: `${Number.isFinite(row.value) ? Math.abs(row.value) / maximum * 100 : 0}%`, background: changeColor(row.value) }} /></div>
  </div>)}</div>;
}

export function LiquidityDashboard({ how, from, to, who, stress, alerts }: { how: HowMuch | null; from: WhereFrom | null; to: WhereTo | null; who: WhoBought | null; stress: Stress; alerts: ReactNode }) {
  const sources = from?.ranked.map(c => ({
    label: c.key === "rrp" ? "역레포 · MMF 등" : c.key === "fed" ? "연준 자산" : "재무부 · TGA",
    detail: `${c.key === "fed" ? "자산" : "잔고"} ${fmt.isZeroEok(c.own) ? "변화 없음" : c.own > 0 ? "증가" : "감소"}`,
    value: c.effect,
  })) ?? [];
  const destinations = to ? [{ label: "은행 지급준비금", detail: "은행이 연준에 둔 잔액", value: to.dReserves }, { label: "현금통화·기타", detail: "현금통화 및 기타 부채·자본", value: to.dOther }] : [];
  const maximum = Math.max(1, ...[...sources, ...destinations].map(r => Number.isFinite(r.value) ? Math.abs(r.value) : 0));
  const missingStress = stress.rows.filter(r => r.threshold != null && (r.value == null || !Number.isFinite(r.value))).length;
  return <section aria-label="유동성 요약 대시보드" className="mb-8 overflow-hidden rounded-2xl border border-[#D9D5CA] bg-white">
    <div className="p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5F5C54]"><span>순유동성 · {how?.date ?? "관측 없음"}</span>{how && Number.isFinite(how.dNl) && <span>{how.prevDate} → {how.date}</span>}</div>
      <h2 className="mt-4 text-[24px] font-semibold leading-normal sm:text-[28px]" data-testid="liquidity-headline">{how ? s1(how).summary.map((p, i) => <span key={i} style={{ color: p.tone ? changeColor(how.dNl) : undefined }}>{p.text}</span>) : "선택 주차의 유동성 관측이 없습니다."}</h2>
      {how && <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm text-[#5F5C54]"><span>현재 <strong className="text-lg text-[#1A1A18]">${fmt.amount(how.nl)}</strong></span>{Number.isFinite(how.dNlPct) && <span>{how.cmpWeeks}주 변화율 <strong style={{ color: changeColor(how.dNl) }}>{fmt.pct(how.dNlPct)}</strong></span>}</div>}
    </div>
    <div className="grid border-y border-[#D9D5CA] md:grid-cols-2">
      <div className="p-5 sm:p-7">
        <button type="button" onClick={() => jump("s2")} className="flex w-full items-baseline justify-between text-left"><span className="font-semibold">어디서 <span className="ml-2 text-xs font-normal text-[#5F5C54]">유동성 증감 요인</span></span><span aria-hidden="true" className="text-[#8B877D]">↘</span></button>
        {sources.length ? <Changes rows={sources} maximum={maximum} /> : <p className="mt-5 text-sm text-[#5F5C54]">비교 주차 자료 없음</p>}
      </div>
      <div className="border-t border-dashed border-[#B9B4A6] p-5 sm:p-7 md:border-l md:border-t-0">
        <button type="button" onClick={() => jump("s3")} className="flex w-full items-baseline justify-between text-left"><span className="font-semibold">어디로 <span className="ml-2 text-xs font-normal text-[#5F5C54]">잔액 변화</span></span><span aria-hidden="true" className="text-[#8B877D]">↘</span></button>
        {destinations.length ? <Changes rows={destinations} maximum={maximum} /> : <p className="mt-5 text-sm text-[#5F5C54]">비교 주차 자료 없음</p>}
        <p className="mt-5 text-[11px] leading-relaxed text-[#5F5C54]">같은 기간의 회계상 변화 · 개별 자금 이동 경로는 미확인</p>
      </div>
    </div>
    <div className="grid gap-5 p-5 sm:p-7 md:grid-cols-2">
      <button type="button" onClick={() => jump("s4")} className="text-left"><div className="text-xs text-[#5F5C54]">국채 입찰 · 가장 큰 몫</div><div className="mt-2 text-base font-semibold">{who?.top ? BIDDER_SUBJECT[who.top.bidder] : "집계 자료 없음"} {who?.top && <span className="ml-2">${fmt.amount(who.top.value)}</span>}</div>{who && <div className="mt-1 text-xs text-[#5F5C54]">{fmt.dateKo(who.start)}~{fmt.dateKo(who.end)} 결제분</div>}</button>
      <button type="button" onClick={() => jump("s5")} className="text-left"><div className="text-xs text-[#5F5C54]">자금시장</div><div className="mt-2 text-base font-semibold" style={{ color: stress.breached.length ? "#B3402E" : undefined }}>{stress.breached.length ? `경계선 초과 ${stress.breached.length}개` : !stress.evaluated.length || missingStress ? "일부 지표 확인 불가" : "경계선 초과 없음"}</div><div className="mt-1 text-xs text-[#5F5C54]">판정 가능 {stress.evaluated.length}개{missingStress ? ` · 관측 누락 ${missingStress}개` : ""}</div></button>
    </div>
    {alerts}
  </section>;
}
