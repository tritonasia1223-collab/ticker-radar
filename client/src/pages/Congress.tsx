import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Politician, Committee, Trade, TickerAgg, SortMetric,
  aggregate, rankList, tradersOf, quarterSeries, sortedQuarters, quarterOf,
  SECTOR, koSector, koCompany, tickerColor, partyColor, fmtMoney, fmtQ, cmtLabel,
} from "@/lib/congress";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip as RTooltip,
} from "recharts";
import { Landmark, ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";

const BUY = "#3fb950";
const SELL = "#f85149";

// ---------- shared small UI ----------
function Sparkline({ perQ, quarters }: { perQ: Map<string, { buy: number; sell: number }>; quarters: string[] }) {
  const W = 72, H = 26;
  let cum = 0;
  const pts = quarters.map((q) => { const e = perQ.get(q); cum += (e?.buy ?? 0) - (e?.sell ?? 0); return cum; });
  const min = Math.min(0, ...pts), max = Math.max(0, ...pts);
  const span = max - min || 1;
  const last = pts[pts.length - 1] ?? 0;
  const coords = pts.map((p, i) => {
    const x = quarters.length <= 1 ? W - 3 : 3 + (i / (quarters.length - 1)) * (W - 6);
    const y = H - 3 - ((p - min) / span) * (H - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={W} height={H} className="overflow-visible">
      {coords.length > 1 && <polyline points={coords.join(" ")} fill="none" stroke={last >= 0 ? BUY : SELL} strokeWidth={1.6} />}
      {coords.length > 0 && (() => { const [x, y] = coords[coords.length - 1].split(","); return <circle cx={x} cy={y} r={2} fill={last >= 0 ? BUY : SELL} />; })()}
    </svg>
  );
}

function StackedBar({ s, maxVol }: { s: TickerAgg; maxVol: number }) {
  const w = Math.max((s.vol / maxVol) * 100, 6);
  return (
    <div className="h-[18px] rounded bg-background/60 overflow-hidden flex" style={{ width: `${w}%` }}>
      <div style={{ width: `${s.vol ? (s.buy / s.vol) * 100 : 0}%`, background: BUY }} />
      <div style={{ width: `${s.vol ? (s.sell / s.vol) * 100 : 0}%`, background: SELL }} />
    </div>
  );
}

function TrendTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const raw = payload[0]?.payload?.raw;
  if (!raw) return null;
  const list = (arr: [string, number][]) => (arr.length ? arr.map(([k, v]) => `${k} ${fmtMoney(v)}`).join(", ") : "—");
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow max-w-[260px]">
      <div className="font-medium mb-1">{raw.label}</div>
      <div style={{ color: BUY }}>매수 {fmtMoney(raw.buy)}</div>
      <div className="text-muted-foreground">{list(raw.buyers)}</div>
      {raw.sell > 0 && (<>
        <div style={{ color: SELL }} className="mt-1">매도 {fmtMoney(raw.sell)}</div>
        <div className="text-muted-foreground">{list(raw.sellers)}</div>
      </>)}
    </div>
  );
}

function TrendChart({ trades, quarters, groupBy, nameOf }: {
  trades: Trade[]; quarters: string[]; groupBy: "member" | "ticker"; nameOf: (slug: string) => string;
}) {
  const series = quarterSeries(trades, quarters, groupBy, nameOf);
  const data = series.map((s) => ({ label: s.label, buy: s.buy, sellNeg: -s.sell, cum: s.cum, raw: s }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => fmtMoney(v)} width={46} />
        <ReferenceLine y={0} stroke="hsl(var(--border))" />
        <RTooltip content={<TrendTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
        <Bar dataKey="buy" fill={BUY} radius={[3, 3, 0, 0]} />
        <Bar dataKey="sellNeg" fill={SELL} radius={[0, 0, 3, 3]} />
        <Line dataKey="cum" stroke="hsl(var(--foreground))" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="3 2" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function PartyPill({ p, state }: { p: string | null; state?: string | null }) {
  const bg = p === "D" ? "bg-blue-500/15 text-blue-400" : p === "R" ? "bg-red-500/15 text-red-400" : "bg-muted text-muted-foreground";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${bg}`}>{p ?? "?"}{state ? `-${state}` : ""}</span>;
}

// ---------- context passed to views ----------
interface Ctx {
  polBySlug: Map<string, Politician>;
  cmtById: Map<string, Committee>;
  quarters: string[];
  sectorOf: (sym: string) => string;
  openMember: (slug: string) => void;
  openTicker: (sym: string) => void;
}

// member rows inside a buy/sell box: 상원 먼저 → 하원, each member once, committee tags, clickable
function MemberSideBox({ side, entries, ctx }: { side: "buy" | "sell"; entries: Map<string, number>; ctx: Ctx }) {
  const rows = [...entries.entries()].sort((a, b) => {
    const ca = ctx.polBySlug.get(a[0])?.chamber, cb = ctx.polBySlug.get(b[0])?.chamber;
    if (ca !== cb) return ca === "senate" ? -1 : 1;
    return b[1] - a[1];
  });
  const color = side === "buy" ? BUY : SELL;
  let lastChamber: string | null = null;
  return (
    <div className="rounded-lg border bg-background/50 p-2.5" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="text-xs font-bold mb-1.5" style={{ color }}>
        {side === "buy" ? "🟢 매수한 의원" : "🔴 매도한 의원"} ({entries.size})
      </div>
      {rows.length === 0 && <div className="text-xs text-muted-foreground">없음</div>}
      {rows.map(([slug, amt]) => {
        const p = ctx.polBySlug.get(slug);
        if (!p) return null;
        const divider = p.chamber !== lastChamber ? (lastChamber = p.chamber, p.chamber) : null;
        return (
          <div key={slug}>
            {divider && <div className="text-[10.5px] font-bold tracking-wide text-muted-foreground mt-2 mb-1">{divider === "senate" ? "상원 (Senate)" : "하원 (House)"}</div>}
            <div className="py-1.5 border-b border-border/50 last:border-0 cursor-pointer rounded hover:bg-muted/40 px-1" onClick={() => ctx.openMember(slug)} title={`${p.name} 개인 페이지`}>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: partyColor(p.party) }} />
                <span className="font-semibold text-[13px]">{p.name}</span>
                <PartyPill p={p.party} state={p.state} />
                <ChevronRight className="h-3 w-3 text-primary" />
                <span className="ml-auto text-[12.5px] font-bold tabular-nums" style={{ color }}>{side === "buy" ? "+" : "−"}{fmtMoney(amt)}</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1 ml-3.5">
                {(p.committees.length ? p.committees : ["__none__"]).map((cid) => (
                  <span key={cid} className="text-[10px] text-muted-foreground bg-background border rounded px-1.5 py-0.5">
                    {cid === "__none__" ? "무소속·지도부" : cmtLabel(ctx.cmtById.get(cid))}
                  </span>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return <div><div className="text-lg font-bold tabular-nums" style={color ? { color } : undefined}>{value}</div><div className="text-[11px] text-muted-foreground">{label}</div></div>;
}

function RankRow({ s, idx, maxVol, quarters, selected, onClick, ctx, showTradeCount }: {
  s: TickerAgg; idx: number; maxVol: number; quarters: string[]; selected?: boolean; onClick?: () => void; ctx: Ctx; showTradeCount?: boolean;
}) {
  return (
    <div className={`grid items-center gap-2.5 px-2 py-2 rounded-lg border ${selected ? "border-primary bg-muted/40" : "border-transparent hover:bg-muted/30"} ${onClick ? "cursor-pointer" : ""}`}
      style={{ gridTemplateColumns: "24px 92px 1fr 92px 52px 76px" }} onClick={onClick}
      title={`${s.symbol} · 매수 ${s.buyers.size}명 / 매도 ${s.sellers.size}명`}>
      <div className="text-xs text-muted-foreground text-center tabular-nums">{idx + 1}</div>
      <div className="flex items-center gap-1.5 font-bold text-sm">
        <span className="h-2.5 w-2.5 rounded" style={{ background: tickerColor(s.symbol) }} />
        {s.symbol}<span className="text-[10px] font-normal text-muted-foreground">{ctx.sectorOf(s.symbol)}</span>
      </div>
      <StackedBar s={s} maxVol={maxVol} />
      <div className="text-right text-[12.5px] font-bold tabular-nums" style={{ color: s.net >= 0 ? BUY : SELL }}>{s.net >= 0 ? "+" : "−"}{fmtMoney(Math.abs(s.net))}</div>
      <div className="text-center text-xs text-muted-foreground tabular-nums">{showTradeCount ? `${s.trades.length}건` : `${tradersOf(s)}명`}</div>
      <div className="flex justify-center"><Sparkline perQ={s.perQ} quarters={quarters} /></div>
    </div>
  );
}

function RankHead() {
  return (
    <div className="grid items-center gap-2.5 px-2 py-1.5 text-[11px] text-muted-foreground border-b" style={{ gridTemplateColumns: "24px 92px 1fr 92px 52px 76px" }}>
      <div className="text-center">#</div><div>종목</div><div>매수/매도</div><div className="text-right">순매수</div><div className="text-center">거래자</div><div className="text-center">추이</div>
    </div>
  );
}

// ---------- ticker detail ----------
function TickerDetail({ agg, quarters, ctx }: { agg: TickerAgg; quarters: string[]; ctx: Ctx }) {
  const nameOf = (slug: string) => ctx.polBySlug.get(slug)?.name ?? slug;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="h-3.5 w-3.5 rounded" style={{ background: tickerColor(agg.symbol) }} />
        <span className="text-2xl font-bold">{agg.symbol}</span>
        <span className="text-xs text-muted-foreground">{ctx.sectorOf(agg.symbol)}{agg.company ? ` · ${agg.company}` : ""}{koCompany(agg.symbol) ? ` (${koCompany(agg.symbol)})` : ""}</span>
      </div>
      <div className="flex gap-5 my-3 flex-wrap">
        <Kpi label="총 매수" value={fmtMoney(agg.buy)} color={BUY} />
        <Kpi label="총 매도" value={fmtMoney(agg.sell)} color={SELL} />
        <Kpi label="순매수" value={`${agg.net >= 0 ? "+" : "−"}${fmtMoney(Math.abs(agg.net))}`} color={agg.net >= 0 ? BUY : SELL} />
        <Kpi label="거래 의원" value={`${tradersOf(agg)}명`} />
      </div>
      <TrendChart trades={agg.trades} quarters={quarters} groupBy="member" nameOf={nameOf} />
      <div className="grid gap-3 mt-3">
        <MemberSideBox side="buy" entries={agg.buyers} ctx={ctx} />
        <MemberSideBox side="sell" entries={agg.sellers} ctx={ctx} />
      </div>
    </div>
  );
}

// ---------- committee view ----------
function CommitteeCards({ committees, trades, ctx, onPick, search }: {
  committees: Committee[]; trades: Trade[]; ctx: Ctx; onPick: (id: string) => void; search: string;
}) {
  const membersOf = (cid: string) => [...ctx.polBySlug.values()].filter((p) => p.committees.includes(cid));
  const q = search.trim().toLowerCase();
  // 거래 있는 위원회만 → 검색 필터 → 거래 건수(많은 순) · 의원 수(많은 순) 정렬
  const list = committees
    .map((c) => {
      const memSlugs = new Set(membersOf(c.id).map((p) => p.slug));
      const ts = trades.filter((t) => memSlugs.has(t.slug));
      return { c, memCount: memSlugs.size, ts };
    })
    .filter((x) => x.ts.length > 0)
    .filter((x) => !q || cmtLabel(x.c).toLowerCase().includes(q))
    .sort((a, b) => b.ts.length - a.ts.length || b.memCount - a.memCount);

  if (list.length === 0) return <div className="text-sm text-muted-foreground py-8 text-center">검색 결과가 없습니다</div>;
  return (
    <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
      {list.map(({ c, memCount, ts }) => {
        const top = rankList([...aggregate(ts).values()], "vol")[0];
        return (
          <Card key={c.id} className="p-4 cursor-pointer hover:border-primary transition-colors" onClick={() => onPick(c.id)}>
            <div className="font-semibold text-sm mb-2">{cmtLabel(c)}</div>
            <div className="flex gap-3.5 text-[11.5px] text-muted-foreground">
              <span>거래 <b className="text-foreground">{ts.length}</b></span>
              <span>의원 <b className="text-foreground">{memCount}</b></span>
            </div>
            {top && <div className="text-[11.5px] text-muted-foreground mt-2">최다 거래: <b style={{ color: tickerColor(top.symbol) }}>{top.symbol}</b> ({ctx.sectorOf(top.symbol)})</div>}
          </Card>
        );
      })}
    </div>
  );
}

function CommitteeDetail({ committee, trades, quarters, periodLabel, ctx, onBack }: {
  committee: Committee; trades: Trade[]; quarters: string[]; periodLabel: string; ctx: Ctx; onBack: () => void;
}) {
  const memSlugs = new Set([...ctx.polBySlug.values()].filter((p) => p.committees.includes(committee.id)).map((p) => p.slug));
  const ts = trades.filter((t) => memSlugs.has(t.slug));
  const ranked = rankList([...aggregate(ts).values()], "vol");
  const maxVol = Math.max(1, ...ranked.map((s) => s.vol));
  const nameOf = (slug: string) => ctx.polBySlug.get(slug)?.name ?? slug;
  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-3 text-primary" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />위원회 목록</Button>
      <Card className="p-5 mb-4">
        <h2 className="text-base font-semibold">{cmtLabel(committee)}</h2>
        <p className="text-[11.5px] text-muted-foreground mt-1 mb-3">집계 기간 <b>{periodLabel}</b> · 소속 의원 {memSlugs.size}명의 거래 {ts.length}건. 막대=분기 매수/매도, 점선=누적 순매수.</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {[...memSlugs].map((slug) => { const p = ctx.polBySlug.get(slug)!; return (
            <span key={slug} className="flex items-center gap-1.5 text-xs border rounded-full pl-2 pr-2.5 py-1 cursor-pointer hover:border-primary" onClick={() => ctx.openMember(slug)}>
              <span className="h-2 w-2 rounded-full" style={{ background: partyColor(p.party) }} />{p.name}<PartyPill p={p.party} state={p.state} /><ChevronRight className="h-3 w-3 text-primary" />
            </span>); })}
        </div>
        <div className="max-w-[620px]"><TrendChart trades={ts} quarters={quarters} groupBy="member" nameOf={nameOf} /></div>
      </Card>
      <Card className="p-5">
        <h2 className="text-base font-semibold mb-1">이 위원회의 종목 매매 랭킹 <span className="text-xs font-normal text-muted-foreground">· 집계 기간 {periodLabel}</span></h2>
        <p className="text-[11.5px] text-muted-foreground mb-3">소속 의원들이 가장 많이 거래한 종목. 방산위라면 방산주가 상위에 오릅니다.</p>
        <RankHead />
        {ranked.map((s, i) => <RankRow key={s.symbol} s={s} idx={i} maxVol={maxVol} quarters={quarters} ctx={ctx} onClick={() => ctx.openTicker(s.symbol)} />)}
      </Card>
    </div>
  );
}

// ---------- member detail ----------
function MemberDetail({ slug, trades, quarters, periodLabel, ctx, onBack }: {
  slug: string; trades: Trade[]; quarters: string[]; periodLabel: string; ctx: Ctx; onBack: () => void;
}) {
  const p = ctx.polBySlug.get(slug);
  const ts = trades.filter((t) => t.slug === slug);
  const aggMap = aggregate(ts);
  const ranked = rankList([...aggMap.values()], "vol");
  const maxVol = Math.max(1, ...ranked.map((s) => s.vol));
  let totBuy = 0, totSell = 0;
  for (const t of ts) { const v = t.amountLow == null ? 0 : Math.round((t.amountLow + (t.amountHigh ?? t.amountLow)) / 2); if (t.side === "sell") totSell += v; else totBuy += v; }
  const net = totBuy - totSell;
  if (!p) return null;
  return (
    <div>
      <Button className="mb-4 font-bold shadow-lg" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1.5" />뒤로</Button>
      <Card className="p-5 mb-4">
        <div className="text-xl font-bold flex items-center gap-2">{p.name}<PartyPill p={p.party} state={p.state} /></div>
        <div className="text-xs text-muted-foreground mt-0.5">{p.chamber === "senate" ? "상원 (Senate)" : "하원 (House)"} · 집계기간 {periodLabel}</div>
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {(p.committees.length ? p.committees : ["__none__"]).map((cid) => (
            <span key={cid} className="text-[10.5px] text-muted-foreground bg-background border rounded px-1.5 py-0.5">{cid === "__none__" ? "무소속·지도부" : cmtLabel(ctx.cmtById.get(cid))}</span>
          ))}
        </div>
        <div className="flex gap-5 mt-3.5 flex-wrap">
          <Kpi label="총 매수" value={fmtMoney(totBuy)} color={BUY} />
          <Kpi label="총 매도" value={fmtMoney(totSell)} color={SELL} />
          <Kpi label="순매수" value={`${net >= 0 ? "+" : "−"}${fmtMoney(Math.abs(net))}`} color={net >= 0 ? BUY : SELL} />
          <Kpi label="거래 종목" value={`${aggMap.size}`} />
          <Kpi label="거래 건수" value={`${ts.length}`} />
        </div>
      </Card>
      <div className="grid gap-4 mb-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-base font-semibold">포트폴리오 변동 추이</h2>
          <p className="text-[11.5px] text-muted-foreground mb-2">분기별 매수/매도 + 누적 순매수. 막대에 마우스를 올리면 종목별 내역.</p>
          <TrendChart trades={ts} quarters={quarters} groupBy="ticker" nameOf={(s) => s} />
        </Card>
        <Card className="p-5">
          <h2 className="text-base font-semibold">종목별 거래</h2>
          <p className="text-[11.5px] text-muted-foreground mb-2">총 거래액 순. 행 클릭 시 종목 상세로 이동.</p>
          <RankHead />
          {ranked.map((s, i) => <RankRow key={s.symbol} s={s} idx={i} maxVol={maxVol} quarters={quarters} ctx={ctx} showTradeCount onClick={() => ctx.openTicker(s.symbol)} />)}
        </Card>
      </div>
      <Card className="p-5">
        <h2 className="text-base font-semibold mb-2">거래 내역 <span className="text-xs font-normal text-muted-foreground">· {ts.length}건 (최신순)</span></h2>
        {[...ts].sort((a, b) => b.txnDate - a.txnDate).map((t) => (
          <div key={t.id} className="grid items-center gap-2.5 py-2 border-b border-border/50 last:border-0 text-[13px]" style={{ gridTemplateColumns: "96px 1fr 64px 140px" }}>
            <span className="text-muted-foreground tabular-nums">{new Date(t.txnDate).toISOString().slice(0, 10)}</span>
            <span className="font-bold cursor-pointer" style={{ color: tickerColor(t.symbol) }} onClick={() => ctx.openTicker(t.symbol)}>{t.symbol} <span className="text-muted-foreground font-normal text-xs">{ctx.sectorOf(t.symbol)}</span></span>
            <span><span className="text-[10.5px] px-2 py-0.5 rounded font-bold" style={{ background: t.side === "sell" ? "rgba(248,81,73,.15)" : "rgba(63,185,80,.15)", color: t.side === "sell" ? SELL : BUY }}>{t.side === "sell" ? "매도" : "매수"}</span></span>
            <span className="text-right text-muted-foreground tabular-nums">{fmtMoney(t.amountLow ?? 0)}–{fmtMoney(t.amountHigh ?? 0)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ============================= MAIN =============================
export default function Congress() {
  const { data: politicians, isLoading: lp } = useQuery<Politician[]>({ queryKey: ["/api/congress/politicians"] });
  const { data: committees } = useQuery<Committee[]>({ queryKey: ["/api/congress/committees"] });
  const { data: allTrades, isLoading: lt } = useQuery<Trade[]>({
    queryKey: ["/api/congress/trades"],
    queryFn: async () => (await apiRequest("GET", "/api/congress/trades")).json(),
  });
  const { data: sectors } = useQuery<{ symbol: string; sector: string | null }[]>({ queryKey: ["/api/congress/sectors"] });

  const [view, setView] = useState<"tickers" | "committees" | "member">("tickers");
  const [selTicker, setSelTicker] = useState<string | null>(null);
  const [selCommittee, setSelCommittee] = useState<string | null>(null);
  const [selMember, setSelMember] = useState<string | null>(null);
  const [returnToMember, setReturnToMember] = useState<string | null>(null);
  const [returnToCommittee, setReturnToCommittee] = useState<string | null>(null);
  const [cmtSearch, setCmtSearch] = useState<string>("");
  const [sort, setSort] = useState<SortMetric>("vol");
  const [committeeFilter, setCommitteeFilter] = useState<string>("all");
  const [period, setPeriod] = useState<string>("all"); // all | q:<quarter> | custom
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  const pols = politicians ?? [];
  const cmts = committees ?? [];
  const trades = allTrades ?? [];

  const polBySlug = useMemo(() => new Map(pols.map((p) => [p.slug, p])), [pols]);
  const cmtById = useMemo(() => new Map(cmts.map((c) => [c.id, c])), [cmts]);
  const sectorBySymbol = useMemo(() => new Map((sectors ?? []).map((s) => [s.symbol, s.sector])), [sectors]);
  const sectorOf = (sym: string) => koSector(sectorBySymbol.get(sym)) || SECTOR[sym] || "";
  const allQuarters = useMemo(() => sortedQuarters(trades), [trades]);

  // active quarters from period selection
  const AQ = useMemo(() => {
    if (period === "custom" && customFrom && customTo) {
      const i = allQuarters.indexOf(customFrom), j = allQuarters.indexOf(customTo);
      if (i < 0 || j < 0) return allQuarters;
      const [a, b] = i <= j ? [i, j] : [j, i];
      return allQuarters.slice(a, b + 1);
    }
    if (period.startsWith("q:")) return [period.slice(2)];
    return allQuarters;
  }, [period, customFrom, customTo, allQuarters]);
  const periodLabel = AQ.length === 0 ? "—" : AQ.length === 1 ? fmtQ(AQ[0]) : `${fmtQ(AQ[0])} ~ ${fmtQ(AQ[AQ.length - 1])}`;

  const periodTrades = useMemo(() => { const set = new Set(AQ); return trades.filter((t) => set.has(quarterOf(t.txnDate))); }, [trades, AQ]);

  const openMember = (slug: string) => { setReturnToMember(null); setReturnToCommittee(null); setSelMember(slug); setView("member"); };
  const openTicker = (sym: string) => {
    // 어디서 종목으로 들어왔는지 기억 → 종목 화면에 복귀 버튼 표시
    setReturnToMember(view === "member" ? selMember : null);
    setReturnToCommittee(view === "committees" ? selCommittee : null);
    setSelTicker(sym); setView("tickers");
  };
  const ctx: Ctx = { polBySlug, cmtById, quarters: AQ, sectorOf, openMember, openTicker };

  if (lp || lt) return <div className="p-6 max-w-7xl mx-auto"><Skeleton className="h-8 w-48 mb-4" /><Skeleton className="h-64 w-full" /></div>;

  // ----- tickers view data -----
  const scopedTrades = committeeFilter === "all" ? periodTrades
    : periodTrades.filter((t) => polBySlug.get(t.slug)?.committees.includes(committeeFilter));
  const tickerAggs = rankList([...aggregate(scopedTrades).values()], sort);
  const maxVol = Math.max(1, ...tickerAggs.map((s) => s.vol));
  const selAgg = selTicker ? aggregate(scopedTrades).get(selTicker) : undefined;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-5 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-semibold flex items-center gap-2"><Landmark className="h-5 w-5 text-primary" /> 정치인 거래</h1>
        <div className="flex gap-1 ml-2">
          <Button variant={view === "tickers" ? "secondary" : "ghost"} size="sm" onClick={() => { setView("tickers"); setReturnToMember(null); setReturnToCommittee(null); }}>📊 종목 랭킹</Button>
          <Button variant={view === "committees" ? "secondary" : "ghost"} size="sm" onClick={() => { setView("committees"); setSelCommittee(null); }}>🏛️ 위원회별</Button>
        </div>
        <div className="ml-auto flex items-end gap-3 flex-wrap">
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">기간</div>
            <div className="flex items-center gap-2">
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 기간</SelectItem>
                  {allQuarters.map((q) => <SelectItem key={q} value={`q:${q}`}>{fmtQ(q)}</SelectItem>)}
                  <SelectItem value="custom">사용자 지정</SelectItem>
                </SelectContent>
              </Select>
              {period === "custom" && (
                <div className="flex items-center gap-1">
                  <Select value={customFrom} onValueChange={setCustomFrom}><SelectTrigger className="w-24 h-9"><SelectValue placeholder="시작" /></SelectTrigger><SelectContent>{allQuarters.map((q) => <SelectItem key={q} value={q}>{fmtQ(q)}</SelectItem>)}</SelectContent></Select>
                  <span className="text-muted-foreground">~</span>
                  <Select value={customTo} onValueChange={setCustomTo}><SelectTrigger className="w-24 h-9"><SelectValue placeholder="종료" /></SelectTrigger><SelectContent>{allQuarters.map((q) => <SelectItem key={q} value={q}>{fmtQ(q)}</SelectItem>)}</SelectContent></Select>
                </div>
              )}
            </div>
          </div>
          {view === "tickers" && <>
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">위원회 필터</div>
              <Select value={committeeFilter} onValueChange={(v) => { setCommitteeFilter(v); setSelTicker(null); }}>
                <SelectTrigger className="w-56 h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">전체</SelectItem>{cmts.map((c) => <SelectItem key={c.id} value={c.id}>{cmtLabel(c)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">정렬 기준</div>
              <Select value={sort} onValueChange={(v) => setSort(v as SortMetric)}>
                <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="vol">총 거래액 순</SelectItem><SelectItem value="net">매수 우위 순</SelectItem><SelectItem value="traders">거래 의원 수 순</SelectItem></SelectContent>
              </Select>
            </div>
          </>}
        </div>
      </header>

      {/* back bar (top-left) when navigated from member or committee */}
      {view === "tickers" && returnToMember && (
        <Button className="mb-4 font-bold shadow-lg" onClick={() => openMember(returnToMember)}>
          <ChevronLeft className="h-4 w-4 mr-1" />{polBySlug.get(returnToMember)?.name} 페이지로 돌아가기
        </Button>
      )}
      {view === "tickers" && returnToCommittee && (
        <Button className="mb-4 font-bold shadow-lg" onClick={() => { setView("committees"); setReturnToCommittee(null); }}>
          <ChevronLeft className="h-4 w-4 mr-1" />{cmtById.get(returnToCommittee)?.ko ?? "위원회"}로 돌아가기
        </Button>
      )}

      {view === "tickers" && (
        <div className="grid gap-5 items-start lg:grid-cols-[1.5fr_1fr]">
          <Card className="p-4">
            <h2 className="text-sm font-semibold mb-0.5">종목 랭킹 <span className="text-xs font-normal text-muted-foreground">· 집계기간 {periodLabel} · {committeeFilter === "all" ? `전체 ${tickerAggs.length}종목` : `${cmtLabel(cmtById.get(committeeFilter))} 소속`}</span></h2>
            <p className="text-[11.5px] text-muted-foreground mb-3">막대=매수(초록)/매도(빨강) 활동량, 스파크라인=분기별 순매수 추이. 행 클릭 시 거래 의원·추이 표시.</p>
            <RankHead />
            {tickerAggs.map((s, i) => <RankRow key={s.symbol} s={s} idx={i} maxVol={maxVol} quarters={AQ} ctx={ctx} selected={s.symbol === selTicker} onClick={() => { setReturnToMember(null); setReturnToCommittee(null); setSelTicker(s.symbol); }} />)}
          </Card>
          <Card className="p-5">
            {selAgg ? <TickerDetail agg={selAgg} quarters={AQ} ctx={ctx} /> : <div className="text-center text-sm text-muted-foreground py-20">← 종목을 선택하면 거래 의원·추이가 표시됩니다</div>}
          </Card>
        </div>
      )}

      {view === "committees" && (
        selCommittee && cmtById.get(selCommittee)
          ? <CommitteeDetail committee={cmtById.get(selCommittee)!} trades={periodTrades} quarters={AQ} periodLabel={periodLabel} ctx={ctx} onBack={() => setSelCommittee(null)} />
          : (
            <div>
              <div className="mb-4 max-w-sm">
                <Input value={cmtSearch} onChange={(e) => setCmtSearch(e.target.value)} placeholder="위원회 검색 (예: 군사, Armed, 금융 …)" className="h-9" />
              </div>
              <CommitteeCards committees={cmts} trades={periodTrades} ctx={ctx} onPick={setSelCommittee} search={cmtSearch} />
            </div>
          )
      )}

      {view === "member" && selMember && (
        <MemberDetail slug={selMember} trades={periodTrades} quarters={AQ} periodLabel={periodLabel} ctx={ctx}
          onBack={() => { if (returnToMember) { /* came from ticker */ } setView(selCommittee ? "committees" : "tickers"); }} />
      )}
    </div>
  );
}
