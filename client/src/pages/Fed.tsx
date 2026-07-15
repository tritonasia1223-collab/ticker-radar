import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceArea, ReferenceLine, ReferenceDot,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// server/fed.ts 의 응답 형태(모든 수치 million USD).
interface WeekPoint {
  date: string; total: number;
  treast: number; mbs: number; agency: number; soma: number;
  discount: number; btfp: number; repo: number; swap: number; loans: number; assetResidual: number;
  reserves: number; rrp: number; tga: number; currency: number; liabResidual: number;
}
interface Overview { weeks: WeekPoint[]; updatedAt: string }

// ── 색 ── SOMA 세분(국채·MBS·기관채)=teal 3단 / 대출=amber / 기타=slate / 부채=purple+gray
const A_SOMA = "#0d9488", A_MBS = "#14b8a6", A_AGENCY = "#5eead4"; // 국채·MBS·기관채
const A_LOAN = "#f59e0b", A_RESID = "#94a3b8";                     // 대출·스왑 / 기타자산
const L_RES = "#7c3aed", L_RRP = "#a855f7", L_TGA = "#d8b4fe", L_CUR = "#9ca3af", L_RESID = "#6b7280";
const POS = "#16a34a", NEG = "#dc2626";
const LEND = { discount: "#f59e0b", btfp: "#ef4444", repo: "#3b82f6", swap: "#8b5cf6" };

const PHASES: { date: string; label: string; desc: string }[] = [
  { date: "2008-11-25", label: "QE1", desc: "금융위기 — MBS·국채 대량매입 시작" },
  { date: "2010-11-03", label: "QE2", desc: "2차 양적완화 국채 $6,000억" },
  { date: "2012-09-13", label: "QE3", desc: "무제한 MBS 매입(월 $400억)" },
  { date: "2013-05-22", label: "테이퍼", desc: "테이퍼 탠트럼 — 매입 축소 시사" },
  { date: "2017-10-01", label: "QT1", desc: "1차 양적긴축 — 재투자 축소" },
  { date: "2019-09-17", label: "레포위기", desc: "단기금리 급등 → 준비금 재확대" },
  { date: "2020-03-15", label: "무제한QE", desc: "코로나 — 무제한 양적완화" },
  { date: "2022-06-01", label: "QT2", desc: "2차 양적긴축 시작" },
  { date: "2023-03-12", label: "SVB/BTFP", desc: "SVB 파산 → BTFP 긴급대출" },
];

