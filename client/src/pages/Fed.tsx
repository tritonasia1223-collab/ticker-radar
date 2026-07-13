import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceArea, Cell,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown } from "lucide-react";

// server/fed.ts 의 응답 형태(모든 수치 million USD, SP500 은 지수).
interface WeekPoint {
  date: string; total: number;
  treast: number; mbs: number; agency: number; soma: number;
  discount: number; btfp: number; repo: number; swap: number; loans: number; assetResidual: number;
  reserves: number; rrp: number; tga: number; currency: number; liabResidual: number;
}
interface DailyPoint { date: string; netLiq: number; sp500: number | null }
interface Overview { weeks: WeekPoint[]; daily: DailyPoint[]; updatedAt: string }

// ── 색 ── 자산=teal 3단 / 부채=purple + 현금·기타=gray (계획서 §7.2)
const A_SOMA = "#0d9488", A_LOAN = "#2dd4bf", A_RESID = "#99f6e4";
const L_RES = "#7c3aed", L_RRP = "#a855f7", L_TGA = "#d8b4fe", L_CUR = "#9ca3af", L_RESID = "#6b7280";
const POS = "#16a34a", NEG = "#dc2626";
const LEND = { discount: "#f59e0b", btfp: "#ef4444", repo: "#3b82f6", swap: "#8b5cf6" };

// 국면 주석(스크러버 컨텍스트 · 차트 밴드)
const PHASES = [
  { date: "2008-11-25", label: "QE1" }, { date: "2010-11-03", label: "QE2" }, { date: "2012-09-13", label: "QE3" },
  { date: "2013-05-22", label: "테이퍼" }, { date: "2017-10-01", label: "QT1" }, { date: "2019-09-17", label: "레포위기" },
  { date: "2020-03-15", label: "무제한QE" }, { date: "2022-06-01", label: "QT2" }, { date: "2023-03-12", label: "SVB/BTFP" },
];

