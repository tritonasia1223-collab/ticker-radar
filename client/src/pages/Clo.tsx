import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, ReferenceLine } from "recharts";
import { apiRequest } from "@/lib/queryClient";
import { fmtMoney } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Layers, ExternalLink, CheckCircle2, AlertTriangle, TrendingUp, TrendingDown, Activity } from "lucide-react";

// server/clo.ts 의 응답 형태
interface Holding { cusip: string; dealName: string; marketValue: number; weightPct: number; inNport: boolean }
interface JoinStat {
  csvCount: number; nportCount: number; matched: number;
  rawRatePct: number; survivalRatePct: number; csvOnly: number; nportOnly: number;
  nportAsOf: string | null; nportAccession: string | null;
}
interface EtfView {
  etf: string; manager: string; tranche: string; sourceUrl: string;
  holdingsCount: number; totalMarketValue: number; holdings: Holding[]; join: JoinStat | null; error?: string;
}
interface Overview { etfs: EtfView[]; generatedAt: number; note: string }

// /api/clo/macro (server/clo-macro.ts)
interface MacroPoint { date: string; value: number }
interface MacroSeries {
  id: string; label: string; note: string; primary: boolean;
  latest: number; latestDate: string; chg1y: number | null; chg3m: number | null;
  windowMin: number; windowMax: number; data: MacroPoint[];
}
interface Macro { series: MacroSeries[]; generatedAt: number; source: string; note: string }

const AAA = "#3fb950"; // 매치=초록
const MISS = "#8b949e"; // 미매치=회색
const CCC_COL = "#f85149"; // 최고위험(CCC)=빨강
const HY_COL = "#58a6ff"; // HY=파랑
const WORSE = "#f85149", BETTER = "#3fb950"; // 스프레드: 확대=악화(빨강) / 축소=개선(초록)

function JoinBadge({ join }: { join: JoinStat | null }) {
  if (!join) return <span className="text-[11px] text-muted-foreground">N-PORT 조인 없음</span>;
  const ok = join.survivalRatePct >= 90;
  return (
    <div className="flex items-center gap-1.5 text-[11px]" title={`raw 조인율 ${join.rawRatePct}% (오늘 CSV 분모) · 생존율 ${join.survivalRatePct}% (N-PORT 분모, 시차 비오염)`}>
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" style={{ color: AAA }} /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
      <span className="tabular-nums font-medium">생존율 {join.survivalRatePct}%</span>
      <span className="text-muted-foreground">({join.matched}/{join.nportCount})</span>
    </div>
  );
}

function EtfCard({ e, selected, onSelect }: { e: EtfView; selected: boolean; onSelect: () => void }) {
  return (
    <Card
      className={`p-3.5 cursor-pointer hover-elevate ${selected ? "ring-1 ring-primary" : ""}`}
      onClick={onSelect}
      data-testid={`clo-etf-${e.etf}`}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold">{e.etf}</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{e.tranche}</span>
        <a
          href={e.sourceUrl} target="_blank" rel="noreferrer"
          className="ml-auto text-muted-foreground hover:text-primary" title="운용사 홀딩스 페이지"
          onClick={(ev) => ev.stopPropagation()}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{e.manager}</div>
      {e.error && !e.holdingsCount ? (
        <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">{e.error}</div>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-lg font-semibold tabular-nums">{e.holdingsCount}</span>
            <span className="text-[11px] text-muted-foreground">트랜치 · {fmtMoney(e.totalMarketValue)}</span>
          </div>
          <div className="mt-1.5"><JoinBadge join={e.join} /></div>
          {e.join?.nportAsOf && (
            <div className="text-[10.5px] text-muted-foreground/70 mt-0.5">N-PORT asOf {e.join.nportAsOf}</div>
          )}
        </>
      )}
    </Card>
  );
}

// 스프레드 변화(%p) — 확대(+)=악화. 부호에 따라 색/화살표.
function Delta({ v, label }: { v: number | null; label: string }) {
  if (v == null) return null;
  const worse = v > 0, flat = Math.abs(v) < 0.005;
  const col = flat ? MISS : worse ? WORSE : BETTER;
  const Icon = flat ? Activity : worse ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] tabular-nums" style={{ color: col }} title={`${label}: ${worse ? "확대(악화)" : "축소(개선)"}`}>
      <Icon className="h-3 w-3" />{v > 0 ? "+" : ""}{v}%p<span className="text-muted-foreground/60">{label}</span>
    </span>
  );
}

