import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { fmtMoney, tickerColor, koSector, koCompany } from "@/lib/congress";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserSearch, ChevronRight, ChevronLeft, ChevronDown, ArrowLeft } from "lucide-react";

const BUY = "#3fb950";
const SELL = "#f85149";

interface RankRow {
  symbol: string; company: string | null; sector: string | null;
  buyValue: number; sellValue: number; netValue: number;
  buyCount: number; sellCount: number; insiderCount: number; otherInsiderCount: number; tradeCount: number;
}
interface ITrade {
  id: number; insiderId: number; insiderName: string; insiderSlug: string;
  symbol: string; company: string | null; txnCode: string | null; side: string;
  shares: number | null; price: number | null; value: number | null; txnDate: number; filedDate: number | null;
  role: string | null;
  plan10b5: boolean | null; // true=10b5-1 정기플랜(노이즈) / false=재량적(시그널) / null=미확인
}
interface ClusterParticipant { slug: string; name: string; role: string | null; value: number; trades: number; qty: number; sharesAfter: number | null; pctOfHoldings: number | null }
interface Cluster {
  symbol: string; company: string | null; sector: string | null;
  side: "buy" | "sell"; insiderCount: number; tradeCount: number; totalValue: number;
  windowFromMs: number; windowToMs: number; spanDays: number;
  participants: ClusterParticipant[]; score: number; thin: boolean; gated: boolean;
}

const SIDE_KO: Record<string, string> = { buy: "매수", sell: "매도", award: "보상", exercise: "옵션행사", tax: "세금", gift: "증여", conversion: "전환", other: "기타" };
const sectorLabel = (s: string | null) => koSector(s) || "";
const fmtShares = (n: number | null) => (n == null ? "—" : n.toLocaleString());
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ----- 직책(role) → 시그널 티어 분류 -----
// 핵심: 색 = "시그널 티어(정보 접근도)" 한 축만 인코딩, 라벨 = 구체 직책. (역할-식별과 시그널을 색에 섞지 않음)
//   T1 전사·재무 시야: CEO·회장, CFO        T2 운영 임원: COO, (운영)President, CTO, 사업부장  ← 시그널 큼
//   T3 기능 임원: CAO/PAO/Controller, GC/CLO, CHRO, CMO, 기타 C-suite, EVP/SVP/VP
//   T4 이사(Director): 노이즈 최다
//   대주주(10%+): 창업자·VC·행동주의 → 직책과 독립적인 고시그널 태그 (Director에 묻지 않음)
//   미확인: See Remarks / 역할 결측 → 회색 임원과 섞지 않고 별도 표기
type Tier = 1 | 2 | 3 | 4;
const TIER_META: Record<Tier, { name: string; cls: string }> = {
  1: { name: "전사·재무", cls: "bg-rose-500/20 text-rose-200 border-rose-400/50" },
  2: { name: "운영 임원", cls: "bg-amber-500/20 text-amber-200 border-amber-400/50" },
  3: { name: "기능 임원", cls: "bg-slate-500/20 text-slate-300 border-slate-400/40" },
  4: { name: "이사", cls: "bg-zinc-700/40 text-zinc-400 border-zinc-600/50" },
};
const OWNER_CLS = "bg-violet-500/20 text-violet-200 border-violet-400/50";
const UNCONF_CLS = "border-dashed border-muted-foreground/40 text-muted-foreground/80 bg-transparent";

