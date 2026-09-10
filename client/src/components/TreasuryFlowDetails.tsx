import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { fedWaterfall, holdingSegments, treasuryWaterfall, waterfallBars, type TreasuryTransactions, type WaterfallItem } from "@shared/treasury-transactions";

const FED = "#0d9488", OTHER = "#3b82f6", SUPPLY = "#7c3aed", NEGATIVE = "#f97316";
const money = (v: number) => {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a > 0 && a < 1) return `$${(a * 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}만`;
  return a >= 1e6 ? `$${(a / 1e6).toFixed(2)}조` : `$${(a / 100).toLocaleString("ko-KR", { maximumFractionDigits: a < 100 ? 2 : 0 })}억`;
};
const signed = (v: number) => !Number.isFinite(v) ? "—" : `${v < 0 ? "−" : v > 0 ? "+" : ""}${money(v)}`;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    const measure = () => setWidth(Math.max(0, target.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function HoldingsBar({ supply, fed }: { supply: number; fed: number }) {
  const { ref, width } = useWidth();
  const breakdown = holdingSegments(supply, fed);
  if (!breakdown) return <div ref={ref} className="py-5 text-center text-xs text-muted-foreground">선택한 달의 증감 자료가 부족합니다.</div>;
  const { min, max, segments } = breakdown;
  const span = Math.max(max - min, 1), left = min < 0 ? min - span * 0.04 : 0, right = max + span * 0.04;
  const x = (value: number) => 8 + (value - left) / (right - left) * Math.max(width - 16, 1);
  return <div ref={ref} className="min-w-0">
    <svg width="100%" height={92} role="img" aria-label={`순발행 ${signed(supply)}, 연준 보유 ${signed(fed)}, 연준 외 보유 ${signed(supply - fed)}`}>
      {width > 0 && <>
        {segments.map(segment => <g key={segment.key}>
          <rect x={x(Math.min(segment.start, segment.end))} y={24} width={Math.max(0, Math.abs(x(segment.end) - x(segment.start)))} height={25} rx={1} fill={segment.key === "fed" ? FED : OTHER}>
            <title>{segment.key === "fed" ? "연준 보유 증감" : "연준 외 보유 증감(추정)"}: {signed(segment.value)}</title>
          </rect>
          {Math.abs(x(segment.end) - x(segment.start)) > 90 && <text x={(x(segment.start) + x(segment.end)) / 2} y={41} textAnchor="middle" fill="white" fontSize={11}>{signed(segment.value)}</text>}
        </g>)}
        <line x1={x(0)} x2={x(0)} y1={19} y2={56} stroke="currentColor" opacity={0.35} />
        <line x1={x(supply)} x2={x(supply)} y1={15} y2={57} stroke="currentColor" strokeDasharray="3 3" opacity={0.7} />
        <text x={Math.min(width - 8, Math.max(8, x(supply)))} y={11} textAnchor={x(supply) > width * 0.6 ? "end" : "start"} fill="currentColor" fontSize={11}>순발행 {signed(supply)}</text>
        <text x={x(0)} y={70} textAnchor={x(0) < 30 ? "start" : "middle"} fill="currentColor" opacity={0.55} fontSize={10}>0</text>
        <text x={width - 8} y={86} textAnchor="end" fill="currentColor" opacity={0.55} fontSize={10}>달러 · 잔액 증감</text>
      </>}
    </svg>
    {/* Inline legend only. No repeated metric cards beneath the bar. */}
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: FED }} />연준 보유 증감</span>
      <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: OTHER }} />연준 외 보유 증감 · 추정</span>
    </div>
  </div>;
}

