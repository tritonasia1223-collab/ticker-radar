import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { SectorMapRow, SectorStock, sectorLabel, shortCompanyName, changeColorClass } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Treemap, ResponsiveContainer } from "recharts";
import { Layers, ChevronRight } from "lucide-react";

// Tile color encodes mention surge (recent vs prior window), not price. Direction follows
// each market's convention: US = green up / red down; KR = red up / blue down. Slate = 잠잠.
const RED = (p: number) => (p >= 100 ? "#b91c1c" : p >= 40 ? "#dc2626" : "#ef4444");
const GREEN = (p: number) => (p >= 100 ? "#15803d" : p >= 40 ? "#16a34a" : "#22c55e");
const BLUE = (p: number) => (p <= -100 ? "#1d4ed8" : p <= -40 ? "#2563eb" : "#3b82f6");
const SLATE = "#475569";
function tileColor(pct: number, market: string): string {
  if (pct > -10 && pct < 10) return SLATE; // 잠잠
  const up = pct >= 0;
  if (market === "kr") return up ? RED(pct) : BLUE(pct);
  return up ? GREEN(pct) : RED(-pct); // US: down = red, intensity by magnitude
}

function stockName(s: SectorStock): string {
  return s.nameKo || shortCompanyName(s.nameEn) || `$${s.symbol}`;
}

// Custom treemap tile: filled rect + label/△% when it's big enough to read.
function TreeCell(props: any) {
  const { x, y, width, height, sector, changePercent, recentMentions, market } = props;
  if (width <= 0 || height <= 0 || sector == null) return null;
  const fill = tileColor(changePercent ?? 0, market);
  const showText = width > 50 && height > 26;
  return (
    <g style={{ cursor: "pointer" }}>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="hsl(var(--background))" strokeWidth={2} rx={3} />
      {showText && (
        <>
          <text x={x + 7} y={y + 17} fontSize={12} fontWeight={600} fill="#fff">{sectorLabel(sector)}</text>
          {height > 40 && (
            <text x={x + 7} y={y + 32} fontSize={10} fill="rgba(255,255,255,0.85)">
              {(changePercent ?? 0) >= 0 ? "+" : ""}{changePercent}% · {recentMentions}회
            </text>
          )}
        </>
      )}
    </g>
  );
}

export default function SectorTreemap({
  market, windowHours, onPickStock,
}: { market: string; windowHours: string; onPickStock: (s: SectorStock) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading } = useQuery<SectorMapRow[]>({
    queryKey: ["/api/sector-map", windowHours, market],
    queryFn: async () => (await apiRequest("GET", `/api/sector-map?windowHours=${windowHours}&market=${market}`)).json(),
  });
  const rows = Array.isArray(data) ? data : [];
  // selected tile defaults to the biggest sector so the drill-down is never empty.
  const activeSector = selected && rows.some((r) => r.sector === selected) ? selected : rows[0]?.sector ?? null;
  const active = rows.find((r) => r.sector === activeSector) ?? null;

  if (isLoading) return <Skeleton className="h-64 w-full mb-4" />;
  if (rows.length === 0) return null;

  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Layers className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-medium">섹터 지형</h2>
        <span className="text-xs text-muted-foreground">타일 크기 = 언급량 · 색 = 급상승도 · 클릭하면 새로 뜨는 종목</span>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* treemap */}
        <div className="md:col-span-2 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={rows}
              dataKey="recentMentions"
              isAnimationActive={false}
              content={<TreeCell market={market} />}
              onClick={(node: any) => {
                const sec = node?.sector ?? node?.payload?.sector;
                if (sec) setSelected(sec);
              }}
            />
          </ResponsiveContainer>
        </div>

        {/* drill-down: newly-rising stocks in the active sector */}
        <div className="md:col-span-1 min-w-0">
          {active && (
            <>
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-sm font-semibold truncate">{sectorLabel(active.sector)}</div>
                <div className="text-xs text-muted-foreground shrink-0 ml-2">
                  {active.recentAccounts}명 · {active.recentMentions}회
                </div>
              </div>
              <div className="space-y-1 max-h-56 overflow-auto pr-1">
                {active.stocks.slice(0, 12).map((s) => (
                  <button
                    key={s.symbol}
                    onClick={() => onPickStock(s)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover-elevate text-left"
                    data-testid={`sector-stock-${s.symbol}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate leading-tight">{stockName(s)}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">{s.recentAccounts}명 · {s.recentMentions}회</div>
                    </div>
                    <span className={`text-xs tabular-nums shrink-0 ${changeColorClass(s.changePercent, market)}`}>
                      {s.changePercent >= 0 ? "+" : ""}{s.changePercent}%
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
