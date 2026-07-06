import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { fmtMoney } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Layers, ExternalLink, CheckCircle2, AlertTriangle } from "lucide-react";

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

const AAA = "#3fb950"; // 매치=초록
const MISS = "#8b949e"; // 미매치=회색

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

      <p className="text-[12px] text-muted-foreground mb-4 leading-relaxed max-w-3xl">
        Phase 0 프로브로 검증한 데이터 경로를 <b>요청 시점에 직접 조인</b>해 보여줍니다(테이블·수집기 없음).
        각 ETF 홀딩스(CUSIP 포함)를 운용사 페이지에서 가져와 SEC N-PORT 와 대조 —{" "}
        <span style={{ color: AAA }}>초록</span>은 N-PORT 에도 있는 트랜치, <span style={{ color: MISS }}>회색</span>은
        분기말 이후 신규 편입(시차) 추정. 영구 스냅샷 시계열은 Gate A(3영업일 안정성) 통과 후 구축.
      </p>

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