function TransactionsWaterfall({ items }: { items: WaterfallItem[] }) {
  const { ref, width } = useWidth();
  const bars = waterfallBars(items);
  const values = bars.flatMap(b => [b.start, b.end, 0]);
  const low = Math.min(...values), high = Math.max(...values), span = Math.max(high - low, 1);
  const min = low < 0 ? low - span * 0.12 : 0, max = high + span * 0.17;
  const height = 245, left = width < 440 ? 48 : 62, right = 10, top = 25, bottom = 65;
  const plotWidth = Math.max(1, width - left - right), step = plotWidth / bars.length, bw = step * 0.55;
  const x = (i: number) => left + step * i + (step - bw) / 2;
  const y = (v: number) => height - bottom - (v - min) / (max - min) * (height - bottom - top);
  const labelLines = (label: string) => label.split(" ");
  return <div ref={ref} className="min-w-0">
    <svg width="100%" height={height} role="img" aria-label={bars.map(b => `${b.label} ${signed(b.value)}${b.estimated ? " (추정·대조)" : ""}`).join(", ")}>
      {width > 0 && <>
        {[0, high / 2, high].filter((v, i, a) => a.indexOf(v) === i).map(tick => <g key={tick}>
          <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="currentColor" opacity={0.1} />
          <text x={left - 6} y={y(tick) + 4} textAnchor="end" fill="currentColor" opacity={0.55} fontSize={10}>{tick === 0 ? "0" : money(tick)}</text>
        </g>)}
        <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="currentColor" opacity={0.25} />
        {bars.map((bar, i) => {
          const upper = y(Math.max(bar.start, bar.end)), lower = y(Math.min(bar.start, bar.end));
          const labelY = upper - (width < 560 && i % 2 ? 21 : 7);
          return <g key={`${bar.label}-${i}`}>
            <rect x={x(i)} y={upper} width={bw} height={Math.max(lower - upper, 1)} rx={1} fill={bar.total ? SUPPLY : bar.estimated ? "#94a3b8" : bar.value < 0 ? NEGATIVE : FED}>
              <title>{bar.label}: {signed(bar.value)}{bar.estimated ? " · 추정 또는 자료 대조 차이" : ""}</title>
            </rect>
            {i < bars.length - 1 && <line x1={x(i) + bw} x2={x(i + 1)} y1={y(bar.end)} y2={y(bar.end)} stroke="currentColor" opacity={0.3} strokeDasharray="3 3" />}
            <text x={x(i) + bw / 2} y={labelY} textAnchor="middle" fill="currentColor" fontSize={width < 440 ? 9 : 11}>{signed(bar.value)}</text>
            <text x={x(i) + bw / 2} y={height - bottom + 20} textAnchor="middle" fill="currentColor" opacity={0.7} fontSize={width < 440 ? 9 : 11}>
              {labelLines(bar.label).map((line, j) => <tspan x={x(i) + bw / 2} dy={j ? 14 : 0} key={j}>{line}</tspan>)}
            </text>
          </g>;
        })}
      </>}
    </svg>
  </div>;
}