// ── 단위: 세미 한국식($억/$조) ── musd → 억=÷100, 조=÷1e6(소수점 1자리)
const asMoney = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}조`;
  if (a >= 100) return `${s}$${Math.round(a / 100).toLocaleString()}억`;
  return `${s}$${(a / 100).toFixed(2)}억`;
};
const T = asMoney;
const signed = (v: number) => (v >= 0 ? "+" : "−") + asMoney(Math.abs(v));
const yr = (d: string) => d.slice(0, 4);
const weekLabel = (d: string) => `${Number(d.slice(5, 7))}월 ${Math.ceil(Number(d.slice(8, 10)) / 7)}주차`;
const weekRange = (a: string, b: string) =>
  a.slice(0, 7) === b.slice(0, 7) ? `${weekLabel(a)} → ${weekLabel(b).replace(/^\d+월 /, "")}` : `${weekLabel(a)} → ${weekLabel(b)}`;
const textOn = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#0f172a" : "#ffffff";
};
const nearestIdx = (weeks: WeekPoint[], date: string) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < weeks.length; i++) { const d = Math.abs(+new Date(weeks[i].date) - +new Date(date)); if (d < bd) { bd = d; best = i; } }
  return best;
};

// ── T-계정 한쪽 컬럼(꽉 찬 구성비 스택) ──
interface Seg { label: string; val: number; color: string; sub?: [string, number][] }
const STACK_H = 320;
function StackColumn({ segs, total, align }: { segs: Seg[]; total: number; align: "left" | "right" }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-md" style={{ height: STACK_H }}>
      {segs.map((s, i) => {
        const h = Math.max(0, (s.val / total) * STACK_H);
        const pct = ((s.val / total) * 100).toFixed(1);
        const fg = textOn(s.color);
        const title = `${s.label} ${asMoney(s.val)} (${pct}%)${s.sub ? "\n" + s.sub.map(([n, v]) => `  ${n} ${asMoney(v)}`).join("\n") : ""}`;
        return (
          <div key={i} title={title} style={{ height: h, background: s.color, color: fg }}
            className={`flex flex-col justify-center overflow-hidden border-t border-black/10 first:border-t-0 ${align === "right" ? "items-end pr-2.5" : "items-start pl-2.5"}`}>
            {h >= 36 ? (
              <>
                <span className="text-[12.5px] font-semibold leading-tight">{s.label}</span>
                <span className="text-[11.5px] tabular-nums leading-tight opacity-90">{asMoney(s.val)} · {pct}%</span>
              </>
            ) : h >= 18 ? (
              <span className="text-[11px] font-medium tabular-nums whitespace-nowrap leading-tight">{s.label} · {asMoney(s.val)}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TAccount({ w }: { w: WeekPoint }) {
  // SOMA 를 국채/MBS/기관채로 분할 표시(캡처 요청). 기관채는 잔존 미미해 얇은 띠.
  const assets: Seg[] = [
    { label: "국채", val: w.treast, color: A_SOMA },
    { label: "MBS", val: w.mbs, color: A_MBS },
    { label: "기관채", val: w.agency, color: A_AGENCY },
    { label: "대출·스왑", val: w.loans, color: A_LOAN, sub: [["할인창구", w.discount], ["BTFP", w.btfp], ["레포", w.repo], ["스왑", w.swap]] },
    { label: "기타자산", val: Math.max(0, w.assetResidual), color: A_RESID },
  ];
  const liabs: Seg[] = [
    { label: "지급준비금", val: w.reserves, color: L_RES },
    { label: "역레포", val: w.rrp, color: L_RRP },
    { label: "TGA", val: w.tga, color: L_TGA },
    { label: "현금통화", val: w.currency, color: L_CUR },
    { label: "기타·자본", val: Math.max(0, w.liabResidual), color: L_RESID },
  ];
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-muted-foreground"><span className="font-medium">자산</span><span className="tabular-nums text-foreground font-semibold">{T(w.total)}</span></div>
        <StackColumn segs={assets} total={w.total} align="left" />
      </div>
      <div className="mt-6 w-px bg-border" style={{ height: STACK_H }} />
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-muted-foreground"><span className="tabular-nums text-foreground font-semibold">{T(w.total)}</span><span className="font-medium">부채·자본</span></div>
        <StackColumn segs={liabs} total={w.total} align="right" />
      </div>
    </div>
  );
}

// ── 주간 준비금 변화 분해 ──
function DeltaBreakdown({ prev, now }: { prev: WeekPoint; now: WeekPoint }) {
  const net = now.reserves - prev.reserves;
  const rows = [
    { label: "자산 변화", d: now.total - prev.total, hint: "총자산 증가 → 준비금 유입" },
    { label: "TGA 변화", d: -(now.tga - prev.tga), hint: "재무부 계좌 증가 → 준비금 유출" },
    { label: "역레포 변화", d: -(now.rrp - prev.rrp), hint: "역레포 증가 → 준비금 유출" },
    { label: "현금통화 변화", d: -(now.currency - prev.currency), hint: "현금 증가 → 준비금 유출" },
    { label: "기타·자본 변화", d: -(now.liabResidual - prev.liabResidual), hint: "기타부채·자본 증가 → 준비금 유출" },
  ];
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.d)));
  const top = rows.reduce((m, r) => (Math.abs(r.d) > Math.abs(m.d) ? r : m), rows[0]);
  return (
    <div>
      <div className="text-[12px] text-muted-foreground">{weekRange(prev.date, now.date)} · 주간 준비금 변화</div>
      <div className={`text-3xl font-bold tabular-nums ${net >= 0 ? "text-emerald-500" : "text-red-500"}`}>{signed(net)}</div>
      <div className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
        전주 <b className="text-foreground">{T(prev.reserves)}</b> <span className="mx-1">→</span> 이번주 <b className="text-foreground">{T(now.reserves)}</b> · 최대 요인 <b className="text-foreground">{top.label} {signed(top.d)}</b>
      </div>
      <div className="mt-3 space-y-1.5">
        {rows.map((r) => {
          const w = (Math.abs(r.d) / maxAbs) * 50;
          return (
            <div key={r.label} title={r.hint} className="grid grid-cols-[100px_1fr_84px] items-center gap-2">
              <span className="text-[11.5px] text-muted-foreground whitespace-nowrap">{r.label}</span>
              <div className="relative h-4">
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
                <div className="absolute top-0.5 bottom-0.5 rounded-sm"
                  style={{ background: r.d >= 0 ? POS : NEG, left: r.d >= 0 ? "50%" : `${50 - w}%`, width: `${w}%` }} />
              </div>
              <span className={`text-[12px] text-right tabular-nums font-medium ${r.d >= 0 ? "text-emerald-500" : "text-red-500"}`}>{signed(r.d)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[10.5px] text-muted-foreground">초록=준비금 유입 · 빨강=유출. 다섯 요인의 합이 곧 주간 변화({signed(net)}).</div>
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
      {items.map(([n, c]) => <span key={n} className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: c }} />{n}</span>)}
    </div>
  );
}

export default function Fed() {
  const { data, isLoading } = useQuery<Overview>({ queryKey: ["/api/fed/overview"] });
  const [idx, setIdx] = useState<number>(-1);

  const weeks = data?.weeks ?? [];
  const curIdx = idx < 0 ? weeks.length - 1 : Math.min(idx, weeks.length - 1);
  const sel = weeks.length ? weeks[curIdx] : null;
  const selPrev = weeks.length && curIdx > 0 ? weeks[curIdx - 1] : null;

  const activePhase = useMemo(() => {
    if (!weeks.length) return null;
    const withI = PHASES.map((p) => ({ ...p, i: nearestIdx(weeks, p.date) }));
    const near = withI.reduce((m, p) => (Math.abs(p.i - curIdx) < Math.abs(m.i - curIdx) ? p : m), withI[0]);
    return Math.abs(near.i - curIdx) <= 26 ? near : null;
  }, [weeks, curIdx]);

  // QT/QE 속도 = 총자산의 분기(13주) 변화를 월 평균으로(musd/월). 0 위=완화, 아래=긴축.
  const pace = useMemo(() => {
    const N = 13, out: { date: string; pace: number }[] = [];
    for (let i = N; i < weeks.length; i++) out.push({ date: weeks[i].date, pace: (weeks[i].total - weeks[i - N].total) / 3 });
    return out;
  }, [weeks]);

  if (isLoading) return <div className="p-6 space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-96 w-full" /></div>;
  if (!weeks.length) return <div className="p-6 text-sm text-muted-foreground">데이터가 없습니다.</div>;

  const latest = weeks[weeks.length - 1];
  const lendAlert = latest.loans > 100_000; // >$1000억이면 경보(평상시 <$300억)
  const paceNow = pace.length ? pace[pace.length - 1].pace : 0;
  const pMax = Math.max(0, ...pace.map((p) => p.pace)), pMin = Math.min(0, ...pace.map((p) => p.pace));
  const zeroOff = pMax === pMin ? 0.5 : pMax / (pMax - pMin); // 그라디언트에서 0 이 위치하는 세로 비율
  const easing = paceNow > 10_000, tightening = paceNow < -10_000; // ±$100억/월 데드밴드

  return (
    <div className="p-4 md:p-6 space-y-3 max-w-6xl mx-auto">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">Fed 대차대조표 <span className="text-sm font-normal text-muted-foreground">H.4.1 · 미국 유동성</span></h1>
        <span className="text-[11px] text-muted-foreground tabular-nums">최신 {latest.date} · 자료 FRED</span>
      </div>

      {/* 규모 시계열 = 시간 선택기 */}
      <Card className="p-3.5">
        <div className="mb-1 flex items-baseline justify-between flex-wrap gap-2">
          <div className="text-sm font-semibold">연준 대차대조표 규모 <span className="text-[11px] font-normal text-muted-foreground">2002 → 현재 · 그래프 클릭/드래그로 시점 선택</span></div>
          <div className="text-[12px] tabular-nums"><b>{sel && weekLabel(sel.date)}</b> <span className="text-muted-foreground">({sel?.date})</span> · 총자산 <b>{sel && T(sel.total)}</b></div>
        </div>
        <div className="h-[136px] cursor-crosshair">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weeks} margin={{ top: 20, right: 8, left: 6, bottom: 0 }}
              onClick={(e: any) => { if (e?.activeLabel) setIdx(nearestIdx(weeks, String(e.activeLabel))); }}>
              <defs><linearGradient id="fedsz" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={A_SOMA} stopOpacity={0.4} /><stop offset="100%" stopColor={A_SOMA} stopOpacity={0.03} /></linearGradient></defs>
              <XAxis dataKey="date" tickFormatter={yr} minTickGap={44} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
              <YAxis tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}조`} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={40} className="text-muted-foreground" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [T(v), "총자산"]} labelFormatter={(l) => `${weekLabel(String(l))} (${l})`} />
              <Area dataKey="total" stroke={A_SOMA} strokeWidth={1.5} fill="url(#fedsz)" />
              {PHASES.map((p) => { const w = weeks[nearestIdx(weeks, p.date)]; return <ReferenceDot key={p.label} x={w.date} y={w.total} r={2.5} fill="hsl(var(--muted-foreground))" stroke="none" />; })}
              {activePhase && <ReferenceDot x={weeks[activePhase.i].date} y={weeks[activePhase.i].total} r={4.5} fill={NEG} stroke="hsl(var(--background))" strokeWidth={1.5}
                label={{ value: `${activePhase.label} · ${activePhase.desc}`, position: "top", fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 600 }} />}
              {sel && <ReferenceLine x={sel.date} stroke={NEG} strokeWidth={1} strokeOpacity={0.45} />}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <input type="range" min={0} max={weeks.length - 1} value={curIdx}
          onChange={(e) => setIdx(Number(e.target.value))} className="mt-1.5 w-full accent-primary" data-testid="fed-scrubber" />
      </Card>

      {/* T-계정 ↔ 준비금 변화 분해 (한 화면 2단) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        <Card className="p-3.5">
          <div className="mb-2 text-sm font-semibold">T-계정 <span className="text-[11px] font-normal text-muted-foreground tabular-nums">{sel && weekLabel(sel.date)} · 구성비</span></div>
          {sel && <TAccount w={sel} />}
        </Card>
        <Card className="p-3.5">
          <div className="mb-2 text-sm font-semibold">주간 준비금 변화 분해</div>
          {sel && selPrev ? <DeltaBreakdown prev={selPrev} now={sel} /> : <div className="py-6 text-center text-[12px] text-muted-foreground">첫 주는 이전 주가 없어 표시할 수 없습니다.</div>}
        </Card>
      </div>

      {/* QT/QE 속도계 = 총자산 변화율(월) */}
      <Card className="p-3.5">
        <div className="mb-1 flex items-start justify-between flex-wrap gap-2">
          <div>
            <div className="text-sm font-semibold">QT / QE 속도계 <span className="text-[11px] font-normal text-muted-foreground">연준이 얼마나 빠르게 조이나/푸나</span></div>
            <div className="text-[11px] text-muted-foreground">총자산의 분기(13주) 변화를 월평균으로. <span className="text-emerald-500">0 위 = 완화(QE, 돈 풀기)</span> · <span className="text-red-500">0 아래 = 긴축(QT, 회수)</span>.</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10.5px] text-muted-foreground">현재 속도</div>
            <div className={`tabular-nums font-semibold ${easing ? "text-emerald-500" : tightening ? "text-red-500" : "text-muted-foreground"}`}>{signed(paceNow)}/월 · {easing ? "완화" : tightening ? "긴축" : "중립"}</div>
          </div>
        </div>
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={pace} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
              <defs><linearGradient id="pace" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={POS} stopOpacity={0.55} />
                <stop offset={zeroOff} stopColor={POS} stopOpacity={0.08} />
                <stop offset={zeroOff} stopColor={NEG} stopOpacity={0.08} />
                <stop offset="1" stopColor={NEG} stopOpacity={0.55} />
              </linearGradient></defs>
              <XAxis dataKey="date" tickFormatter={yr} minTickGap={40} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
              <YAxis tickFormatter={(v) => (v === 0 ? "0" : `${v > 0 ? "+" : "−"}${asMoney(Math.abs(v))}`)} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={60} className="text-muted-foreground" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [`${signed(v)}/월`, "속도"]} labelFormatter={(l) => `${weekLabel(String(l))} (${l})`} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.45} />
              <Area dataKey="pace" stroke="hsl(var(--foreground))" strokeOpacity={0.35} strokeWidth={1} fill="url(#pace)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* 위기 감지기 (전체기간 · 슬라이더 무관) */}
      <Card className="p-3.5">
        <div className="mb-1 flex items-start justify-between flex-wrap gap-2">
          <div>
            <div className="text-sm font-semibold">위기 감지기 <span className="text-[11px] font-normal text-muted-foreground">Fed 긴급대출</span></div>
            <div className="text-[11px] text-muted-foreground">평상시엔 바닥. 이 선들이 튀면 은행·자금시장 어딘가에 불이 났다는 신호 (2008·2020·2023).</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10.5px] text-muted-foreground">현재 긴급대출 잔액</div>
            <div className={`tabular-nums font-semibold ${lendAlert ? "text-red-500" : "text-emerald-500"}`}>{asMoney(latest.loans)} · {lendAlert ? "경보" : "평상시"}</div>
          </div>
        </div>
        <Legend items={[["할인창구", LEND.discount], ["BTFP", LEND.btfp], ["레포", LEND.repo], ["통화스왑", LEND.swap]]} />
        <div className="h-[190px] mt-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weeks} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
              <XAxis dataKey="date" tickFormatter={yr} minTickGap={40} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
              <YAxis tickFormatter={(v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}조` : `$${Math.round(v / 100).toLocaleString()}억`)} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={52} className="text-muted-foreground" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any, n: any) => [asMoney(v), n]} labelFormatter={(l) => l} />
              <ReferenceArea x1="2008-09-01" x2="2009-06-01" fill={NEG} fillOpacity={0.07} label={{ value: "2008 GFC", fontSize: 9, fill: "hsl(var(--muted-foreground))", position: "insideTop" }} />
              <ReferenceArea x1="2020-03-01" x2="2020-07-01" fill={NEG} fillOpacity={0.07} label={{ value: "2020 코로나", fontSize: 9, fill: "hsl(var(--muted-foreground))", position: "insideTop" }} />
              <ReferenceArea x1="2023-03-01" x2="2023-06-01" fill={NEG} fillOpacity={0.07} label={{ value: "2023 SVB", fontSize: 9, fill: "hsl(var(--muted-foreground))", position: "insideTop" }} />
              <Area dataKey="discount" name="할인창구" stackId="1" stroke={LEND.discount} fill={LEND.discount} fillOpacity={0.5} />
              <Area dataKey="btfp" name="BTFP" stackId="1" stroke={LEND.btfp} fill={LEND.btfp} fillOpacity={0.5} />
              <Area dataKey="repo" name="레포" stackId="1" stroke={LEND.repo} fill={LEND.repo} fillOpacity={0.5} />
              <Area dataKey="swap" name="통화스왑" stackId="1" stroke={LEND.swap} fill={LEND.swap} fillOpacity={0.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
