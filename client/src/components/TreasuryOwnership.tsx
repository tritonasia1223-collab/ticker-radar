import { useState } from "react";
import dataset from "@shared/treasury-ownership-data.json";
import { ownershipView, type OwnershipData } from "@shared/treasury-ownership";

const COLORS = { circle: "#477FA3", tether: "#568C82" };
const NAMES = { circle: "서클", tether: "테더" };
const money = (v: number) => v >= 1e6 ? `$${(v / 1e6).toFixed(2)}조` : `$${(v / 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억`;
const delta = (v: number | null) => v === null ? "비교 자료 없음" : `${v < 0 ? "−" : v > 0 ? "+" : ""}${money(Math.abs(v))}`;
const pct = (v: number) => `${v.toFixed(2)}%`;
const data: OwnershipData = dataset;

export function TreasuryOwnership({ asOf }: { asOf: string }) {
  const [detail, setDetail] = useState(false);
  const view = ownershipView(data, asOf);
  if (!view) return <div className="text-sm text-[#5F5C54]">선택한 주차 이전의 국채 보유 자료가 없습니다. 수집 범위: 2010년 이후.</div>;
  const { quarter, rows, issuers, sum, share, billShare } = view;
  const circle = issuers[0].holding?.treasuries ?? 0;
  const tether = issuers[1].holding?.treasuries ?? 0;
  // 좁은 화면에서도 이름을 생략하거나 실제 구성비를 늘리지 않고 가로로 확인한다.
  const ownershipBarWidth = Math.max(640, ...rows.filter(r => r.share > 0).map(r =>
    Math.ceil((Math.max(...r.label.split(/[ ·]/).map(part => part.length)) * 11 + 2) / (r.share / 100))));
  return <div data-testid="treasury-ownership" className="overflow-hidden rounded-2xl border border-[#D9D5CA] bg-white text-[#1A1A18]">
    <div className="p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-lg font-semibold">쌓인 국채는 누가 들고 있나</h3><p className="mt-1 text-xs leading-relaxed text-[#5F5C54]">{quarter.date} 보유 기준 · 분기 자료 · 선택 주차 {asOf}</p></div>
        <div className="sm:text-right"><div className="text-xs text-[#5F5C54]">보유자 잔액 합계</div><div className="text-2xl font-semibold tabular-nums">{money(quarter.total)}</div></div>
      </div>
      <div className="mt-5 overflow-x-auto">
        <div data-testid="ownership-bar" className="flex h-14 w-full overflow-hidden rounded-md" style={{ minWidth: ownershipBarWidth }} role="img" aria-label={rows.map(r => `${r.label} ${money(r.value)}, ${pct(r.share)}`).join(". ")}>
          {rows.map(r => <div key={r.id} style={{ width: `${r.share}%`, background: r.color, color: ["households", "funds", "pensions", "other"].includes(r.id) ? "#242824" : "#FFFFFF" }} className="flex shrink-0 items-center justify-center text-center text-[11px] font-medium leading-[1.5]">
            <span>{r.label.split(/[ ·]/).map((part, index) => <span key={index} className="block whitespace-nowrap">{part}</span>)}</span>
          </div>)}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {rows.map(r => <div key={r.id} className="flex items-center gap-1.5 text-[11px] sm:text-xs"><i className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.color }} /><span>{r.label}</span><span className="ml-auto text-[#5F5C54] tabular-nums">{r.share.toFixed(1)}%</span></div>)}
      </div>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">스테이블코인 발행사 · 서클 + 테더</span>
        <span className="text-[#5F5C54]">{share !== null ? <>전체 보유액의 약 <b className="text-[#1A1A18]">{pct(share)}</b></> : "같은 분기의 두 회사 자료 대기"}</span>
      </div>
      <div className="relative mt-6 h-4 rounded-sm bg-[#F0EEE7]" style={{ containerType: "inline-size" }} role="img" aria-label={share === null ? "두 회사 합계 미산출" : `서클과 테더 합계 ${pct(share)}. 원형 렌즈 안은 시각적으로 확대된 부분입니다.`}>
        {sum !== null && <div className="flex h-full"><div style={{ width: `${circle / quarter.total * 100}%`, background: COLORS.circle }} /><div style={{ width: `${tether / quarter.total * 100}%`, background: COLORS.tether }} /></div>}
        {sum !== null && sum > 0 && <div aria-hidden="true" data-testid="holding-lens" className="pointer-events-none absolute -top-3 h-10 w-10 rounded-full" style={{ left: `calc(${(share ?? 0) / 2}% - 20px)`, boxShadow: "0 2px 5px #416F6820, 0 0 0 2px #FFFFFF" }}>
          <div className="absolute inset-0 overflow-hidden rounded-full bg-white">
            {/* 원래 막대를 같은 중심에서 확대하고 렌즈 가장자리로 잘라낸다. */}
            <div className="absolute top-3 flex h-4 bg-[#F0EEE7]" style={{ width: "100cqw", left: `calc(20px - ${(share ?? 0) / 2}cqw)`, transform: "scale(2, 1.15)", transformOrigin: `${(share ?? 0) / 2}% 50%` }}>
              <div style={{ width: `${circle / quarter.total * 100}%`, background: COLORS.circle }} /><div style={{ width: `${tether / quarter.total * 100}%`, background: COLORS.tether }} />
            </div>
            <div className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(ellipse at 28% 18%, #FFFFFF90 0%, #FFFFFF18 36%, transparent 58%, #416F6820 100%)", boxShadow: "inset 0 0 5px #416F6825" }} />
          </div>
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="19" stroke="#638C85" strokeWidth="1.5" />
            <path d="M8 14 A14 14 0 0 1 22 6" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity=".85" />
          </svg>
        </div>}
      </div>
      <div className="relative h-12" aria-hidden="true">
        {sum !== null && sum > 0 && <svg className="absolute inset-0 h-full w-full" fill="none" stroke="#A9BAB6" strokeWidth="1" strokeDasharray="3 3"><line x1={`${(share ?? 0) / 2}%`} y1="13" x2="0" y2="48" /><line x1={`${(share ?? 0) / 2}%`} y1="13" x2="100%" y2="48" /></svg>}
        <span className="absolute left-1/2 top-5 -translate-x-1/2 bg-white px-3 text-[11px] text-[#5F5C54] whitespace-nowrap">작은 보유분을 아래에서 확대</span>
      </div>
      <div className="rounded-xl border border-[#C8D7D3] bg-[#F4F8F7] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h4 className="text-sm font-semibold">스테이블코인 발행사 보유 · 확대</h4><p className="mt-1 text-[11px] text-[#5F5C54]">공시 기반 집계 · 직접 국채 + 전용 펀드 내 국채 · 레포 제외</p></div>
          <div className="text-right"><strong className="text-xl tabular-nums">{sum === null ? "—" : money(sum)}</strong><div className="text-[11px] text-[#5F5C54]">두 회사 합계 · 전체 발행사 합계 아님</div></div>
        </div>
        <div className="mt-5 mb-2 text-[11px] text-[#5F5C54]">두 회사 합계 = 100% · {quarter.date} 기준</div>
        <div className="flex h-10 overflow-hidden rounded-md bg-[#E5EDEB]" role="img" aria-label={sum !== null && sum > 0 ? `두 회사 합계 기준 서클 ${pct(circle / sum * 100)}, 테더 ${pct(tether / sum * 100)}` : "두 회사 구성비를 계산할 자료가 없습니다"}>
          {sum !== null && sum > 0 && issuers.map(item => <div key={item.id} className="h-full" style={{ width: `${item.holding!.treasuries / sum * 100}%`, background: COLORS[item.id] }} />)}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4">
          {issuers.map(item => {
            const holding = item.holding;
            return <div key={item.id} data-testid={`holding-${item.id}`}>
              <div className="flex items-center gap-1.5 text-xs"><i className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: COLORS[item.id] }} /><strong>{NAMES[item.id]}</strong><span className="text-[#5F5C54] tabular-nums">{sum !== null && sum > 0 && holding ? pct(holding.treasuries / sum * 100) : "—"}</span></div>
              <div className="mt-1 font-semibold text-sm tabular-nums">{holding ? money(holding.treasuries) : "해당 분기 자료 없음"}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-[#5F5C54]">{item.id === "circle" ? "전용 펀드 포함" : "직접 보유"}<br />전분기 {delta(item.delta)}</div>
            </div>;
          })}
        </div>
        {billShare !== null && <p className="mt-4 border-t border-[#D5E0DC] pt-3 text-xs leading-relaxed">단기채 발행 잔액과 비교하면 약 <strong>{pct(billShare)}</strong> 규모입니다. <span className="text-[#5F5C54]">분모 {money(quarter.bills)} · 공시 평가액 / 단기채 액면 잔액의 근사 비율</span></p>}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[#5F5C54]">확대 영역은 위 보유 주체에 걸쳐 있는 참고치로, 전체 합계에 다시 더하지 않습니다. 입찰 낙찰액이나 신규 매입액을 뜻하지 않습니다.</p>
      {view.ageDays > 190 && <p className="mt-2 text-xs text-[#8C6A4F]">선택 주차보다 {view.ageDays}일 이전의 자료입니다. 최신 분기 공시를 추가 수집해야 합니다.</p>}
      <button type="button" onClick={() => setDetail(v => !v)} aria-expanded={detail} className="mt-4 border-b border-[#8B877D] pb-1 text-xs">{detail ? "보유액·집계 근거 접기 ▴" : "보유액·집계 근거 펼치기 ▾"}</button>
      {detail && <div className="mt-4 space-y-4 text-xs leading-relaxed text-[#5F5C54]">
        <div className="overflow-x-auto"><table className="w-full min-w-[320px] text-left tabular-nums"><thead><tr className="border-b border-[#D9D5CA]"><th className="pb-2 font-medium">주체</th><th className="text-right font-medium">보유액</th><th className="text-right font-medium">전분기 증감</th></tr></thead><tbody>{rows.map(r => <tr key={r.id} className="border-b border-[#E8E5DC]"><td className="py-2">{r.label}</td><td className="text-right">{money(r.value)}</td><td className="text-right">{delta(r.delta)}</td></tr>)}</tbody></table></div>
        <p>기타에는 지방정부·기업·증권사·국내 헤지펀드 등이 포함됩니다. 국내 헤지펀드 {money(quarter.domesticHedgeFunds)}는 기타의 일부이며, 해외 소재 헤지펀드는 해외 부문에 포함됩니다.</p>
        <p>시장성 국채 발행 잔액은 {money(quarter.outstanding)}입니다. 위 구성비는 연준 Z.1의 보유자 자산 합계를 분모로 사용합니다. 평가 기준 및 통계상 차이로 발행 잔액과 일치하지 않습니다.</p>
        {issuers.map(item => <div key={item.id}>
          <b>{NAMES[item.id]}</b>: {item.holding ? <>{item.id === "circle" ? `전용 펀드 ${money(item.holding.fund ?? 0)} + 별도 계정 ${money(item.holding.direct ?? 0)}` : "공시의 U.S. Treasury Bills 항목만 집계"}. {item.holding.publishedAt ? `공시일 ${item.holding.publishedAt}. ` : ""}</> : "해당 분기 공시 미수집. "}
          {item.latest && item.latest.date > quarter.date && <>선택 주차 이전의 더 최근 보유 관측: {item.latest.date} {money(item.latest.treasuries)}{item.latest.publishedAt ? ` (공시 ${item.latest.publishedAt})` : ""}. 전체 구성과 기준일을 맞추기 위해 위 막대에는 같은 분기 값을 사용합니다. </>}
          {item.holding && <a className="underline" href={item.holding.source} target="_blank" rel="noreferrer">공시 원문</a>}
        </div>)}
        <p>서클은 월별 공시, 테더는 분기별 공시를 수집합니다. 블랙록 일간 종목 매칭에 의한 매입 추산은 이 보유액 그래프에 사용하지 않습니다. 테더의 간접 보유분은 구성 확인이 안 된 경우 제외합니다.</p>
        <p>상단 주차까지의 관측일 기준으로 선택하며, 이후 공시·수정된 과거 수치도 반영합니다. 주간 보간은 하지 않습니다. 발행사 수집 범위: 2025년 이후. 자료 수집일 {data.collectedAt.slice(0, 10)} · <a className="underline" href={data.ownershipSource} target="_blank" rel="noreferrer">연준 Z.1</a></p>
      </div>}
    </div>
  </div>;
}
