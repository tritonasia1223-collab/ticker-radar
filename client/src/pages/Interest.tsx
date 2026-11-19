import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { InterestRow, InterestTrend, changeColorClass } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Star, TrendingUp, TrendingDown } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Legend } from "recharts";

// 국장 보조지표 → 한국 관례(빨강 상승 / 파랑 하락)
const KR = "kr";
const LINE_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];
const fmt = (n: number) => n.toLocaleString();
const nm = (r: { name: string | null; symbol: string }) => r.name || r.symbol;

export default function Interest() {
  const { data: today, isLoading } = useQuery<{ date: string | null; rows: InterestRow[] }>({
    queryKey: ["/api/interest/today"],
    queryFn: async () => (await apiRequest("GET", "/api/interest/today")).json(),
  });
  const { data: trend } = useQuery<InterestTrend>({
    queryKey: ["/api/interest/trend"],
    queryFn: async () => (await apiRequest("GET", "/api/interest/trend?days=30")).json(),
  });

  const rows = today?.rows ?? [];
  const dates = trend?.dates ?? [];
  // recharts wants one row per date with a column per charted symbol
  const chartData = dates.map((d, i) => {
    const row: any = { date: d.slice(5) };
    for (const s of trend?.series ?? []) row[s.symbol] = s.points[i];
    return row;
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-xl font-semibold flex items-center gap-2"><Star className="h-5 w-5 text-primary" /> 관심종목 (국장)</h1>
        <p className="text-sm text-muted-foreground mt-1">
          한국투자증권 기준 <b>관심종목 등록 상위</b> — 개인 투자자들이 관심종목으로 가장 많이 등록한 국내주식입니다.
          SNS 발굴과 별개의 <b>retail 관심</b> 신호로, 매일 쌓아 등록 건수 추이를 봅니다.
          {today?.date && <span> · 기준일 {today.date}</span>}
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : !today?.date || rows.length === 0 ? (
        <Card className="p-12 text-center">
          <Star className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <div className="font-medium">아직 관심종목 데이터가 없습니다</div>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto leading-relaxed">
            <code>.env</code>에 <code>KIS_APP_KEY</code> / <code>KIS_APP_SECRET</code>를 넣고
            <code className="mx-1">npm run collect:interest</code>를 실행하면 오늘 스냅샷이 수집됩니다.
            매일 한 번씩 쌓이면 등록 건수 추이가 표시됩니다.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* 추이 / 무버 — 이틀 이상 쌓였을 때만 */}
          {dates.length >= 2 && (
            <div className="grid lg:grid-cols-3 gap-4">
              <Card className="lg:col-span-2 p-4">
                <div className="text-sm font-medium mb-3">등록 건수 추이 (상위 종목)</div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={48} tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : v} />
                      <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {(trend?.series ?? []).map((s, i) => (
                        <Line key={s.symbol} type="monotone" dataKey={s.symbol} name={nm(s)} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-4">
                <Movers title="인기 급상승" icon={TrendingUp} rows={trend?.movers.up ?? []} kind="up" />
                <div className="my-3 border-t" />
                <Movers title="인기 하락" icon={TrendingDown} rows={trend?.movers.down ?? []} kind="down" />
              </Card>
            </div>
          )}

          {/* 오늘 리스트 */}
          <Card className="overflow-hidden">
            <div className="flex items-center gap-4 px-4 py-2.5 border-b text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              <div className="w-8 text-center">#</div>
              <div className="flex-1">종목</div>
              <div className="w-24 text-right">관심등록</div>
              <div className="w-16 text-right">등락률</div>
              <div className="w-20 text-right hidden sm:block">현재가</div>
            </div>
            {rows.map((r) => (
              <div key={r.symbol} className="flex items-center gap-4 px-4 py-2.5 border-b last:border-0" data-testid={`interest-${r.symbol}`}>
                <div className="w-8 text-center text-sm font-mono text-muted-foreground tabular-nums">{r.rank}</div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{nm(r)}</span>
                  <span className="shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">{r.symbol}</span>
                </div>
                <div className="w-24 text-right tabular-nums text-sm font-medium">{fmt(r.regCount)}</div>
                <div className={`w-16 text-right tabular-nums text-sm ${r.changePct == null ? "text-muted-foreground" : changeColorClass(r.changePct, KR)}`}>
                  {r.changePct == null ? "—" : `${r.changePct >= 0 ? "+" : ""}${r.changePct}%`}
                </div>
                <div className="w-20 text-right tabular-nums text-sm text-muted-foreground hidden sm:block">{r.price ? fmt(r.price) : "—"}</div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

function Movers({ title, icon: Icon, rows, kind }: { title: string; icon: any; rows: InterestTrend["movers"]["up"]; kind: "up" | "down" }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium mb-2">
        <Icon className={`h-3.5 w-3.5 ${kind === "up" ? "text-rose-500" : "text-blue-500"}`} />{title}
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-1">변동 없음</div>
      ) : (
        <div className="space-y-1">
          {rows.slice(0, 6).map((m) => (
            <div key={m.symbol} className="flex items-center gap-2 text-sm">
              <span className="flex-1 min-w-0 truncate">{nm(m)}</span>
              <span className={`tabular-nums text-xs ${kind === "up" ? "text-rose-500" : "text-blue-500"}`}>
                {m.delta >= 0 ? "+" : ""}{fmt(m.delta)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
