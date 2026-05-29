import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { SurgeRow, Stats, SyncLog, Tweet, timeAgo } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Users2, Flame, Hash, ExternalLink, Radar, Heart, Repeat2, MessageCircle } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from "recharts";

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

function SurgeBadge({ row }: { row: SurgeRow }) {
  const lift = (row.recentMentions + 1) / (row.priorMentions + 1);
  const hot = row.recentAccounts >= 3 || lift >= 3;
  return (
    <Badge variant={hot ? "default" : "secondary"} className="gap-1">
      <Flame className="h-3 w-3" />
      {row.surgeScore.toFixed(0)}
    </Badge>
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
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center">
          <Radar className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <div className="font-medium">아직 급상승 종목이 없습니다</div>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            추적 계정을 추가하고 수집을 실행하거나, 설정에서 더미 데이터를 넣어 동작을 확인해 보세요.
            기간·최소 계정수 필터를 낮추면 더 많은 종목이 표시됩니다.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <Card
              key={row.symbol}
              className="p-4 flex items-center gap-4 cursor-pointer hover-elevate"
              onClick={() => setSelected(row)}
              data-testid={`row-symbol-${row.symbol}`}
            >
              <div className="text-sm font-mono text-muted-foreground w-6 text-center">{idx + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold font-mono text-base">${row.symbol}</span>
                  {row.companyName && <span className="text-sm text-muted-foreground truncate">{row.companyName}</span>}
                  <SurgeBadge row={row} />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {row.accounts.slice(0, 6).map((h) => (
                    <span key={h} className="text-[11px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono">@{h}</span>
                  ))}
                  {row.accounts.length > 6 && <span className="text-[11px] text-muted-foreground">+{row.accounts.length - 6}</span>}
                </div>
              </div>
              <div className="text-right shrink-0 hidden sm:block">
                <div className="text-sm tabular-nums">
                  <span className="font-semibold text-primary">{row.recentAccounts}</span>
                  <span className="text-muted-foreground"> 계정 · {row.recentMentions}건</span>
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  이전 {row.priorMentions}건 → 현재 {row.recentMentions}건
                </div>
              </div>
            </Card>
          ))}
        </div>
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

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-auto">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="font-mono">${row.symbol}</span>
                {row.companyName && <span className="text-sm font-normal text-muted-foreground">{row.companyName}</span>}
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
