import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { fmtMoney, tickerColor, koSector, koCompany } from "@/lib/congress";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserSearch, ChevronRight, ChevronLeft, ArrowLeft } from "lucide-react";

const BUY = "#3fb950";
const SELL = "#f85149";

interface RankRow {
  symbol: string; company: string | null; sector: string | null;
  buyValue: number; sellValue: number; netValue: number;
  buyCount: number; sellCount: number; insiderCount: number; tradeCount: number;
}
interface ITrade {
  id: number; insiderId: number; insiderName: string; insiderSlug: string;
  symbol: string; company: string | null; txnCode: string | null; side: string;
  shares: number | null; price: number | null; value: number | null; txnDate: number; filedDate: number | null;
  role: string | null;
}

const SIDE_KO: Record<string, string> = { buy: "매수", sell: "매도", award: "보상", exercise: "옵션행사", tax: "세금", gift: "증여", conversion: "전환", other: "기타" };
const sectorLabel = (s: string | null) => koSector(s) || "";
const fmtShares = (n: number | null) => (n == null ? "—" : n.toLocaleString());
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function StackedBar({ r, maxVol }: { r: RankRow; maxVol: number }) {
  const vol = r.buyValue + r.sellValue;
  const w = Math.max((vol / maxVol) * 100, 5);
  return (
    <div className="h-[18px] rounded bg-background/60 overflow-hidden flex" style={{ width: `${w}%` }}>
      <div style={{ width: `${vol ? (r.buyValue / vol) * 100 : 0}%`, background: BUY }} />
      <div style={{ width: `${vol ? (r.sellValue / vol) * 100 : 0}%`, background: SELL }} />
    </div>
  );
}

type Metric = "buy" | "sell" | "net" | "trades" | "insiders";

// 한 종목 상세에서 인사이더별로 묶기 (side 별 합산)
function groupBySide(trades: ITrade[], side: "buy" | "sell") {
  const m = new Map<string, { name: string; slug: string; role: string | null; value: number; shares: number; n: number }>();
  for (const t of trades) {
    if (t.side !== side) continue;
    const e = m.get(t.insiderSlug) || { name: t.insiderName, slug: t.insiderSlug, role: null, value: 0, shares: 0, n: 0 };
    e.value += t.value || 0; e.shares += t.shares || 0; e.n++;
    if (!e.role && t.role) e.role = t.role;
    m.set(t.insiderSlug, e);
  }
  return [...m.values()].sort((a, b) => b.value - a.value);
}

interface Ctx { openInsider: (slug: string, name: string) => void; openTicker: (sym: string) => void; }

