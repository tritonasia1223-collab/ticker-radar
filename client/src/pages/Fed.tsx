import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
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
// 국채 수급(재무부 시장성 국채 + 연준 SOMA 만기별). server/fed.ts buildTreasury.
interface TreasuryMonth {
  date: string; bills: number; notes: number; bonds: number; tips: number; frn: number; total: number;
  netBills: number; netNotes: number; netBonds: number; netTips: number; netFrn: number; netTotal: number;
  fedBills: number; fedNotesBonds: number; fedTips: number; fedTotal: number; fedShare: number;
}
interface FedMatWeek { date: string; bills: number; notesBonds: number; tips: number; total: number }
interface Treasury { monthly: TreasuryMonth[]; fedWeekly: FedMatWeek[] }
interface Overview { weeks: WeekPoint[]; treasury?: Treasury; updatedAt: string }

// ── 색 ── SOMA 세분(국채·MBS·기관채)=teal 3단 / 대출=amber / 기타=slate / 부채=purple+gray
const A_SOMA = "#0d9488", A_MBS = "#14b8a6", A_AGENCY = "#5eead4"; // 국채·MBS·기관채
const A_LOAN = "#f59e0b", A_RESID = "#94a3b8";                     // 대출·스왑 / 기타자산
const L_RES = "#7c3aed", L_RRP = "#a855f7", L_TGA = "#d8b4fe", L_CUR = "#9ca3af", L_RESID = "#6b7280";
const POS = "#16a34a", NEG = "#dc2626";
const LEND = { discount: "#f59e0b", btfp: "#ef4444", repo: "#3b82f6", swap: "#8b5cf6" };
// 국채 종류별(재무부) — 단기(파랑)→장기(보라) 그라데이션 + TIPS(teal)·FRN(amber). 연준 흡수율=rose.
const TB = { bill: "#3b82f6", note: "#6366f1", bond: "#8b5cf6", tips: "#14b8a6", frn: "#f59e0b" };
const FED_ABS = "#e11d48";

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
function StackColumn({ segs, total, align, group }: {
  segs: Seg[]; total: number; align: "left" | "right";
  group?: { label: string; count: number }; // 앞 count 개 세그먼트를 상위 분류로 묶는 브래킷(왼쪽)
}) {
  const stack = (
    <div className="flex flex-1 flex-col overflow-hidden rounded-md" style={{ height: STACK_H }}>
      {segs.map((s, i) => {
        const h = Math.max(0, (s.val / total) * STACK_H);
        const pct = ((s.val / total) * 100).toFixed(1);
        const fg = textOn(s.color);
        const title = `${s.label} ${asMoney(s.val)} (${pct}%)${s.sub ? "\n" + s.sub.map(([n, v]) => `  ${n} ${asMoney(v)}`).join("\n") : ""}`;
        return (
          <div key={i} title={title} style={{ height: h, background: s.color, color: fg }}
            className={`flex flex-col justify-center overflow-hidden border-t border-black/10 first:border-t-0 ${align === "right" ? "items-end pr-2.5" : "items-start pl-2.5"}`}>
            {h >= 34 ? (
              <>
                <span className="text-[12.5px] font-semibold leading-tight">{s.label}</span>
                <span className="text-[11.5px] tabular-nums leading-tight opacity-90">{asMoney(s.val)} · {pct}%</span>
              </>
            ) : h >= 17 ? (
              <span className="text-[11px] font-medium tabular-nums whitespace-nowrap leading-tight">{s.label} · {asMoney(s.val)}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
  if (!group) return stack;
  // 상위 분류 브래킷: 앞 count 세그먼트(예: SOMA=국채+MBS+기관채)의 합산 높이만큼 왼쪽에 세로 괄호.
  const gval = segs.slice(0, group.count).reduce((s, x) => s + x.val, 0);
  const gh = (gval / total) * STACK_H;
  const gpct = ((gval / total) * 100).toFixed(1);
  return (
    <div className="flex gap-1" style={{ height: STACK_H }}>
      <div className="flex w-[52px] shrink-0 flex-col">
        <div style={{ height: gh }} className="relative flex items-center justify-end pr-1.5">
          <div className="absolute right-0 top-0 bottom-0 w-px bg-foreground/30" />
          <div className="absolute right-0 top-0 h-px w-2 bg-foreground/30" />
          <div className="absolute right-0 bottom-0 h-px w-2 bg-foreground/30" />
          <div className="text-right leading-tight">
            <div className="text-[11.5px] font-bold">{group.label}</div>
            {gh >= 42 && <><div className="text-[9.5px] text-muted-foreground tabular-nums">{asMoney(gval)}</div><div className="text-[9.5px] text-muted-foreground tabular-nums">{gpct}%</div></>}
          </div>
        </div>
      </div>
      {stack}
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
        <StackColumn segs={assets} total={w.total} align="left" group={{ label: "SOMA", count: 3 }} />
      </div>
      <div className="mt-6 w-px bg-border" style={{ height: STACK_H }} />
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-muted-foreground"><span className="tabular-nums text-foreground font-semibold">{T(w.total)}</span><span className="font-medium">부채·자본</span></div>
        <StackColumn segs={liabs} total={w.total} align="right" />
      </div>
    </div>
  );
}

// ── 주간 준비금 변화 분해 (2그룹 delta 워터폴) ──
// 원칙(§2.3): 화면의 모든 숫자는 '준비금 효과' 단일부호. 항목 자체 증감은 라벨 계층(이름+화살표·해설)으로.
//   막대 순서 고정: 자산 → TGA → 역레포 → 현금통화 → 기타·자본 → 준비금 변화(순).
//   밴드A(자산)=돈 총량 창조/소멸(QE/QT) · 밴드B(4개)=기존 돈의 자리이동 · 순변화 막대는 밴드 밖(결과).
const FLOW_UP = POS, FLOW_DN = NEG, FLOW_NET = L_RES; // 유입 green / 유출 red / 순변화 purple

// hover 툴팁 풀문장(§2.3).
function flowSentence(key: string, name: string, own: number, eff: number): string {
  const amt = asMoney(Math.abs(own)), e = asMoney(Math.abs(eff));
  if (key === "assets") return own >= 0
    ? `Fed가 자산 ${amt}를 사들여(QE) 시스템에 새 돈이 들어왔어요 → 준비금 +${e}`
    : `Fed가 자산 ${amt}를 줄여(QT) 시스템에서 돈이 회수됐어요 → 준비금 −${e}`;
  if (key === "cur") return own >= 0
    ? `대중이 현찰 ${amt}를 인출해 준비금에서 빠졌어요 → 준비금 −${e}`
    : `현찰 ${amt}가 은행으로 돌아와 준비금이 늘었어요 → 준비금 +${e}`;
  // TGA·역레포·기타·자본 공용 — '지급준비금'과의 자리 이동을 방향으로 통일(현금통화·자산은 자체 문구 유지).
  //   eff≥0: 그 계정에서 돈이 나와 준비금으로 / eff<0: 준비금에서 돈이 나가 그 계정으로.
  //   (금액은 막대 라벨에 이미 표시되므로 문장은 방향만.)
  return eff >= 0
    ? `${name}에서 꺼내서 → 지급준비금으로 들어감`
    : `지급준비금에서 꺼내서 → ${name}에 들어감`;
}

function DeltaWaterfall({ prev, now }: { prev: WeekPoint; now: WeekPoint }) {
  const factors = [
    { key: "assets", name: "자산", own: now.total - prev.total, asset: true },
    { key: "tga", name: "TGA", own: now.tga - prev.tga, asset: false },
    { key: "rrp", name: "역레포", own: now.rrp - prev.rrp, asset: false },
    { key: "cur", name: "현금통화", own: now.currency - prev.currency, asset: false },
    { key: "other", name: "기타·자본", own: now.liabResidual - prev.liabResidual, asset: false },
  ].map((f) => ({ ...f, eff: f.asset ? f.own : -f.own })); // 준비금 효과: 자산은 동부호, 부채는 반대부호
  const net = now.reserves - prev.reserves;

  // 누적 레벨(delta-only): 0에서 출발, 요인별 효과 누적.
  const from: number[] = [], to: number[] = [];
  let acc = 0;
  for (const f of factors) { from.push(acc); acc += f.eff; to.push(acc); }
  const levels = [0, ...to, net];
  const domMax = Math.max(...levels, 0), domMin = Math.min(...levels, 0);
  const span = Math.max(domMax - domMin, 1);
  const pad = span * 0.16;
  const hi = domMax + pad, lo = domMin - pad;
  const yTop = 26, yBot = 120;
  const y = (v: number) => yTop + ((hi - v) / (hi - lo)) * (yBot - yTop);
  const y0 = y(0);

  // x0(왼쪽 여백): y축이 없는 워터폴이라 크게 둘 이유가 없다. 오른쪽 여백(~19)과 맞춰 가운데 정렬
  //   (과거 x0=42 는 오른쪽보다 왼쪽 dead space 가 커서 차트가 오른쪽으로 쏠려 보였다).
  const N = 6, x0 = 17, colW = 52, barW = 26;
  const cx = (i: number) => x0 + colW * i + colW / 2;
  const W = x0 + colW * N + 6;

  // 밴드 배경: A=col0(자산), B=col1..4(자리이동).
  const bandA = { x: x0 + 2, w: colW - 4 };
  const bandB = { x: x0 + colW + 2, w: colW * 4 - 4 };

  type Bar = { i: number; key: string; name: string; own: number; eff: number; net?: boolean };
  const bars: Bar[] = factors.map((f, i) => ({ i, ...f }));
  bars.push({ i: 5, key: "net", name: "준비금 변화", own: net, eff: net, net: true });

  return (
    <svg viewBox={`0 0 ${W} 146`} className="w-full" style={{ maxHeight: 210 }}>
      {/* 밴드 배경 + 헤더 */}
      <rect x={bandA.x} y={12} width={bandA.w} height={yBot - 12 + 4} rx={4} fill={A_SOMA} opacity={0.07} />
      <rect x={bandB.x} y={12} width={bandB.w} height={yBot - 12 + 4} rx={4} fill="#64748b" opacity={0.08} />
      <text x={cx(0)} y={9} textAnchor="middle" fontSize={9} fill="hsl(var(--muted-foreground))">돈 총량</text>
      <text x={(bandB.x + bandB.w / 2)} y={9} textAnchor="middle" fontSize={9} fill="hsl(var(--muted-foreground))">자리 이동 (총량 그대로)</text>
      {/* 0 기준선 */}
      <line x1={x0} y1={y0} x2={W - 4} y2={y0} stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray="3 3" />

      {/* 커넥터(누적 레벨 점선) — 요인 막대 사이 */}
      {factors.slice(0, -1).map((_, i) => (
        <line key={`c${i}`} x1={cx(i) + barW / 2} y1={y(to[i])} x2={cx(i + 1) - barW / 2} y2={y(to[i])}
          stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.6} />
      ))}

      {bars.map((b) => {
        const f0 = b.net ? 0 : from[b.i], f1 = b.net ? net : to[b.i];
        const yA = y(Math.max(f0, f1)), yB = y(Math.min(f0, f1));
        const h = Math.max(Math.abs(yB - yA), 1.5);
        const color = b.net ? FLOW_NET : b.eff >= 0 ? FLOW_UP : FLOW_DN;
        const rises = b.eff >= 0;
        const valY = rises ? yA - 4 : yB + 11;          // 값 라벨은 막대 바깥쪽 끝(작은 막대도 안전)
        return (
          <g key={b.key}>
            <title>{b.net
              ? `이번 주 지급준비금은 전주 대비 ${signed(net)} 변했어요 (전주 ${asMoney(prev.reserves)} → ${asMoney(now.reserves)})`
              : flowSentence(b.key, b.name, b.own, b.eff)}</title>
            <rect x={cx(b.i) - barW / 2} y={yA} width={barW} height={h} rx={2} fill={color}
              opacity={b.net ? 0.95 : 0.9} style={{ transition: "y 0.3s ease, height 0.3s ease" }} />
            {/* 준비금 효과값(단일부호) */}
            <text x={cx(b.i)} y={valY} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={color}>{signed(b.eff)}</text>
            {/* 이름만 — 화살표·해설줄 제거(상세는 hover 툴팁). */}
            <text x={cx(b.i)} y={138} textAnchor="middle" fontSize={10} fill="hsl(var(--foreground))">{b.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

// 요약 문장(§2.4) — 순변화값에만 색.
function FlowSummary({ prev, now }: { prev: WeekPoint; now: WeekPoint }) {
  const factors = [
    { key: "assets", name: "자산", eff: now.total - prev.total, asset: true },
    { key: "tga", name: "TGA", eff: -(now.tga - prev.tga) },
    { key: "rrp", name: "역레포", eff: -(now.rrp - prev.rrp) },
    { key: "cur", name: "현금통화", eff: -(now.currency - prev.currency) },
    { key: "other", name: "기타·자본", eff: -(now.liabResidual - prev.liabResidual) },
  ];
  const net = now.reserves - prev.reserves;
  const netCol = net >= 0 ? FLOW_UP : FLOW_DN;
  const assetEff = factors[0].eff;
  const moves = factors.slice(1);
  const moveTop = moves.reduce((m, x) => (Math.abs(x.eff) > Math.abs(m.eff) ? x : m), moves[0]);
  const netChip = <b style={{ color: netCol }}>{signed(net)}</b>;

  // 돈 총량 변화(자산)가 작고 자리이동이 지배하면 별도 템플릿.
  //   ⚠ 단일 주 자산변화에 'QE' 라벨을 붙이지 않는다 — 음수면 오히려 회수(QT)라 모순. QE/QT 는 13주 국면 배지가 담당.
  if (Math.abs(assetEff) < Math.abs(moveTop.eff) * 0.5) {
    return (
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        이번 주 준비금 {netChip} — 돈 총량(연준 자산)이 바뀐 건 <b className="text-foreground">{signed(assetEff)}</b>뿐이고,
        준비금이 {net < 0 ? "줄어든" : "늘어난"} 건 대부분 돈이 <b className="text-foreground">{moveTop.name}</b>
        {moveTop.eff < 0 ? "로 옮겨갔기" : "에서 나왔기"} 때문이에요.
      </p>
    );
  }
  const byAbs = [...factors].sort((a, b) => Math.abs(b.eff) - Math.abs(a.eff));
  const top = byAbs[0];
  const opp = factors.filter((c) => Math.sign(c.eff) === -Math.sign(top.eff) && c.eff !== 0)
    .sort((a, b) => Math.abs(b.eff) - Math.abs(a.eff))[0];
  const won = net === 0 || Math.sign(top.eff) === Math.sign(net);
  return (
    <p className="text-[12px] leading-relaxed text-muted-foreground">
      이번 주 준비금 {netChip} — <b className="text-foreground">{top.name}</b>({signed(top.eff)})이{" "}
      {opp
        ? <>{opp.name}({signed(opp.eff)})을 {won ? "이겼어요" : "못 이겼어요"}.</>
        : <>상쇄 요인 없이 그대로 반영됐어요.</>}
    </p>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
      {items.map(([n, c]) => <span key={n} className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: c }} />{n}</span>)}
    </div>
  );
}

// ── 국채 수급: 재무부 발행(종류별) ↔ 연준 흡수(SOMA) ──
function TreasurySupply({ t }: { t: Treasury }) {
  const tm = t.monthly, fw = t.fedWeekly;
  const last = tm.at(-1);
  const fwLast = fw.at(-1);
  const fwP4 = fw.length > 4 ? fw[fw.length - 5] : null;
  if (!last) return null;
  const pct = (v: number) => (v * 100).toFixed(1) + "%";
  const ym = (d: string) => `${d.slice(2, 4)}.${d.slice(5, 7)}`;
  const peak = tm.reduce((m, p) => (p.fedShare > m.fedShare ? p : m), tm[0]); // 흡수율 정점(참고)
  const recentNet = tm.slice(-30);
  const fedBuy4 = fwP4 && fwLast ? {
    bills: fwLast.bills - fwP4.bills, nb: fwLast.notesBonds - fwP4.notesBonds,
    tips: fwLast.tips - fwP4.tips, total: fwLast.total - fwP4.total,
  } : null;

  return (
    <Card className="p-3.5">
      <div className="mb-1 flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm font-semibold">재무부 국채 발행 &amp; 연준 흡수 <span className="text-[11px] font-normal text-muted-foreground">시장성 국채 종류별 · 연준 SOMA · {last.date.slice(0, 7)}</span></div>
          <div className="text-[11px] text-muted-foreground">재무부가 얼마를(어떤 만기로) 찍어내고, 그중 연준이 얼마나 사서 들고 있는지(흡수율). QT로 연준 비중이 줄면 그만큼 민간이 더 받쳐야 한다.</div>
        </div>
        <div className="text-right shrink-0 text-[12px] tabular-nums">
          <div>시장성 총 <b>{T(last.total)}</b> · 연준 보유 <b>{T(last.fedTotal)}</b></div>
          <div>연준 흡수율 <b className="text-rose-500">{pct(last.fedShare)}</b> <span className="text-muted-foreground">(정점 {pct(peak.fedShare)} · {peak.date.slice(0, 7)})</span></div>
        </div>
      </div>

      {/* 종류별 잔액 스택 */}
      <Legend items={[["단기 Bills", TB.bill], ["중기 Notes", TB.note], ["장기 Bonds", TB.bond], ["TIPS", TB.tips], ["FRN", TB.frn]]} />
      <div className="h-[190px] mt-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={tm} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <XAxis dataKey="date" tickFormatter={yr} minTickGap={44} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
            <YAxis tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}조`} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={40} className="text-muted-foreground" />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any, n: any) => [T(v), n]} labelFormatter={(l) => String(l).slice(0, 7)} />
            <Area dataKey="bills" name="단기 Bills" stackId="1" stroke={TB.bill} fill={TB.bill} fillOpacity={0.55} />
            <Area dataKey="notes" name="중기 Notes" stackId="1" stroke={TB.note} fill={TB.note} fillOpacity={0.55} />
            <Area dataKey="bonds" name="장기 Bonds" stackId="1" stroke={TB.bond} fill={TB.bond} fillOpacity={0.55} />
            <Area dataKey="tips" name="TIPS" stackId="1" stroke={TB.tips} fill={TB.tips} fillOpacity={0.55} />
            <Area dataKey="frn" name="FRN" stackId="1" stroke={TB.frn} fill={TB.frn} fillOpacity={0.55} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-2">
        <div>
          <div className="text-[12px] font-semibold mb-0.5">연준 흡수율 <span className="text-[10.5px] font-normal text-muted-foreground">= 연준 보유 / 시장성 총액</span></div>
          <div className="h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={tm} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                <defs><linearGradient id="absg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={FED_ABS} stopOpacity={0.35} /><stop offset="100%" stopColor={FED_ABS} stopOpacity={0.03} /></linearGradient></defs>
                <XAxis dataKey="date" tickFormatter={yr} minTickGap={44} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
                <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} domain={[0, "auto"]} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={34} className="text-muted-foreground" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [pct(v), "흡수율"]} labelFormatter={(l) => String(l).slice(0, 7)} />
                <Area dataKey="fedShare" stroke={FED_ABS} strokeWidth={1.5} fill="url(#absg)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <div className="text-[12px] font-semibold mb-0.5">월별 순발행 <span className="text-[10.5px] font-normal text-muted-foreground">종류별 · 잔액 MoM 변화 · 최근 30개월</span></div>
          <div className="h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={recentNet} margin={{ top: 6, right: 8, left: 4, bottom: 0 }} stackOffset="sign">
                <XAxis dataKey="date" tickFormatter={ym} minTickGap={28} tick={{ fontSize: 9, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
                <YAxis tickFormatter={(v) => `${(v / 1e6).toFixed(1)}조`} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={40} className="text-muted-foreground" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any, n: any) => [signed(v), n]} labelFormatter={(l) => String(l).slice(0, 7)} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.4} />
                <Bar dataKey="netBills" name="단기 Bills" stackId="n" fill={TB.bill} />
                <Bar dataKey="netNotes" name="중기 Notes" stackId="n" fill={TB.note} />
                <Bar dataKey="netBonds" name="장기 Bonds" stackId="n" fill={TB.bond} />
                <Bar dataKey="netTips" name="TIPS" stackId="n" fill={TB.tips} />
                <Bar dataKey="netFrn" name="FRN" stackId="n" fill={TB.frn} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 연준 SOMA 만기별 보유 + 최근 4주 매입(Δ) */}
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px] tabular-nums">
        {([["단기 Bills", "bills", "bill"], ["중장기 N&B", "notesBonds", "note"], ["TIPS", "tips", "tips"]] as const).map(([lbl, k, c]) => {
          const cur = fwLast ? (fwLast as any)[k] as number : NaN;
          const buy = fedBuy4 ? (k === "bills" ? fedBuy4.bills : k === "notesBonds" ? fedBuy4.nb : fedBuy4.tips) : NaN;
          return (
            <div key={lbl} className="rounded-md border border-border/60 px-2 py-1.5">
              <div className="flex items-center gap-1 text-muted-foreground text-[10.5px]"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: (TB as any)[c] }} />{lbl}</div>
              <div className="font-semibold">{T(cur)}</div>
              <div className={buy >= 0 ? "text-emerald-500" : "text-red-500"}>{Number.isFinite(buy) ? `4주 ${signed(buy)}` : ""}</div>
            </div>
          );
        })}
        <div className="rounded-md border border-border/60 px-2 py-1.5 bg-muted/30">
          <div className="text-muted-foreground text-[10.5px]">연준 국채 총보유</div>
          <div className="font-semibold text-rose-500">{fwLast && T(fwLast.total)}</div>
          <div className={fedBuy4 && fedBuy4.total >= 0 ? "text-emerald-500" : "text-red-500"}>{fedBuy4 ? `4주 ${signed(fedBuy4.total)}` : ""}</div>
        </div>
      </div>
    </Card>
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


  if (isLoading) return <div className="p-6 space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-96 w-full" /></div>;
  if (!weeks.length) return <div className="p-6 text-sm text-muted-foreground">데이터가 없습니다.</div>;

  const latest = weeks[weeks.length - 1];
  const lendAlert = latest.loans > 100_000; // >$1000억이면 경보(평상시 <$300억)
  // QT/QE 속도 = 선택 주차의 총자산 분기(13주) 변화를 월평균으로(musd/월). 기본=최신=현재.
  //   국면(배지·푸터 공통 단일출처, §2.5): 월평균 ≥+$50억=QE / ≤−$50억=QT / 사이=중립.
  //   임계 $50억(=5,000musd)은 0 근처에서 배지가 깜빡이지 않게 하는 데드밴드.
  const paceSel = curIdx >= 13 ? (weeks[curIdx].total - weeks[curIdx - 13].total) / 3 : NaN;
  const phase = !Number.isFinite(paceSel) ? "unknown" : paceSel >= 5_000 ? "QE" : paceSel <= -5_000 ? "QT" : "중립";
  const phaseCol = phase === "QE" ? "text-emerald-500" : phase === "QT" ? "text-red-500" : "text-muted-foreground";

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
          <div className="text-[12px] tabular-nums flex items-center gap-1.5">
            {/* 주차 stepper — 슬라이더 미세조정 없이 1주씩 앞뒤로. 맨앞/맨뒤면 회색 비활성화. */}
            <span className="flex items-center gap-0.5">
              <button type="button" onClick={() => setIdx(Math.max(0, curIdx - 1))} disabled={curIdx <= 0}
                aria-label="이전 주" title="이전 주"
                className="px-0.5 text-[11px] leading-none text-foreground/70 hover:text-foreground disabled:opacity-25 disabled:cursor-default">◀</button>
              <button type="button" onClick={() => setIdx(Math.min(weeks.length - 1, curIdx + 1))} disabled={curIdx >= weeks.length - 1}
                aria-label="다음 주" title="다음 주"
                className="px-0.5 text-[11px] leading-none text-foreground/70 hover:text-foreground disabled:opacity-25 disabled:cursor-default">▶</button>
            </span>
            <span><b>{sel && weekLabel(sel.date)}</b> <span className="text-muted-foreground">({sel?.date})</span> · 총자산 <b>{sel && T(sel.total)}</b></span>
          </div>
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
        <Card className="p-3.5">
          <div className="mb-2 text-sm font-semibold">T-계정 <span className="text-[11px] font-normal text-muted-foreground tabular-nums">{sel && weekLabel(sel.date)} · 구성비</span></div>
          {sel && <TAccount w={sel} />}
        </Card>
        <Card className="p-3.5 flex flex-col">
          {/* 헤더 + 국면 배지(13주 속도 파생) */}
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">주간 유동성 변화</div>
            <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${
              phase === "QE" ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/10"
              : phase === "QT" ? "border-red-500/40 text-red-500 bg-red-500/10"
              : "border-border text-muted-foreground"}`}>
              {phase === "QE" ? "QE 국면" : phase === "QT" ? "QT 국면" : "중립"}
            </span>
          </div>
          {/* 서브: 전주 → 이번주 · 억 달러 */}
          {sel && selPrev && (
            <div className="mb-1.5 text-[11px] text-muted-foreground tabular-nums">
              {weekRange(selPrev.date, sel.date)} · 전주 <b className="text-foreground">{T(selPrev.reserves)}</b> → 이번주 <b className="text-foreground">{T(sel.reserves)}</b> · 단위 억 달러
            </div>
          )}
          {sel && selPrev ? (
            <>
              <DeltaWaterfall prev={selPrev} now={sel} />
              <div className="mt-1"><FlowSummary prev={selPrev} now={sel} /></div>
            </>
          ) : <div className="py-6 text-center text-[12px] text-muted-foreground">첫 주는 이전 주가 없어 표시할 수 없습니다.</div>}
          {/* QE/QT 속도 — 워터폴과 동일 층위의 별도 섹션(타이틀 부여, §2.5) */}
          <div className="mt-auto border-t border-border pt-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">월간 유동성 추세</div>
              <div className={`text-[15px] font-bold tabular-nums ${phaseCol}`}>
                {Number.isFinite(paceSel) ? `${signed(paceSel)}/월 · ${phase}` : "—"}
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground">총자산 13주 흐름 · 지금 QE인지 QT인지</div>
          </div>
        </Card>
      </div>

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

      {/* 국채 수급: 재무부 발행(종류별) ↔ 연준 흡수(SOMA) — 전체기간, 슬라이더 무관 */}
      {data?.treasury && data.treasury.monthly.length > 0 && <TreasurySupply t={data.treasury} />}
    </div>
  );
}