// ── musd 포맷 ──
const T = (v: number) => `$${(v / 1e6).toFixed(2)}T`;
const asMoney = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${v < 0 ? "−" : ""}$${(a / 1e6).toFixed(2)}T`;
  if (a >= 1e3) return `${v < 0 ? "−" : ""}$${(a / 1e3).toFixed(0)}B`;
  return `${v < 0 ? "−" : ""}$${a.toFixed(0)}M`;
};
const signed = (v: number) => (v >= 0 ? "+" : "−") + asMoney(Math.abs(v));
const yr = (d: string) => d.slice(0, 4);
const nearestIdx = (weeks: WeekPoint[], date: string) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < weeks.length; i++) { const d = Math.abs(+new Date(weeks[i].date) - +new Date(date)); if (d < bd) { bd = d; best = i; } }
  return best;
};

// ── 헤드라인 카드 ──
function Stat({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: number }) {
  return (
    <Card className="p-3.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-[11px]">
        {delta != null && (
          <span className={`flex items-center gap-0.5 tabular-nums font-medium ${delta >= 0 ? "text-emerald-500" : "text-red-500"}`}>
            {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {signed(delta)}
          </span>
        )}
        {sub && <span className="text-muted-foreground">{sub}</span>}
      </div>
    </Card>
  );
}

// ── T-계정 한쪽 컬럼(스택) ──
interface Seg { label: string; val: number; color: string; sub?: [string, number][] }
function StackColumn({ segs, total, maxTotal, mode, align }: {
  segs: Seg[]; total: number; maxTotal: number; mode: "abs" | "pct"; align: "left" | "right";
}) {
  const H = 360;
  return (
    <div className="relative flex flex-col justify-end" style={{ height: H }}>
      {segs.map((s, i) => {
        const frac = mode === "pct" ? s.val / total : s.val / maxTotal;
        const h = Math.max(0, frac * H);
        const showLabel = h >= 22 && s.val > 0;
        const title = `${s.label} ${asMoney(s.val)}${s.sub ? "\n" + s.sub.map(([n, v]) => `  ${n} ${asMoney(v)}`).join("\n") : ""}`;
        return (
          <div key={i} title={title} style={{ height: h, background: s.color }}
            className={`flex items-center ${align === "right" ? "justify-end pr-2" : "pl-2"} overflow-hidden border-t border-black/10 first:border-t-0`}>
            {showLabel && (
              <span className="text-[10.5px] font-medium text-white/95 tabular-nums whitespace-nowrap drop-shadow">
                {s.label} · {asMoney(s.val)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TAccount({ w, maxTotal, mode }: { w: WeekPoint; maxTotal: number; mode: "abs" | "pct" }) {
  const assets: Seg[] = [
    { label: "SOMA", val: w.soma, color: A_SOMA, sub: [["국채", w.treast], ["MBS", w.mbs], ["기관채", w.agency]] },
    { label: "대출·스왑", val: w.loans, color: A_LOAN, sub: [["할인창구", w.discount], ["BTFP", w.btfp], ["레포", w.repo], ["스왑", w.swap]] },
    { label: "기타자산", val: Math.max(0, w.assetResidual), color: A_RESID },
  ];
  const liabs: Seg[] = [
    { label: "준비금", val: w.reserves, color: L_RES },
    { label: "역레포", val: w.rrp, color: L_RRP },
    { label: "TGA", val: w.tga, color: L_TGA },
    { label: "현금통화", val: w.currency, color: L_CUR },
    { label: "기타·자본", val: Math.max(0, w.liabResidual), color: L_RESID },
  ];
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-0">
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground"><span>자산(차변)</span><span className="tabular-nums">{T(w.total)}</span></div>
        <StackColumn segs={assets} total={w.total} maxTotal={maxTotal} mode={mode} align="left" />
      </div>
      <div className="mx-1 h-[380px] w-px self-stretch bg-border" />
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground"><span className="tabular-nums">{T(w.total)}</span><span>부채·자본(대변)</span></div>
        <StackColumn segs={liabs} total={w.total} maxTotal={maxTotal} mode={mode} align="right" />
      </div>
    </div>
  );
}

// ── 준비금 워터폴 ──
function Waterfall({ prev, now }: { prev: WeekPoint; now: WeekPoint }) {
  const dAssets = now.total - prev.total;
  const dTga = -(now.tga - prev.tga), dRrp = -(now.rrp - prev.rrp), dCur = -(now.currency - prev.currency);
  const dOther = -((now.liabResidual) - (prev.liabResidual));
  const steps = [
    { name: "Δ자산", delta: dAssets }, { name: "ΔTGA", delta: dTga }, { name: "Δ역레포", delta: dRrp },
    { name: "Δ현금", delta: dCur }, { name: "Δ기타", delta: dOther },
  ];
  let run = prev.reserves;
  const bars: { name: string; range: [number, number]; kind: "anchor" | "pos" | "neg"; delta?: number }[] = [
    { name: "지난주", range: [0, prev.reserves], kind: "anchor" },
  ];
  for (const s of steps) { const start = run, end = run + s.delta; bars.push({ name: s.name, range: [Math.min(start, end), Math.max(start, end)], kind: s.delta >= 0 ? "pos" : "neg", delta: s.delta }); run = end; }
  bars.push({ name: "이번주", range: [0, now.reserves], kind: "anchor" });
  const top = steps.reduce((m, s) => Math.abs(s.delta) > Math.abs(m.delta) ? s : m, steps[0]);
  return (
    <div>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
            <YAxis tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}T`} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={46} className="text-muted-foreground" domain={["dataMin - 100000", "dataMax + 100000"]} />
            <Tooltip cursor={{ fill: "rgba(128,128,128,0.08)" }} contentStyle={{ fontSize: 12, borderRadius: 8 }}
              formatter={(_v: any, _n: any, p: any) => [p.payload.kind === "anchor" ? asMoney(p.payload.range[1]) : signed(p.payload.delta), p.payload.name]} />
            <Bar dataKey="range" radius={2}>
              {bars.map((b, i) => <Cell key={i} fill={b.kind === "anchor" ? "#64748b" : b.kind === "pos" ? POS : NEG} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>이번주 준비금 <b className="text-foreground tabular-nums">{asMoney(now.reserves)}</b></span>
        <span>주간 변화 <b className={`tabular-nums ${now.reserves - prev.reserves >= 0 ? "text-emerald-500" : "text-red-500"}`}>{signed(now.reserves - prev.reserves)}</b></span>
        <span>최대 요인 <b className="text-foreground">{top.name} {signed(top.delta)}</b></span>
      </div>
    </div>
  );
}

