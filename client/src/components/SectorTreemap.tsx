import { useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { SectorMapRow, SectorStock, sectorLabel, shortCompanyName, surgeStatus, statusColorClass } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Treemap, ResponsiveContainer } from "recharts";
import { Layers, ChevronRight, X } from "lucide-react";

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

// Custom treemap tile: filled rect + sector name + emoji status (🔥급증 / 🆕신규 …) so the
// surge is readable at a glance, not just from the tile color. Detail scales with tile size.
function TreeCell(props: any) {
  const { x, y, width, height, sector, changePercent, recentMentions, priorMentions, market } = props;
  if (width <= 0 || height <= 0 || sector == null) return null;
  const fill = tileColor(changePercent ?? 0, market);
  const st = surgeStatus(recentMentions ?? 0, priorMentions ?? 0);
  const showName = width > 50 && height > 24;
  const showStatus = width > 58 && height > 44;
  const showCount = width > 96;
  return (
    <g style={{ cursor: "pointer" }}>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="hsl(var(--background))" strokeWidth={2} rx={3} />
      {showName && <text x={x + 7} y={y + 18} fontSize={12} fontWeight={700} fill="#fff">{sectorLabel(sector)}</text>}
      {showStatus && (
        <text x={x + 7} y={y + 37} fontSize={12} fontWeight={600} fill="#fff" opacity={st.dim ? 0.65 : 1}>
          {st.emoji ? <tspan fontSize={15}>{st.emoji} </tspan> : null}
          <tspan>{st.label}{showCount ? ` · ${recentMentions}회` : ""}</tspan>
        </text>
      )}
    </g>
  );
}

export default function SectorTreemap({
  market, windowHours, onPickStock,
}: { market: string; windowHours: string; onPickStock: (s: SectorStock) => void }) {
  // a clicked tile: which sector + the tile's pixel rect (for anchoring the floating card)
  const [picked, setPicked] = useState<{ sector: string; x: number; y: number; w: number; h: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useQuery<SectorMapRow[]>({
    queryKey: ["/api/sector-map", windowHours, market],
    queryFn: async () => (await apiRequest("GET", `/api/sector-map?windowHours=${windowHours}&market=${market}`)).json(),
  });
  const rows = Array.isArray(data) ? data : [];
  const active = picked && rows.find((r) => r.sector === picked.sector) || null;

  if (isLoading) return <Skeleton className="h-72 w-full mb-4" />;
  if (rows.length === 0) return null;

  // Anchor the floating card beside the clicked tile, clamped inside the treemap box.
  const CARD_W = 260, CARD_H = 300;
  let cardStyle: CSSProperties = {};
  if (picked) {
    const box = wrapRef.current;
    const W = box?.clientWidth ?? 800, H = box?.clientHeight ?? 320;
    // prefer to the right of the tile; flip left if it would overflow
    let left = picked.x + picked.w + 8;
    if (left + CARD_W > W) left = picked.x - CARD_W - 8;
    left = Math.max(4, Math.min(left, W - CARD_W - 4));
    let top = Math.min(picked.y, H - CARD_H - 4);
    top = Math.max(4, top);
    cardStyle = { left, top, width: CARD_W, maxHeight: CARD_H };
  }

  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Layers className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-medium">섹터 지형</h2>
        <span className="text-xs text-muted-foreground">타일 크기 = 언급량 · 색 = 급상승도 · 클릭하면 새로 뜨는 종목</span>
      </div>

      {/* full-width treemap; floating card overlays it on tile click */}
      <div ref={wrapRef} className="relative h-72 md:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={rows}
            dataKey="recentMentions"
            isAnimationActive={false}
            content={<TreeCell market={market} />}
            onClick={(node: any) => {
              const sec = node?.sector ?? node?.payload?.sector;
              if (sec) setPicked({ sector: sec, x: node.x ?? 0, y: node.y ?? 0, w: node.width ?? 0, h: node.height ?? 0 });
            }}
          />
        </ResponsiveContainer>

        {active && (
          <div
            className="absolute z-20 rounded-lg border bg-popover text-popover-foreground shadow-xl flex flex-col animate-in fade-in zoom-in-95 duration-150"
            style={cardStyle}
          >
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{sectorLabel(active.sector)}</div>
                <div className="text-[11px] text-muted-foreground">{active.recentAccounts}명 · {active.recentMentions}회</div>
              </div>
              <button onClick={() => setPicked(null)} className="shrink-0 text-muted-foreground hover:text-foreground" data-testid="sector-popover-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-auto p-1">
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
                  {(() => { const st = surgeStatus(s.recentMentions, s.priorMentions); return (
                    <span className={`text-xs shrink-0 whitespace-nowrap ${statusColorClass(st.tone, market)} ${st.dim ? "opacity-40" : ""}`}>{st.emoji} {st.label}</span>
                  ); })()}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