export interface FlowAmounts { sup: number; fed: number; res: number }
export function TreasuryFlowDetails({ month, bucketLabel, selected, total }: {
  month: string; bucketLabel: string; selected: FlowAmounts | null; total: FlowAmounts | null;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"treasury" | "fed" | "buybacks">("treasury");
  const enabled = !!total && [total.sup, total.fed].every(Number.isFinite);
  const query = useQuery<TreasuryTransactions>({
    queryKey: ["/api/fed/treasury-transactions", month],
    queryFn: async () => (await apiRequest("GET", `/api/fed/treasury-transactions?month=${encodeURIComponent(month)}`)).json(),
    enabled: open && enabled,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });
  const data = query.data;
  let items: WaterfallItem[] | null = null;
  if (data && total) {
    if (kind === "treasury") items = treasuryWaterfall(data, total.sup);
    else if (kind === "fed") items = fedWaterfall(data, total.fed);
    else if (data.buybacks) {
      const b = data.buybacks;
      items = [{ label: "현금관리", value: b.cashManagement }, { label: "유동성 지원", value: b.liquiditySupport }];
      if (b.other) items.push({ label: "기타 목적", value: b.other });
      items.push({ label: "매입·소각 합계", value: b.total, total: true });
    }
  }
  const tabs = [{ key: "treasury", label: "재무부 발행·소각" }, { key: "fed", label: "연준 매입·보유" }, { key: "buybacks", label: "재무부 바이백" }] as const;
  return <Card className="p-3.5" data-testid="treasury-flow-details">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">국채 증감 분해</h3>
      <span className="text-[11px] text-muted-foreground">{month} · {bucketLabel}</span>
    </div>
    {selected ? <HoldingsBar supply={selected.sup} fed={selected.fed} /> : <div className="py-5 text-center text-xs text-muted-foreground">선택 시점의 증감 자료가 없습니다.</div>}
    <div className="mt-3 border-t border-border/50 pt-2">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left text-xs text-muted-foreground">
        <span>세부 거래 내역 · 워터폴</span><span>{open ? "접기 ▴" : "펼치기 ▾"}</span>
      </button>
      {open && <div className="mt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.map(tab => <button key={tab.key} type="button" aria-pressed={kind === tab.key} onClick={() => setKind(tab.key)} className={`rounded border px-2 py-1 text-[11px] ${kind === tab.key ? "border-foreground/40 bg-muted font-semibold" : "border-border hover:bg-muted/50"}`}>{tab.label}</button>)}
          <span className="ml-auto text-[10px] text-muted-foreground">{month} · 전체 국채 · 액면 기준</span>
        </div>
        {!enabled ? <p className="py-8 text-center text-xs text-muted-foreground">선택 시점의 대조 자료가 없습니다.</p>
          : query.isFetching && !data ? <p className="py-8 text-center text-xs text-muted-foreground" role="status">공식 거래 내역 불러오는 중…</p>
          : items ? <>
            <TransactionsWaterfall items={items} />
            <div className="text-[11px] leading-relaxed text-muted-foreground">
              {kind === "treasury" && <>발행·상환: DTS {data?.treasury?.asOf}. 상환액에 포함된 바이백을 한 번만 분리합니다. 회색 막대는 기존 MSPD 잔액 증감과의 자료 간 차이입니다.</>}
              {kind === "fed" && <>실행액은 달력 월 결제일 기준입니다. 만기도래는 직전 수요일 SOMA 종목별 보유로 추정하며, 기존 그래프의 마지막 수요일 보유 증감과 남는 차이를 회색으로 표시합니다. RMP·재투자 목적별 계획과 실제 매입액은 구분합니다.</>}
              {kind === "buybacks" && <>총 {data?.buybacks?.count}건의 실제 낙찰·결제액입니다. 발표 한도액을 사용하지 않으며, 재무부 발행·소각에 이미 포함된 금액입니다.</>}
            </div>
          </> : <div className="py-8 text-center text-xs text-muted-foreground">{query.isError ? "공식 거래 자료를 불러오지 못했습니다." : data?.errors[kind] ?? "자료가 불완전해 거래 내역을 분해할 수 없습니다."}</div>}
        {enabled && (query.isError || (data && Object.keys(data.errors).length > 0) || (!items && !query.isFetching)) && <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="mt-2 rounded border px-2 py-1 text-xs disabled:opacity-50">{query.isFetching ? "확인 중…" : "다시 불러오기"}</button>}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <a className="underline" href="https://fiscaldata.treasury.gov/datasets/daily-treasury-statement/public-debt-transactions" target="_blank" rel="noreferrer">재무부 발행·상환</a>
          <a className="underline" href="https://www.newyorkfed.org/markets/desk-operations/treasury-securities" target="_blank" rel="noreferrer">연준 국채 거래</a>
          <a className="underline" href="https://www.treasurydirect.gov/auctions/announcements-data-results/buy-backs/" target="_blank" rel="noreferrer">재무부 바이백</a>
        </div>
      </div>}
    </div>
  </Card>;
}
