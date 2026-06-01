import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { SurgeRow, Stats, SyncLog, Tweet, timeAgo, shortCompanyName } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Users2, Hash, ExternalLink, Radar, Heart, Repeat2, MessageCircle } from "lucide-react";
import { LineChart, Line, AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from "recharts";

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number | string }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl font-semibold tabular-nums leading-none" data-testid={`stat-${label}`}>{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </div>
    </Card>
  );
}

// Compact name shown in the list: Korean first, else short English, else the ticker.
function nameOf(row: SurgeRow): { primary: string; secondary: string | null } {
  const en = shortCompanyName(row.companyName);
  if (row.companyNameKo) return { primary: row.companyNameKo, secondary: en };
  if (en) return { primary: en, secondary: null };
  return { primary: `$${row.symbol}`, secondary: null };
}

function Sparkline({ data }: { data: number[] }) {
  if (!data || !data.some((v) => v > 0)) return <div className="h-8 w-full" />;
  const d = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={32}>
      <AreaChart data={d} margin={{ top: 3, right: 0, left: 0, bottom: 0 }}>
        <Area type="monotone" dataKey="v" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ChangePct({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span className={`tabular-nums text-sm ${up ? "text-emerald-500" : "text-rose-500"}`}>
      {up ? "+" : ""}{pct}%
    </span>
  );
}

export default function Discover() {
  const [windowHours, setWindowHours] = useState("24");
  const [minAccounts, setMinAccounts] = useState("2");
  const [selected, setSelected] = useState<SurgeRow | null>(null);

  const { data: stats } = useQuery<Stats>({ queryKey: ["/api/stats"] });
  const { data: surge, isLoading } = useQuery<SurgeRow[]>({
    queryKey: ["/api/surge", windowHours, minAccounts],
    queryFn: async () => (await apiRequest("GET", `/api/surge?windowHours=${windowHours}&minAccounts=${minAccounts}`)).json(),
  });
  const { data: logs } = useQuery<SyncLog[]>({ queryKey: ["/api/sync-logs"], queryFn: async () => (await apiRequest("GET", "/api/sync-logs?limit=1")).json() });
  const rows = Array.isArray(surge) ? surge : [];
  const lastLog = Array.isArray(logs) ? logs[0] : undefined;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-xl font-semibold flex items-center gap-2"><Radar className="h-5 w-5 text-primary" /> 종목 발견</h1>
        <p className="text-sm text-muted-foreground mt-1">
          추적 계정들이 새로 언급하는 종목을 역추출해, 여러 계정에서 동시에 급상승하는 종목을 찾아냅니다.
          {lastLog?.startedAt && <span> · 마지막 수집 {timeAgo(lastLog.startedAt)}</span>}
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Users2} label="추적 계정" value={stats?.accounts ?? 0} />
        <StatCard icon={MessageCircle} label="수집 트윗" value={stats?.tweets ?? 0} />
        <StatCard icon={Hash} label="언급 종목" value={stats?.symbols ?? 0} />
        <StatCard icon={TrendingUp} label="총 언급" value={stats?.mentions ?? 0} />
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">기간</span>
          <Select value={windowHours} onValueChange={setWindowHours}>
            <SelectTrigger className="w-28" data-testid="select-window"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="6">최근 6시간</SelectItem>
              <SelectItem value="12">최근 12시간</SelectItem>
              <SelectItem value="24">최근 24시간</SelectItem>
              <SelectItem value="72">최근 3일</SelectItem>
              <SelectItem value="168">최근 7일</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">최소 계정수</span>
          <Select value={minAccounts} onValueChange={setMinAccounts}>
            <SelectTrigger className="w-20" data-testid="select-minaccounts"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1개+</SelectItem>
              <SelectItem value="2">2개+</SelectItem>
              <SelectItem value="3">3개+</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center">
          <Radar className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <div className="font-medium">아직 급상승 종목이 없습니다</div>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            추적 계정을 추가하고 수집을 실행해 보세요. 기간·최소 계정수 필터를 낮추면 더 많은 종목이 표시됩니다.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* header */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            <div className="w-7 text-center">#</div>
            <div className="flex-1">종목</div>
            <div className="w-16 text-right hidden sm:block">언급</div>
            <div className="w-16 text-right">변동</div>
            <div className="w-24 text-right hidden md:block">트렌드</div>
            <div className="w-14 text-right hidden lg:block">계정</div>
          </div>
          {/* rows */}
          {rows.map((row, idx) => {
            const n = nameOf(row);
            return (
              <div
                key={row.symbol}
                className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 cursor-pointer hover-elevate"
                onClick={() => setSelected(row)}
                data-testid={`row-symbol-${row.symbol}`}
              >
                <div className="w-7 text-center text-sm font-mono text-muted-foreground tabular-nums">{idx + 1}</div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate leading-tight">{n.primary}</div>
                    {n.secondary && <div className="text-[11px] text-muted-foreground truncate leading-tight">{n.secondary}</div>}
                  </div>
                  <span className="shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">{row.symbol}</span>
                </div>
                <div className="w-16 text-right tabular-nums text-sm hidden sm:block">{row.recentMentions.toLocaleString()}</div>
                <div className="w-16 text-right"><ChangePct pct={row.changePercent} /></div>
                <div className="w-24 hidden md:block"><Sparkline data={row.trend} /></div>
                <div className="w-14 text-right tabular-nums text-sm text-muted-foreground hidden lg:block">{row.recentAccounts}</div>
              </div>
            );
          })}
        </Card>
      )}

      <SymbolDetail row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function SymbolDetail({ row, onClose }: { row: SurgeRow | null; onClose: () => void }) {
  const symbol = row?.symbol;
  const { data: timeline } = useQuery<{ day: string; count: number }[]>({
    queryKey: ["/api/symbols", symbol, "timeline"],
    queryFn: async () => (await apiRequest("GET", `/api/symbols/${symbol}/timeline?days=14`)).json(),
    enabled: !!symbol,
  });
  const { data: tweets } = useQuery<Tweet[]>({
    queryKey: ["/api/symbols", symbol, "tweets"],
    queryFn: async () => (await apiRequest("GET", `/api/symbols/${symbol}/tweets?limit=30`)).json(),
    enabled: !!symbol,
  });
  const tweetList = Array.isArray(tweets) ? tweets : [];
  const tl = Array.isArray(timeline) ? timeline : [];
  const en = row ? shortCompanyName(row.companyName) : null;

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-auto">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 flex-wrap">
                {row.companyNameKo && <span>{row.companyNameKo}</span>}
                <span className="font-mono">${row.symbol}</span>
                {en && <span className="text-sm font-normal text-muted-foreground">{en}</span>}
              </SheetTitle>
            </SheetHeader>

            <div className="grid grid-cols-3 gap-2 my-4">
              <Card className="p-3"><div className="text-xs text-muted-foreground">급상승 점수</div><div className="text-lg font-semibold tabular-nums">{row.surgeScore.toFixed(0)}</div></Card>
              <Card className="p-3"><div className="text-xs text-muted-foreground">최근 계정수</div><div className="text-lg font-semibold tabular-nums">{row.recentAccounts}</div></Card>
              <Card className="p-3"><div className="text-xs text-muted-foreground">최근 언급</div><div className="text-lg font-semibold tabular-nums">{row.recentMentions}</div></Card>
            </div>

            <div className="mb-4">
              <div className="text-sm font-medium mb-2">최근 14일 언급 추이</div>
              <Card className="p-3 h-40">
                {tl.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={tl} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(d) => d.slice(5)} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                      <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <div className="h-full flex items-center justify-center text-sm text-muted-foreground">데이터 없음</div>}
              </Card>
            </div>

            <div className="text-sm font-medium mb-2">언급한 트윗 ({tweetList.length})</div>
            <div className="space-y-2">
              {tweetList.map((t) => (
                <Card key={t.tweetId} className="p-3" data-testid={`tweet-${t.tweetId}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-mono text-primary">@{t.handle}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">{timeAgo(t.tweetedAt)}</span>
                      {t.url && <a href={t.url} target="_blank" rel="noreferrer" data-testid={`link-tweet-${t.tweetId}`}><ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" /></a>}
                    </div>
                  </div>
                  <p className="text-sm leading-snug">{t.text}</p>
                  <div className="flex gap-4 mt-2 text-[11px] text-muted-foreground tabular-nums">
                    <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{t.likeCount}</span>
                    <span className="flex items-center gap-1"><Repeat2 className="h-3 w-3" />{t.retweetCount}</span>
                    <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{t.replyCount}</span>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