// 우선순위 순서(위에서 먼저 매칭 = primary). 복합 직책은 최상위 시그널이 대표.
const ROLE_RULES: { tier: Tier; label: string; test: (r: string) => boolean }[] = [
  { tier: 1, label: "CEO·회장", test: (r) => /\bceo\b/i.test(r) || /chief executive/i.test(r) || /chair(man|person|woman)?\b/i.test(r) },
  { tier: 1, label: "CFO", test: (r) => /\bcfo\b/i.test(r) || /chief financial/i.test(r) },
  { tier: 2, label: "COO", test: (r) => /\bcoo\b/i.test(r) || /chief operating/i.test(r) },
  { tier: 2, label: "CTO", test: (r) => /\bcto\b/i.test(r) || /chief technology/i.test(r) },
  { tier: 2, label: "President", test: (r) => /\bpresident\b/i.test(r) && !/vice[\s-]*president/i.test(r) },
  { tier: 3, label: "법무(GC)", test: (r) => /\bclo\b/i.test(r) || /chief legal/i.test(r) || /general counsel/i.test(r) || /\bcounsel\b/i.test(r) },
  { tier: 3, label: "회계(CAO)", test: (r) => /\bcao\b/i.test(r) || /\bpao\b/i.test(r) || /chief accounting/i.test(r) || /principal accounting/i.test(r) || /controller/i.test(r) },
  { tier: 3, label: "CHRO", test: (r) => /\bchro\b/i.test(r) || /chief (human|people)/i.test(r) },
  { tier: 3, label: "CMO", test: (r) => /\bcmo\b/i.test(r) || /chief marketing/i.test(r) },
  { tier: 3, label: "C-임원", test: (r) => /chief\s+[\w\s]+\bofficer\b/i.test(r) },
  { tier: 3, label: "임원", test: (r) => /\b(?:e|s)?vp\b/i.test(r) || /vice\s*president/i.test(r) || /\bofficer\b/i.test(r) },
  { tier: 4, label: "이사", test: (r) => /\bdirector\b/i.test(r) },
];

interface RoleClass { primary?: { tier: Tier; label: string }; owner: boolean; unconfirmed: boolean; raw: string }
function classifyRole(role: string | null): RoleClass | null {
  if (role == null) return null; // 아직 미보강
  const raw = role.trim();
  if (!raw) return { owner: false, unconfirmed: true, raw: "" }; // 빈 role = 역할 결측
  const owner = /10\s*%/.test(raw);
  if (/see\s*remarks/i.test(raw)) return { owner, unconfirmed: true, raw }; // See Remarks = 역할 결측(미확인)
  let primary: { tier: Tier; label: string } | undefined;
  for (const rule of ROLE_RULES) if (rule.test(raw)) { primary = { tier: rule.tier, label: rule.label }; break; }
  return { primary, owner, unconfirmed: false, raw };
}

function RoleBadges({ role, className = "" }: { role: string | null; className?: string }) {
  const c = classifyRole(role);
  if (!c) return null;
  const chips: { key: string; label: string; cls: string }[] = [];
  if (c.unconfirmed) chips.push({ key: "unconf", label: "미확인", cls: UNCONF_CLS });
  else if (c.primary) {
    // Director(T4)인데 대주주면 Director는 묻고 대주주를 대표로 (창업자·VC·행동주의)
    if (!(c.primary.tier === 4 && c.owner)) chips.push({ key: "role", label: c.primary.label, cls: TIER_META[c.primary.tier].cls });
  } else if (!c.owner) chips.push({ key: "raw", label: c.raw.length > 18 ? c.raw.slice(0, 18) + "…" : c.raw, cls: TIER_META[3].cls });
  if (c.owner) chips.push({ key: "owner", label: "대주주", cls: OWNER_CLS });
  if (!chips.length) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`} title={c.raw || "역할 미확인(See Remarks/결측)"}>
      {chips.map((ch) => <span key={ch.key} className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${ch.cls}`}>{ch.label}</span>)}
    </span>
  );
}

// 티어 색상 범례 (한 줄)
function TierLegend() {
  const items = [
    { label: "전사·재무", cls: TIER_META[1].cls }, { label: "운영", cls: TIER_META[2].cls },
    { label: "기능", cls: TIER_META[3].cls }, { label: "이사", cls: TIER_META[4].cls },
    { label: "대주주", cls: OWNER_CLS }, { label: "미확인", cls: UNCONF_CLS },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1 mb-2.5">
      <span className="text-[10px] text-muted-foreground mr-0.5">직책 티어(시그널 순):</span>
      {items.map((i) => <span key={i.label} className={`text-[9.5px] font-bold border rounded px-1.5 py-0.5 ${i.cls}`}>{i.label}</span>)}
    </div>
  );
}

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