const RANGES = [{ k: "1Y", d: 365 }, { k: "3Y", d: 365 * 3 }, { k: "QT2", d: 0 }, { k: "전체", d: -1 }] as const;

export default function Fed() {
  const { data, isLoading } = useQuery<Overview>({ queryKey: ["/api/fed/overview"] });
  const [idx, setIdx] = useState<number>(-1);
  const [mode, setMode] = useState<"abs" | "pct">("abs");
  const [range, setRange] = useState<(typeof RANGES)[number]["k"]>("QT2");

  const weeks = data?.weeks ?? [];
  const daily = data?.daily ?? [];
  const maxTotal = useMemo(() => Math.max(1, ...weeks.map((w) => w.total)), [weeks]);
  const sel = weeks.length ? weeks[idx < 0 ? weeks.length - 1 : Math.min(idx, weeks.length - 1)] : null;
  const selPrev = sel ? weeks[Math.max(0, (idx < 0 ? weeks.length - 1 : idx) - 1)] : null;

  const dailyView = useMemo(() => {
    if (!daily.length) return [];
    if (range === "전체") return daily;
    const cut = range === "QT2" ? +new Date("2022-06-01") : +new Date(daily[daily.length - 1].date) - RANGES.find((r) => r.k === range)!.d * 86400_000;
    return daily.filter((p) => +new Date(p.date) >= cut);
  }, [daily, range]);

  if (isLoading) return <div className="p-6 space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-96 w-full" /></div>;
  if (!weeks.length) return <div className="p-6 text-sm text-muted-foreground">데이터가 없습니다.</div>;

  const latest = weeks[weeks.length - 1];
  const prevWk = weeks[weeks.length - 2] ?? latest;
  const qt2 = weeks[nearestIdx(weeks, "2022-06-01")];
  const latestDaily = daily[daily.length - 1];
  const prevDaily = daily[Math.max(0, daily.length - 6)]; // ~1주 전(영업일 5)
  const lendMax = Math.max(...weeks.map((w) => w.loans));

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">Fed 대차대조표 <span className="text-sm font-normal text-muted-foreground">H.4.1 · 미국 유동성</span></h1>
        <span className="text-[11px] text-muted-foreground tabular-nums">최신 {latest.date} · 자료 FRED</span>
      </div>

      {/* 헤드라인 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="총자산 (WALCL)" value={T(latest.total)} delta={latest.total - prevWk.total} sub={`QT2 이후 ${signed(latest.total - qt2.total)}`} />
        <Stat label="지급준비금" value={T(latest.reserves)} delta={latest.reserves - prevWk.reserves} />
        <Stat label="순유동성 (WALCL−TGA−ONRRP)" value={latestDaily ? T(latestDaily.netLiq) : "—"} delta={latestDaily && prevDaily ? latestDaily.netLiq - prevDaily.netLiq : undefined} sub="일간" />
        <Stat label="역레포(ONRRP)" value={latestDaily ? asMoney((latest.total - latest.tga) - latestDaily.netLiq) : "—"} sub="유동성 흡수분" />
      </div>

      {/* T-계정 + 스크러버 */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-semibold">T-계정 <span className="text-[11px] font-normal text-muted-foreground tabular-nums">{sel?.date}</span></div>
          <div className="flex items-center gap-1 text-[11px]">
            <button onClick={() => setMode("abs")} className={`px-2 py-0.5 rounded ${mode === "abs" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>절대값</button>
            <button onClick={() => setMode("pct")} className={`px-2 py-0.5 rounded ${mode === "pct" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>구성비</button>
          </div>
        </div>
        {sel && <TAccount w={sel} maxTotal={maxTotal} mode={mode} />}
        {/* 스크러버 */}
        <div className="mt-3">
          <input type="range" min={0} max={weeks.length - 1} value={idx < 0 ? weeks.length - 1 : idx}
            onChange={(e) => setIdx(Number(e.target.value))} className="w-full accent-primary" data-testid="fed-scrubber" />
          <div className="relative h-4 mt-0.5">
            {PHASES.map((p) => {
              const pi = nearestIdx(weeks, p.date);
              return <button key={p.label} onClick={() => setIdx(pi)} title={`${p.label} (${weeks[pi].date})`}
                className="absolute -translate-x-1/2 text-[9px] text-muted-foreground/70 hover:text-primary whitespace-nowrap"
                style={{ left: `${(pi / (weeks.length - 1)) * 100}%` }}>{p.label}</button>;
            })}
          </div>
        </div>
      </Card>

      {/* 워터폴 */}
      <Card className="p-4">
        <div className="mb-1 text-sm font-semibold">주간 준비금 변화 워터폴 <span className="text-[11px] font-normal text-muted-foreground">TGA·역레포·현금 증가 = 준비금 감소</span></div>
        {sel && selPrev && sel !== selPrev ? <Waterfall prev={selPrev} now={sel} /> : <div className="py-8 text-center text-[12px] text-muted-foreground">첫 주는 이전 주가 없어 표시할 수 없습니다.</div>}
      </Card>

      {/* 대출 프로그램(위기 시그널) */}
      <Card className="p-4">
        <div className="mb-1 text-sm font-semibold">대출 프로그램 <span className="text-[11px] font-normal text-muted-foreground">Fed 대출이 튀면 어딘가에서 불이 났다</span></div>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weeks} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
              <XAxis dataKey="date" tickFormatter={yr} minTickGap={40} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
              <YAxis tickFormatter={(v) => `$${Math.round(v / 1e3)}B`} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={44} className="text-muted-foreground" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(l) => l}
                formatter={(v: any, n: any) => [asMoney(v), n]} />
              <ReferenceArea x1="2008-09-01" x2="2009-06-01" fill={NEG} fillOpacity={0.06} />
              <ReferenceArea x1="2020-03-01" x2="2020-07-01" fill={NEG} fillOpacity={0.06} />
              <ReferenceArea x1="2023-03-01" x2="2023-06-01" fill={NEG} fillOpacity={0.06} />
              <Area dataKey="discount" name="할인창구" stackId="1" stroke={LEND.discount} fill={LEND.discount} fillOpacity={0.5} />
              <Area dataKey="btfp" name="BTFP" stackId="1" stroke={LEND.btfp} fill={LEND.btfp} fillOpacity={0.5} />
              <Area dataKey="repo" name="레포" stackId="1" stroke={LEND.repo} fill={LEND.repo} fillOpacity={0.5} />
              <Area dataKey="swap" name="통화스왑" stackId="1" stroke={LEND.swap} fill={LEND.swap} fillOpacity={0.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* 순유동성 + SP500 */}
      <Card className="p-4">
        <div className="mb-1 flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-semibold">순유동성 <span className="text-[11px] font-normal text-muted-foreground">WALCL − TGA − ONRRP (일간) · S&P 500 오버레이</span></div>
          <div className="flex items-center gap-1 text-[11px]">
            {RANGES.map((r) => <button key={r.k} onClick={() => setRange(r.k)} className={`px-2 py-0.5 rounded ${range === r.k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{r.k}</button>)}
          </div>
        </div>
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dailyView} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 7)} minTickGap={50} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
              <YAxis yAxisId="l" tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}T`} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={46} domain={["auto", "auto"]} className="text-muted-foreground" />
              <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${Math.round(v)}`} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={44} domain={["auto", "auto"]} className="text-muted-foreground" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(v: any, n: any) => [n === "순유동성" ? T(v) : Math.round(v).toLocaleString(), n]} />
              <Line yAxisId="l" dataKey="netLiq" name="순유동성" stroke={A_SOMA} strokeWidth={1.8} dot={false} />
              <Line yAxisId="r" dataKey="sp500" name="S&P 500" stroke="#eab308" strokeWidth={1.2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