function MacroCard({ s }: { s: MacroSeries }) {
  // 관측창 내 현재 위치(0=저점,1=고점) — "지금이 높은가" 감각
  const pos = s.windowMax > s.windowMin ? (s.latest - s.windowMin) / (s.windowMax - s.windowMin) : 0;
  const col = s.primary ? CCC_COL : HY_COL;
  return (
    <Card className={`p-3.5 ${s.primary ? "ring-1 ring-[color:var(--ring)]" : ""}`} style={s.primary ? { boxShadow: `inset 0 0 0 1px ${CCC_COL}55` } : undefined} data-testid={`macro-${s.id}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] font-semibold">{s.label}</span>
        {s.primary && <span className="text-[9.5px] px-1 py-0.5 rounded" style={{ background: `${CCC_COL}22`, color: CCC_COL }}>CLO 직결</span>}
      </div>
      <div className="text-[10.5px] text-muted-foreground mt-0.5">{s.note}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums" style={{ color: col }}>{s.latest}</span>
        <span className="text-[11px] text-muted-foreground">% OAS</span>
      </div>
      <div className="mt-1 flex items-center gap-2 flex-wrap">
        <Delta v={s.chg1y} label="1y" />
        <Delta v={s.chg3m} label="3m" />
      </div>
      {/* 관측창 내 위치 바 */}
      <div className="mt-2">
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.round(pos * 100)}%`, background: col }} />
        </div>
        <div className="flex justify-between text-[9.5px] text-muted-foreground/70 mt-0.5 tabular-nums">
          <span>{s.windowMin}</span><span>3년 범위</span><span>{s.windowMax}</span>
        </div>
      </div>
    </Card>
  );
}

function MacroStrip() {
  const { data, isLoading, error } = useQuery<Macro>({
    queryKey: ["/api/clo/macro"],
    queryFn: async () => (await apiRequest("GET", "/api/clo/macro")).json(),
  });

  // CCC + HY 를 날짜로 병합(다이버전스 차트)
  const merged = useMemo(() => {
    if (!data) return [];
    const ccc = data.series.find((s) => s.id === "BAMLH0A3HYC");
    const hy = data.series.find((s) => s.id === "BAMLH0A0HYM2");
    if (!ccc) return [];
    const hyMap = new Map((hy?.data ?? []).map((p) => [p.date, p.value]));
    return ccc.data.map((p) => ({ date: p.date, ccc: p.value, hy: hyMap.get(p.date) ?? null }));
  }, [data]);

  return (
    <section className="mb-7">
      <div className="flex items-center gap-2 mb-2.5">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">거시 신용 스트레스</h2>
        <span className="text-[11px] text-muted-foreground">신용 스프레드 = 실시간 시장 부실 프록시 · 넓어질수록 우려↑</span>
      </div>

      {isLoading && <Skeleton className="h-40" />}
      {error && <div className="text-[12px] text-red-500">스트레스 지표 로드 실패: {String((error as Error).message)}</div>}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {data.series.map((s) => <MacroCard key={s.id} s={s} />)}
          </div>

          {/* CCC vs HY 다이버전스 차트 */}
          {merged.length > 1 && (
            <Card className="mt-3 p-3">
              <div className="flex items-center gap-3 mb-1 text-[11px] flex-wrap">
                <span className="font-medium">CCC vs HY 스프레드 (최근 3년)</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: CCC_COL }} />CCC & Lower</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: HY_COL }} />High Yield</span>
                <span className="text-muted-foreground/70 ml-auto">둘의 간격이 벌어지면 = 최고위험 신용만 악화(부실 조기신호)</span>
              </div>
              <ResponsiveContainer width="100%" height={170}>
                <LineChart data={merged} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => String(d).slice(2, 7)} minTickGap={40} stroke="#8b949e" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#8b949e" width={34} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }}
                    labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                    formatter={(v: any, name: any) => [`${v}%`, name === "ccc" ? "CCC" : "HY"]}
                  />
                  <ReferenceLine y={0} stroke="transparent" />
                  <Line type="monotone" dataKey="ccc" stroke={CCC_COL} dot={false} strokeWidth={1.8} />
                  <Line type="monotone" dataKey="hy" stroke={HY_COL} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}
          <div className="text-[10.5px] text-muted-foreground/70 mt-1.5">출처 {data.source} · 키 불요 공개 CSV · 6시간 캐시</div>
        </>
      )}
    </section>
  );
}