// 한 종목 상세에서 인사이더별로 묶기 (조건자로 부분집합 선택, 금액 내림차순)
interface InsiderGroup { name: string; slug: string; role: string | null; value: number; shares: number; n: number }
function groupRows(trades: ITrade[], pred: (t: ITrade) => boolean): InsiderGroup[] {
  const m = new Map<string, InsiderGroup>();
  for (const t of trades) {
    if (!pred(t)) continue;
    const e = m.get(t.insiderSlug) || { name: t.insiderName, slug: t.insiderSlug, role: null, value: 0, shares: 0, n: 0 };
    e.value += t.value || 0; e.shares += t.shares || 0; e.n++;
    if (!e.role && t.role) e.role = t.role;
    m.set(t.insiderSlug, e);
  }
  return [...m.values()].sort((a, b) => b.value - a.value);
}

interface Ctx { openInsider: (slug: string, name: string) => void; openTicker: (sym: string) => void; }

function InsiderRow({ r, color, sign, ctx }: { r: InsiderGroup; color: string; sign: "+" | "−"; ctx: Ctx }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0 cursor-pointer rounded hover:bg-muted/40 px-1" onClick={() => ctx.openInsider(r.slug, r.name)} title={`${r.name}${r.role ? ` · ${r.role}` : ""} 거래 보기`}>
      <span className="font-semibold text-[13px] shrink-0">{r.name}</span>
      <RoleBadges role={r.role} />
      <ChevronRight className="h-3 w-3 text-primary shrink-0" />
      <span className="ml-auto text-[12px] text-muted-foreground tabular-nums shrink-0">{fmtShares(r.shares)}주</span>
      <span className="text-[12.5px] font-bold tabular-nums shrink-0" style={{ color }}>{sign}{fmtMoney(r.value)}</span>
    </div>
  );
}

// 인사이더 그룹 박스 — 강조(기본) 또는 흐림·접힘(collapsible) 모드
function InsiderListBox({ title, subtitle, color, sign, rows, ctx, dim, collapsible, testid }: {
  title: string; subtitle?: string; color: string; sign: "+" | "−"; rows: InsiderGroup[]; ctx: Ctx; dim?: boolean; collapsible?: boolean; testid?: string;
}) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <div className={`rounded-lg border bg-background/50 ${dim ? "opacity-75" : ""}`} style={{ borderLeft: `3px solid ${color}` }}>
      <div
        className={`flex items-center gap-1.5 px-2.5 pt-2.5 ${open ? "pb-1.5" : "pb-2.5"} ${collapsible ? "cursor-pointer hover:bg-muted/20 rounded-lg" : ""}`}
        onClick={collapsible ? () => setOpen((o) => !o) : undefined}
        data-testid={testid}
      >
        {collapsible && <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} style={{ color }} />}
        <span className="text-xs font-bold" style={{ color }}>{title} ({rows.length})</span>
        {subtitle && <span className="text-[10.5px] font-normal text-muted-foreground ml-1">{subtitle}</span>}
        {collapsible && !open && <span className="ml-auto text-[10.5px] text-muted-foreground/70">펼치기</span>}
      </div>
      {open && (
        <div className="px-2.5 pb-2.5">
          {rows.length === 0 && <div className="text-xs text-muted-foreground">없음</div>}
          {rows.map((r) => <InsiderRow key={r.slug} r={r} color={color} sign={sign} ctx={ctx} />)}
        </div>
      )}
    </div>
  );
}