function InsiderBox({ side, trades, ctx }: { side: "buy" | "sell"; trades: ITrade[]; ctx: Ctx }) {
  const rows = groupBySide(trades, side);
  const color = side === "buy" ? BUY : SELL;
  return (
    <div className="rounded-lg border bg-background/50 p-2.5" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="text-xs font-bold mb-1.5" style={{ color }}>{side === "buy" ? "🟢 매수한 인사이더" : "🔴 매도한 인사이더"} ({rows.length})</div>
      {rows.length === 0 && <div className="text-xs text-muted-foreground">없음</div>}
      {rows.map((r) => (
        <div key={r.slug} className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0 cursor-pointer rounded hover:bg-muted/40 px-1" onClick={() => ctx.openInsider(r.slug, r.name)} title={`${r.name}${r.role ? ` · ${r.role}` : ""} 거래 보기`}>
          <span className="font-semibold text-[13px] shrink-0">{r.name}</span>
          {r.role && <span className="text-[10px] text-muted-foreground bg-background border rounded px-1.5 py-0.5 truncate max-w-[160px]">{r.role}</span>}
          <ChevronRight className="h-3 w-3 text-primary shrink-0" />
          <span className="ml-auto text-[12px] text-muted-foreground tabular-nums shrink-0">{fmtShares(r.shares)}주</span>
          <span className="text-[12.5px] font-bold tabular-nums shrink-0" style={{ color }}>{side === "buy" ? "+" : "−"}{fmtMoney(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

function TickerDetail({ row, from, to, ctx }: { row: RankRow; from?: number; to?: number; ctx: Ctx }) {
  const { data: trades, isLoading } = useQuery<ITrade[]>({
    queryKey: ["/api/insider/ticker", row.symbol, from, to],
    queryFn: async () => (await apiRequest("GET", `/api/insider/ticker/${row.symbol}${from ? `?from=${from}&to=${to}` : ""}`)).json(),
  });
  const list = trades ?? [];
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="h-3.5 w-3.5 rounded" style={{ background: tickerColor(row.symbol) }} />
        <span className="text-2xl font-bold">{row.symbol}</span>
        <span className="text-xs text-muted-foreground">{sectorLabel(row.sector)}{row.company ? ` · ${row.company}` : ""}{koCompany(row.symbol) ? ` (${koCompany(row.symbol)})` : ""}</span>
      </div>
      <div className="flex gap-5 my-3 flex-wrap">
        <div><div className="text-lg font-bold tabular-nums" style={{ color: BUY }}>{fmtMoney(row.buyValue)}</div><div className="text-[11px] text-muted-foreground">내부자 매수</div></div>
        <div><div className="text-lg font-bold tabular-nums" style={{ color: SELL }}>{fmtMoney(row.sellValue)}</div><div className="text-[11px] text-muted-foreground">내부자 매도</div></div>
        <div><div className="text-lg font-bold tabular-nums" style={{ color: row.netValue >= 0 ? BUY : SELL }}>{row.netValue >= 0 ? "+" : "−"}{fmtMoney(Math.abs(row.netValue))}</div><div className="text-[11px] text-muted-foreground">순매수</div></div>
        <div><div className="text-lg font-bold tabular-nums">{row.insiderCount}명</div><div className="text-[11px] text-muted-foreground">인사이더</div></div>
      </div>
      {isLoading ? <Skeleton className="h-40 w-full" /> : (
        <div className="grid gap-3">
          <InsiderBox side="buy" trades={list} ctx={ctx} />
          <InsiderBox side="sell" trades={list} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

function InsiderDetail({ slug, name, from, to, ctx, onBack }: { slug: string; name: string; from?: number; to?: number; ctx: Ctx; onBack: () => void }) {
  const { data: trades, isLoading } = useQuery<ITrade[]>({
    queryKey: ["/api/insider/insider", slug, from, to],
    queryFn: async () => (await apiRequest("GET", `/api/insider/insider/${slug}${from ? `?from=${from}&to=${to}` : ""}`)).json(),
  });
  const list = trades ?? [];
  let buyV = 0, sellV = 0;
  for (const t of list) { if (t.side === "buy") buyV += t.value || 0; else if (t.side === "sell") sellV += t.value || 0; }
  const companies = new Set(list.map((t) => t.symbol));
  return (
    <div>
      <Button className="mb-4 font-bold shadow-lg" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1.5" />뒤로</Button>
      <Card className="p-5 mb-4">
        <div className="text-xl font-bold flex items-center gap-2 flex-wrap"><UserSearch className="h-5 w-5 text-primary" />{name}
          {list.find((t) => t.role)?.role && <span className="text-[11px] font-medium text-muted-foreground bg-background border rounded px-2 py-0.5">{list.find((t) => t.role)?.role}</span>}
        </div>
        <div className="flex gap-5 mt-3 flex-wrap">
          <div><div className="text-lg font-bold tabular-nums" style={{ color: BUY }}>{fmtMoney(buyV)}</div><div className="text-[11px] text-muted-foreground">매수</div></div>
          <div><div className="text-lg font-bold tabular-nums" style={{ color: SELL }}>{fmtMoney(sellV)}</div><div className="text-[11px] text-muted-foreground">매도</div></div>
          <div><div className="text-lg font-bold tabular-nums">{companies.size}</div><div className="text-[11px] text-muted-foreground">거래 종목</div></div>
          <div><div className="text-lg font-bold tabular-nums">{list.length}</div><div className="text-[11px] text-muted-foreground">거래 건수</div></div>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="text-base font-semibold mb-2">거래 내역 <span className="text-xs font-normal text-muted-foreground">· {list.length}건 (최신순)</span></h2>
        {isLoading ? <Skeleton className="h-40 w-full" /> : (
          <div>
            <div className="grid items-center gap-2.5 px-1.5 py-1.5 text-[11px] text-muted-foreground border-b" style={{ gridTemplateColumns: "90px 80px 56px 1fr 110px 110px" }}>
              <div>거래일</div><div>종목</div><div>유형</div><div>수량</div><div className="text-right">단가</div><div className="text-right">금액</div>
            </div>
            {list.map((t) => (
              <div key={t.id} className="grid items-center gap-2.5 px-1.5 py-2 border-b border-border/50 last:border-0 text-[13px]" style={{ gridTemplateColumns: "90px 80px 56px 1fr 110px 110px" }}>
                <span className="text-muted-foreground tabular-nums">{ymd(t.txnDate)}</span>
                <span className="font-bold cursor-pointer" style={{ color: tickerColor(t.symbol) }} onClick={() => ctx.openTicker(t.symbol)}>{t.symbol}</span>
                <span><span className="text-[10.5px] px-1.5 py-0.5 rounded font-bold" style={{ background: t.side === "buy" ? "rgba(63,185,80,.15)" : t.side === "sell" ? "rgba(248,81,73,.15)" : "rgba(139,148,158,.15)", color: t.side === "buy" ? BUY : t.side === "sell" ? SELL : "var(--muted-foreground)" }}>{SIDE_KO[t.side] || t.side}</span></span>
                <span className="tabular-nums">{fmtShares(t.shares)}</span>
                <span className="text-right tabular-nums text-muted-foreground">{t.price ? `$${t.price.toFixed(2)}` : "—"}</span>
                <span className="text-right tabular-nums">{t.value ? fmtMoney(t.value) : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ============================= MAIN =============================
export default function Insider() {
  const [period, setPeriod] = useState<string>("90"); // all | 7 | 30 | 90 (days)
  const [metric, setMetric] = useState<Metric>("buy");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"tickers" | "insider">("tickers");
  const [selSymbol, setSelSymbol] = useState<string | null>(null);
  const [selInsider, setSelInsider] = useState<{ slug: string; name: string } | null>(null);

  const now = Date.now();
  const from = period === "all" ? undefined : now - Number(period) * 86400000;
  const to = period === "all" ? undefined : now;

  const { data: ranking, isLoading } = useQuery<RankRow[]>({
    queryKey: ["/api/insider/ranking", period],
    queryFn: async () => (await apiRequest("GET", `/api/insider/ranking${from ? `?from=${from}&to=${to}` : ""}`)).json(),
  });
  const rows = ranking ?? [];

  const ctx: Ctx = {
    openInsider: (slug, name) => { setSelInsider({ slug, name }); setView("insider"); },
    openTicker: (sym) => { setSelSymbol(sym); setView("tickers"); },
  };

  const key = (r: RankRow) => metric === "buy" ? r.buyValue : metric === "sell" ? r.sellValue : metric === "net" ? r.netValue : metric === "trades" ? r.tradeCount : r.insiderCount;
  const q = search.trim().toLowerCase();
  const sorted = useMemo(() => {
    const filtered = q ? rows.filter((r) => r.symbol.toLowerCase().includes(q) || (r.company || "").toLowerCase().includes(q)) : rows;
    return [...filtered].sort((a, b) => key(b) - key(a));
  }, [rows, metric, q]);
  const maxVol = Math.max(1, ...sorted.map((r) => r.buyValue + r.sellValue));
  const selRow = selSymbol ? rows.find((r) => r.symbol === selSymbol) : undefined;

  if (isLoading) return <div className="p-6 max-w-7xl mx-auto"><Skeleton className="h-8 w-48 mb-4" /><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-5 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-semibold flex items-center gap-2"><UserSearch className="h-5 w-5 text-primary" /> 내부자 거래</h1>
        <span className="text-xs text-muted-foreground">SEC Form 4 · 추적 종목(우리 DB + S&P500)</span>
        <div className="ml-auto flex items-end gap-3 flex-wrap">
          <div><div className="text-[11px] text-muted-foreground mb-1">기간</div>
            <Select value={period} onValueChange={(v) => { setPeriod(v); setSelSymbol(null); }}>
              <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="7">최근 7일</SelectItem><SelectItem value="30">최근 30일</SelectItem><SelectItem value="90">최근 90일</SelectItem><SelectItem value="all">전체</SelectItem></SelectContent>
            </Select>
          </div>
          <div><div className="text-[11px] text-muted-foreground mb-1">정렬 기준</div>
            <Select value={metric} onValueChange={(v) => setMetric(v as Metric)}>
              <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="buy">내부자 매수액 순</SelectItem>
                <SelectItem value="sell">내부자 매도액 순</SelectItem>
                <SelectItem value="net">순매수 순</SelectItem>
                <SelectItem value="insiders">인사이더 수 순</SelectItem>
                <SelectItem value="trades">거래 건수 순</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      {view === "insider" && selInsider ? (
        <InsiderDetail slug={selInsider.slug} name={selInsider.name} from={from} to={to} ctx={ctx} onBack={() => setView("tickers")} />
      ) : (
        <div className="grid gap-5 items-start lg:grid-cols-[1.5fr_1fr]">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <h2 className="text-sm font-semibold">종목 랭킹 <span className="text-xs font-normal text-muted-foreground">· {period === "all" ? "전체 기간" : `최근 ${period}일`} · {sorted.length}종목</span></h2>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="종목/회사 검색" className="h-8 w-44 rounded-md border bg-background px-2.5 text-[13px]" />
            </div>
            <p className="text-[11.5px] text-muted-foreground mb-3">막대=내부자 매수(초록)/매도(빨강) 금액. P=매수·S=매도 등 Form4 거래. 행 클릭 시 누가 거래했는지 표시.</p>
            <div className="grid items-center gap-2.5 px-2 py-1.5 text-[11px] text-muted-foreground border-b" style={{ gridTemplateColumns: "24px 110px 1fr 96px 52px" }}>
              <div className="text-center">#</div><div>종목</div><div>매수/매도</div><div className="text-right">순매수</div><div className="text-center">인사이더</div>
            </div>
            {sorted.length === 0 && <div className="text-sm text-muted-foreground py-10 text-center">데이터가 없습니다 (수집 필요)</div>}
            {sorted.slice(0, 200).map((r, i) => (
              <div key={r.symbol} className={`grid items-center gap-2.5 px-2 py-2 rounded-lg border cursor-pointer ${r.symbol === selSymbol ? "border-primary bg-muted/40" : "border-transparent hover:bg-muted/30"}`}
                style={{ gridTemplateColumns: "24px 110px 1fr 96px 52px" }} onClick={() => setSelSymbol(r.symbol)}>
                <div className="text-xs text-muted-foreground text-center tabular-nums">{i + 1}</div>
                <div className="flex items-center gap-1.5 font-bold text-sm"><span className="h-2.5 w-2.5 rounded" style={{ background: tickerColor(r.symbol) }} />{r.symbol}<span className="text-[10px] font-normal text-muted-foreground">{sectorLabel(r.sector)}</span></div>
                <StackedBar r={r} maxVol={maxVol} />
                <div className="text-right text-[12.5px] font-bold tabular-nums" style={{ color: r.netValue >= 0 ? BUY : SELL }}>{r.netValue >= 0 ? "+" : "−"}{fmtMoney(Math.abs(r.netValue))}</div>
                <div className="text-center text-xs text-muted-foreground tabular-nums">{r.insiderCount}명</div>
              </div>
            ))}
          </Card>
          <Card className="p-5">
            {selRow ? <TickerDetail row={selRow} from={from} to={to} ctx={ctx} /> : <div className="text-center text-sm text-muted-foreground py-20">← 종목을 선택하면 거래한 인사이더가 표시됩니다</div>}
          </Card>
        </div>
      )}
    </div>
  );
}