export default function Clo() {
  const { data, isLoading, error } = useQuery<Overview>({
    queryKey: ["/api/clo/overview"],
    queryFn: async () => (await apiRequest("GET", "/api/clo/overview")).json(),
  });
  const [sel, setSel] = useState<string | null>(null);

  const etfs = data?.etfs ?? [];
  const selEtf = useMemo(() => etfs.find((e) => e.etf === sel) ?? etfs[0], [etfs, sel]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-5 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" /> CLO 모니터
        </h1>
        <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
          라이브 프리뷰 · DB 미사용
        </span>
        <span className="text-xs text-muted-foreground">운용사 공개 홀딩스 + SEC N-PORT · CUSIP 조인</span>
      </header>

      {/* 부실 대시보드가 리드 (v2) */}
      <MacroStrip />

      {/* 스캐폴드: 보유 딜 유니버스 — 부실 신호 아님, 향후 딜별 CCC/OC 부착용 뼈대 */}
      <div className="flex items-center gap-2 mb-2">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">보유 딜 유니버스 <span className="text-[11px] font-normal text-muted-foreground">· 스캐폴드</span></h2>
        <span className="text-[11px] text-muted-foreground">ETF가 담은 CLO 트랜치 · CUSIP↔N-PORT 검증 · 부실지표(CCC/OC) 부착 예정</span>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      )}
      {error && <div className="text-sm text-red-500">불러오기 실패: {String((error as Error).message)}</div>}

      {data && (
        <>
          {/* ETF 요약 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {etfs.map((e) => (
              <EtfCard key={e.etf} e={e} selected={selEtf?.etf === e.etf} onSelect={() => setSel(e.etf)} />
            ))}
          </div>

          {/* 선택 ETF 딜 유니버스 */}
          {selEtf && selEtf.holdings.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-2.5 border-b flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{selEtf.etf} 딜 유니버스</span>
                <span className="text-[11px] text-muted-foreground">{selEtf.holdingsCount}개 트랜치 · 시가총액 순</span>
                {selEtf.join && (
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    N-PORT 매치 <b style={{ color: AAA }}>{selEtf.join.matched}</b> ·
                    신규(시차) <b style={{ color: MISS }}>{selEtf.join.csvOnly}</b>
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-[11px] text-muted-foreground border-b">
                      <th className="text-left font-medium px-4 py-1.5 w-8">#</th>
                      <th className="text-left font-medium px-2 py-1.5">딜 (트랜치)</th>
                      <th className="text-left font-medium px-2 py-1.5">CUSIP</th>
                      <th className="text-right font-medium px-2 py-1.5">시가</th>
                      <th className="text-right font-medium px-2 py-1.5">비중</th>
                      <th className="text-center font-medium px-4 py-1.5">N-PORT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selEtf.holdings.map((h, i) => (
                      <tr key={h.cusip + i} className="border-b border-border/40 hover:bg-muted/30">
                        <td className="px-4 py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="px-2 py-1.5 font-medium">{h.dealName}</td>
                        <td className="px-2 py-1.5 font-mono text-[11.5px] text-muted-foreground">{h.cusip}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(h.marketValue)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{h.weightPct ? `${h.weightPct}%` : "—"}</td>
                        <td className="px-4 py-1.5 text-center">
                          {h.inNport
                            ? <CheckCircle2 className="h-3.5 w-3.5 inline" style={{ color: AAA }} />
                            : <span className="text-[10px]" style={{ color: MISS }}>신규</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="mt-4 text-[11px] text-muted-foreground/70">
            생성 {new Date(data.generatedAt).toLocaleString("ko-KR")} · 30분 캐시 ·
            PAAA·CLOZ 는 URL 확정 후 추가 예정
          </div>
        </>
      )}
    </div>
  );
}