// 보상·옵션행사·세금 등 비(非)매매 거래 — 기본 접힘, 클릭 시 인사이더별 상세
function OtherTradesBox({ trades, ctx }: { trades: ITrade[]; ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const others = trades.filter((t) => t.side !== "buy" && t.side !== "sell");
  if (!others.length) return null;
  const byInsider = new Map<string, { name: string; slug: string; role: string | null; list: ITrade[] }>();
  for (const t of others) {
    const e = byInsider.get(t.insiderSlug) || { name: t.insiderName, slug: t.insiderSlug, role: null, list: [] };
    e.list.push(t);
    if (!e.role && t.role) e.role = t.role;
    byInsider.set(t.insiderSlug, e);
  }
  const groups = [...byInsider.values()].sort((a, b) => b.list.length - a.list.length);
  return (
    <div className="rounded-lg border bg-background/50" style={{ borderLeft: "3px solid #8b949e" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-bold text-muted-foreground hover:bg-muted/30 rounded-lg"
        data-testid="toggle-other-trades"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
        ⚪ 보상·옵션행사·세금 등
        <span className="font-normal">({groups.length}명 · {others.length}건)</span>
        <span className="ml-auto font-normal text-[10.5px] text-muted-foreground/70">매매 신호 아님 · 펼치기</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {groups.map((g) => (
            <div key={g.slug} className="border-t border-border/50 pt-2">
              <div className="flex items-center gap-1.5 cursor-pointer rounded hover:bg-muted/40 px-1 py-0.5" onClick={() => ctx.openInsider(g.slug, g.name)} title={`${g.name} 거래 보기`}>
                <span className="font-semibold text-[13px]">{g.name}</span>
                <RoleBadges role={g.role} />
                <ChevronRight className="h-3 w-3 text-primary shrink-0" />
                <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{g.list.length}건</span>
              </div>
              <div className="mt-1 ml-1">
                {[...g.list].sort((a, b) => b.txnDate - a.txnDate).map((t) => (
                  <div key={t.id} className="grid items-center gap-2 py-0.5 text-[11.5px] text-muted-foreground" style={{ gridTemplateColumns: "78px 60px 1fr 84px" }}>
                    <span className="tabular-nums">{ymd(t.txnDate)}</span>
                    <span><span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-muted/60 text-muted-foreground">{SIDE_KO[t.side] || t.side}</span></span>
                    <span className="tabular-nums">{fmtShares(t.shares)}주{t.price ? ` @ $${t.price.toFixed(2)}` : ""}</span>
                    <span className="text-right tabular-nums">{t.value ? fmtMoney(t.value) : "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----- 클러스터 시그널 위젯 (메인) -----
const pctLabel = (r: number) => (r >= 1 ? "100%+" : `${Math.round(r * 100)}%`);
const pctCls = (r: number) => (r > 0.5 ? "bg-amber-500/20 text-amber-200 font-bold" : r >= 0.1 ? "text-muted-foreground" : "text-muted-foreground/50");

function ClusterCard({ c, onPick }: { c: Cluster; onPick: (sym: string) => void }) {
  const isBuy = c.side === "buy";
  const color = isBuy ? BUY : SELL;
  return (
    <div onClick={() => onPick(c.symbol)} className="shrink-0 w-[244px] rounded-lg border p-3 cursor-pointer hover:border-primary bg-background/50" style={{ borderLeft: `3px solid ${color}` }} data-testid={`cluster-${c.symbol}-${c.side}`}>
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded" style={{ background: tickerColor(c.symbol) }} />
        <span className="font-bold text-sm">{c.symbol}</span>
        <span className="text-[10px] text-muted-foreground truncate max-w-[64px]">{sectorLabel(c.sector)}</span>
        {c.thin && <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground/80 shrink-0" title="2인 클러스터 — 합의 증거 약함, 점수 페널티">얇음</span>}
        {c.gated && <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-700/50 text-zinc-400 shrink-0" title="다수 동시 전량청산(post=0 ≥3) — 구조적 이벤트 의심, 점수 게이트">구조적?</span>}
        <span className="ml-auto text-2xl font-bold tabular-nums shrink-0" style={{ color }}>{c.insiderCount}<span className="text-[11px] font-normal">명</span></span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">{c.spanDays}일 · {fmtMoney(c.totalValue)} · {ymd(c.windowFromMs)}~{ymd(c.windowToMs)}</div>
      <div className="mt-2 space-y-1">
        {c.participants.slice(0, 4).map((p) => (
          <div key={p.slug} className="flex items-center gap-1 text-[11px]">
            <span className="truncate max-w-[78px] shrink-0">{p.name}</span>
            <RoleBadges role={p.role} />
            <span className="ml-auto flex items-center gap-1 shrink-0">
              {p.pctOfHoldings != null && <span className={`text-[9.5px] tabular-nums px-1 rounded ${pctCls(p.pctOfHoldings)}`} title="보유 대비 거래 비중">{pctLabel(p.pctOfHoldings)}</span>}
              <span className="text-[10px] tabular-nums text-muted-foreground/80">{fmtMoney(p.value)}</span>
            </span>
          </div>
        ))}
        {c.participants.length > 4 && <div className="text-[10px] text-muted-foreground">+{c.participants.length - 4}명 더</div>}
      </div>
    </div>
  );
}

function ClusterSection({ title, subtitle, accent, clusters, onPick }: { title: string; subtitle: string; accent: string; clusters: Cluster[]; onPick: (sym: string) => void }) {
  if (!clusters.length) return null;
  return (
    <Card className="p-4">
      <div className="flex items-baseline gap-2 mb-2 flex-wrap">
        <h2 className="text-sm font-semibold" style={{ color: accent }}>{title} <span className="text-xs font-normal text-muted-foreground">· {clusters.length}건</span></h2>
        <span className="text-[11.5px] text-muted-foreground">{subtitle}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {clusters.map((c) => <ClusterCard key={c.symbol + c.side} c={c} onPick={onPick} />)}
      </div>
    </Card>
  );
}

function ClusterWidget({ from, to, onPick }: { from?: number; to?: number; onPick: (sym: string) => void }) {
  const { data } = useQuery<Cluster[]>({
    queryKey: ["/api/insider/clusters", from, to],
    queryFn: async () => (await apiRequest("GET", `/api/insider/clusters${from ? `?from=${from}&to=${to}` : ""}`)).json(),
  });
  const clusters = data ?? [];
  if (!clusters.length) return null;
  const buys = clusters.filter((c) => c.side === "buy");
  const sells = clusters.filter((c) => c.side === "sell");
  return (
    <div className="mb-5 space-y-3">
      <div className="text-[11px] text-muted-foreground">🔥 클러스터 시그널 — 같은 ~30일 윈도우에 다수 인사이더가 같은 방향. 점수 = 티어(정보접근도) × <b>보유 대비 비중</b> × 절대규모(바닥필터). 10b5-1 플랜 매도 제외. 카드의 % = 보유 대비 거래 비중.</div>
      <ClusterSection title="🟢 매수 클러스터" subtitle="누가 베팅하나 — 기회 탐색" accent={BUY} clusters={buys} onPick={onPick} />
      <ClusterSection title="🔴 매도 클러스터" subtitle="누가 빠져나가나 — 리스크 경보" accent={SELL} clusters={sells} onPick={onPick} />
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
        <div>
          <div className="text-lg font-bold tabular-nums">{row.insiderCount}명</div>
          <div className="text-[11px] text-muted-foreground">매수·매도 인사이더{row.otherInsiderCount > 0 && <span className="ml-1 text-muted-foreground/70">· 보상·옵션 {row.otherInsiderCount}명</span>}</div>
        </div>
      </div>
      {isLoading ? <Skeleton className="h-40 w-full" /> : (
        <div className="grid gap-3">
          <TierLegend />
          <InsiderListBox title="🟢 매수한 인사이더" color={BUY} sign="+" rows={groupRows(list, (t) => t.side === "buy")} ctx={ctx} />
          <InsiderListBox title="🔴 재량적 매도" subtitle="플랜 없는 자발적 매도 · 진짜 시그널" color={SELL} sign="−" rows={groupRows(list, (t) => t.side === "sell" && t.plan10b5 !== true)} ctx={ctx} />
          {list.some((t) => t.side === "sell" && t.plan10b5 === true) && (
            <InsiderListBox title="🔇 10b5-1·정기 매도" subtitle="사전 약정 매도 · 노이즈" color="#8b949e" sign="−" rows={groupRows(list, (t) => t.side === "sell" && t.plan10b5 === true)} ctx={ctx} dim collapsible testid="toggle-plan-sells" />
          )}
          <OtherTradesBox trades={list} ctx={ctx} />
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
          <RoleBadges role={list.find((t) => t.role)?.role ?? null} />
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
        <>
        <ClusterWidget from={from} to={to} onPick={(s) => setSelSymbol(s)} />
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
        </>
      )}
    </div>
  );
}
