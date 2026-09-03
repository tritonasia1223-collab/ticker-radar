import { useMemo, useState, useRef, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceArea, ReferenceLine, ReferenceDot,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// 온커서 설명(스타일 툴팁) — native title 대체. 커서 위 항목에 '?'(cursor-help) + 깔끔한 팝오버.
function Hint({ content, children, side = "top", className }: {
  content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; className?: string;
}) {
  return (
    <UITooltip delayDuration={80}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className={cn("max-w-[248px] text-[12px] leading-relaxed font-normal", className)}>
        {content}
      </TooltipContent>
    </UITooltip>
  );
}

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
interface Seg { label: string; val: number; color: string; sub?: [string, number][]; desc?: string; node?: string }
const STACK_H = 320;
function StackColumn({ segs, total, align, group, selected, onSelect }: {
  segs: Seg[]; total: number; align: "left" | "right";
  group?: { label: string; count: number }; // 앞 count 개 세그먼트를 상위 분류로 묶는 브래킷(왼쪽)
  selected?: string; onSelect?: (node: string) => void; // 노드 선택(우측 캔버스 전환)
}) {
  const stack = (
    <div className="flex flex-1 flex-col rounded-md" style={{ height: STACK_H }}>
      {segs.map((s, i) => {
        const h = Math.max(0, (s.val / total) * STACK_H);
        const pct = ((s.val / total) * 100).toFixed(1);
        const fg = textOn(s.color);
        const isSel = !!s.node && s.node === selected;
        const clickable = !!s.node && !!onSelect;
        return (
          <div key={i} data-selseg={isSel ? "1" : undefined} onClick={clickable ? () => onSelect!(s.node!) : undefined}
            style={{
              height: h, background: s.color, color: fg,
              transform: isSel ? "scale(1.035)" : undefined,
              boxShadow: isSel ? "0 4px 14px rgba(0,0,0,0.22), inset 0 0 0 2px rgba(255,255,255,0.72)" : undefined,
              transition: "transform 0.18s ease, box-shadow 0.18s ease",
              zIndex: isSel ? 20 : undefined,
            }}
            className={`relative flex flex-col justify-center overflow-hidden border-t border-black/10 first:border-t-0 first:rounded-t-md last:rounded-b-md ${clickable ? "cursor-pointer" : ""} ${align === "right" ? "items-end pr-2.5" : "items-start pl-2.5"}`}>
            {isSel && h >= 16 && <span className={`absolute top-0.5 text-[10.5px] font-bold ${align === "right" ? "left-1.5" : "right-1.5"}`} style={{ color: fg }}>✓</span>}
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

function TAccount({ w, selected, onSelect }: { w: WeekPoint; selected?: string; onSelect?: (n: string) => void }) {
  // SOMA 를 국채/MBS/기관채로 분할 표시(캡처 요청). 기관채는 잔존 미미해 얇은 띠. node = 우측 캔버스 키.
  const assets: Seg[] = [
    { label: "국채", val: w.treast, color: A_SOMA, node: "treast", desc: "연준이 사서 보유한 미국 국채(SOMA). 양적완화(QE)의 핵심 — 돈을 풀며 매입, QT 땐 만기분을 재투자 안 하고 축소." },
    { label: "MBS", val: w.mbs, color: A_MBS, node: "mbs", desc: "주택저당증권. 연준이 보유한 모기지 채권 — 2008·2020 위기 때 주택시장 지원 위해 대량 매입." },
    { label: "기관채", val: w.agency, color: A_AGENCY, node: "agency", desc: "연방기관(패니메이 등) 발행 채권. 현재 잔액은 미미." },
    { label: "대출·스왑", val: w.loans, color: A_LOAN, node: "loans", sub: [["할인창구", w.discount], ["BTFP", w.btfp], ["레포", w.repo], ["스왑", w.swap]], desc: "은행에 빌려준 긴급대출(할인창구·BTFP·레포)과 외국 중앙은행 통화스왑. 평상시 바닥, 위기 때 급증." },
    { label: "기타자산", val: Math.max(0, w.assetResidual), color: A_RESID, node: "assetResidual", desc: "금·SDR·미수이자 등 나머지 자산(잔차)." },
  ];
  const liabs: Seg[] = [
    { label: "지급준비금", val: w.reserves, color: L_RES, node: "reserves", desc: "은행들이 연준에 맡긴 예치금. 시중 유동성의 핵심 지표 — 연준 자산의 반대편(부채)." },
    { label: "역레포", val: w.rrp, color: L_RRP, node: "rrp", desc: "MMF 등이 연준에 하룻밤 맡기고 이자 받는 자금(ON RRP). 늘면 시중에서 돈이 빠져 준비금 감소." },
    { label: "TGA", val: w.tga, color: L_TGA, node: "tga", desc: "재무부의 연준 당좌계좌(정부 지갑). 세금 걷히면↑·지출하면↓. 늘면 시중 유동성 흡수." },
    { label: "현금통화", val: w.currency, color: L_CUR, node: "currency", desc: "시중에 유통되는 지폐(연준 부채). 완만히 증가." },
    { label: "기타·자본", val: Math.max(0, w.liabResidual), color: L_RESID, node: "liabResidual", desc: "해외공식예금·기타부채·자본금 등 나머지(잔차)." },
  ];
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-muted-foreground"><span className="font-medium">자산</span><span className="tabular-nums text-foreground font-semibold">{T(w.total)}</span></div>
        <StackColumn segs={assets} total={w.total} align="left" group={{ label: "SOMA", count: 3 }} selected={selected} onSelect={onSelect} />
      </div>
      <div className="mt-6 w-px bg-border" style={{ height: STACK_H }} />
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-muted-foreground"><span className="tabular-nums text-foreground font-semibold">{T(w.total)}</span><span className="font-medium">부채·자본</span></div>
        <StackColumn segs={liabs} total={w.total} align="right" selected={selected} onSelect={onSelect} />
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

// §5.3 앵커형 워터폴: 전주 준비금(보라 앵커) → 기여도 계단 → 이번주 준비금(보라 앵커).
//   축을 준비금 레벨 근방으로 줌(억 단위 기여도가 보이게) + 앵커 하단 빗금으로 '조 단위 축약' 정직 표시.
//   기여도 = 항등식 각 항(자산 동부호 / 부채 반대부호). 유입=청록 / 유출=적색 (1규칙).
function DeltaWaterfall({ prev, now }: { prev: WeekPoint; now: WeekPoint }) {
  const factors = [
    { key: "assets", name: "자산", own: now.total - prev.total, asset: true },
    { key: "tga", name: "TGA", own: now.tga - prev.tga, asset: false },
    { key: "rrp", name: "역레포", own: now.rrp - prev.rrp, asset: false },
    { key: "cur", name: "현금통화", own: now.currency - prev.currency, asset: false },
    { key: "other", name: "기타·자본", own: now.liabResidual - prev.liabResidual, asset: false },
  ].map((f) => ({ ...f, eff: f.asset ? f.own : -f.own }));
  const start = prev.reserves, end = now.reserves, net = end - start;
  // 검산 가드: Σ기여도 == Δ준비금(±반올림). 잔차는 '기타'에 흡수해 합을 정확히 맞춘다.
  const resid = net - factors.reduce((s, f) => s + f.eff, 0);
  if (Math.abs(resid) > 50) console.warn(`[waterfall] Σ기여도 != Δ준비금, 잔차 ${resid} → 기타 흡수`);
  factors[4] = { ...factors[4], eff: factors[4].eff + resid };

  // 누적 레벨: 전주 준비금에서 기여도만큼 계단, cum[5] == 이번주 준비금.
  const cum: number[] = [start];
  for (const f of factors) cum.push(cum[cum.length - 1] + f.eff);
  const dMax = Math.max(...cum), dMin = Math.min(...cum);
  const span = Math.max(dMax - dMin, 1);
  const hi = dMax + span * 0.5, lo = dMin - span * 1.1; // 하단 여유(앵커·빗금)
  const yTop = 22, yBot = 116, anchorBase = yBot - 6;
  const y = (v: number) => yTop + ((hi - v) / (hi - lo)) * (yBot - yTop);

  const N = 7, x0 = 6, colW = 46, barW = 24;
  const cx = (i: number) => x0 + colW * i + colW / 2;
  const W = x0 + colW * N + 4;

  type Col = { i: number; kind: "anchor" | "flow"; key: string; name: string; level?: number; own?: number; eff?: number };
  const cols: Col[] = [
    { i: 0, kind: "anchor", key: "prev", name: "전주", level: start },
    ...factors.map((f, k) => ({ i: k + 1, kind: "flow" as const, key: f.key, name: f.name, own: f.own, eff: f.eff })),
    { i: 6, kind: "anchor", key: "now", name: "이번주", level: end },
  ];

  return (
    <svg viewBox={`0 0 ${W} 138`} className="w-full" style={{ maxHeight: 210 }}>
      {/* 상단 캡션 — 자산=돈 총량, 나머지=자리이동. 색 규칙 1개(유입 청록/유출 적색). */}
      <text x={cx(1)} y={9} textAnchor="middle" fontSize={8.5} fill="hsl(var(--muted-foreground))">돈 총량</text>
      <text x={(cx(2) + cx(5)) / 2} y={9} textAnchor="middle" fontSize={8.5} fill="hsl(var(--muted-foreground))">자리 이동 (준비금 ↔ 계정)</text>

      {/* 레벨 커넥터 점선 */}
      {cols.slice(0, -1).map((c, i) => (
        <line key={`c${i}`} x1={cx(c.i) + barW / 2} y1={y(cum[i])} x2={cx(cols[i + 1].i) - barW / 2} y2={y(cum[i])}
          stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.55} />
      ))}

      {cols.map((c, idx) => {
        if (c.kind === "anchor") {
          const yl = y(c.level!);
          const bx = cx(c.i) - barW / 2;
          const lvlStr = `$${(c.level! / 1e6).toFixed(2)}조`; // 억 정밀도(2자리 조) — 양끝 동일표기 방지
          const tip = c.key === "prev"
            ? `전주 지급준비금 ${lvlStr}`
            : `이번주 지급준비금 ${lvlStr} · 전주 대비 ${signed(net)}`;
          return (
            <Hint key={c.key} content={tip} side="top">
              <g style={{ cursor: "help" }}>
                <rect x={cx(c.i) - colW / 2} y={0} width={colW} height={138} fill="transparent" />
                <rect x={bx} y={yl} width={barW} height={Math.max(anchorBase - yl, 2)} rx={2} fill={L_RES} opacity={0.9} />
                {/* 빗금(축 축약: 수준=조, 변화=억) */}
                <line x1={bx - 1} y1={anchorBase + 3} x2={bx + 7} y2={anchorBase - 3} stroke={L_RES} strokeWidth={1} />
                <line x1={bx + 4} y1={anchorBase + 3} x2={bx + 12} y2={anchorBase - 3} stroke={L_RES} strokeWidth={1} />
                <text x={cx(c.i)} y={yl - 4} textAnchor="middle" fontSize={8.5} fontWeight={700} fill={L_RES}>{lvlStr}</text>
                <text x={cx(c.i)} y={130} textAnchor="middle" fontSize={8.5} fontWeight={600} fill={L_RES}>{c.name}</text>
              </g>
            </Hint>
          );
        }
        const fi = c.i - 1, f0 = cum[fi], f1 = cum[fi + 1];
        const yA = y(Math.max(f0, f1)), yB = y(Math.min(f0, f1));
        const h = Math.max(Math.abs(yB - yA), 1.5);
        const rises = (c.eff ?? 0) >= 0;
        const color = rises ? FLOW_UP : FLOW_DN;
        const valY = rises ? yA - 3 : yB + 10;
        const shortNm = c.name.replace("현금통화", "현금").replace("기타·자본", "기타");
        const dir = rises ? "유입" : "유출"; // 준비금 효과 방향(계정명 단독 병기 시 부호 뒤집혀 읽힘 방지)
        return (
          <Hint key={c.key} side="top" content={
            <><div>{flowSentence(c.key, c.name, c.own!, c.eff!)}</div>
              <div className="mt-1 text-muted-foreground">원계정: {c.name} 잔고 {signed(c.own!)} → 준비금 {signed(c.eff!)}</div></>}>
            <g style={{ cursor: "help" }}>
              <rect x={cx(c.i) - colW / 2} y={0} width={colW} height={138} fill="transparent" />
              <rect x={cx(c.i) - barW / 2} y={yA} width={barW} height={h} rx={2} fill={color} opacity={0.9} style={{ transition: "y 0.3s ease, height 0.3s ease" }} />
              <text x={cx(c.i)} y={valY} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={color}>{signed(c.eff!)}</text>
              <text x={cx(c.i)} y={130} textAnchor="middle" fontSize={8} fill="hsl(var(--foreground))">{shortNm} <tspan fill={color} fontWeight={700}>{dir}</tspan></text>
            </g>
          </Hint>
        );
      })}
    </svg>
  );
}

// 요약 문장 — 자동 생성 템플릿(§1~§6). 문장 안 산수가 닫히고, 항목 표기는 막대 라벨과 동일 문법(유출/유입).
//   기여도 = 항등식 각 항(자산 동부호 / 부채 반대부호). Σ기여도 ≡ Δ준비금(대수적 정확). 억 단위 정수.
const FLOW_T = { FLAT: 30, ONE: 30, DOM: 0.75, TIE: 0.15 }; // §3 상수(보합/일방향/단일지배/팽팽)
function FlowSummary({ prev, now, phase }: { prev: WeekPoint; now: WeekPoint; phase: string }) {
  // §1 기여도(억, 정수). 항목명은 막대 라벨과 동일 상수(자산/TGA/역레포/현금통화/기타·자본).
  const raw = [
    { name: "자산", eff: now.total - prev.total },
    { name: "TGA", eff: -(now.tga - prev.tga) },
    { name: "역레포", eff: -(now.rrp - prev.rrp) },
    { name: "현금통화", eff: -(now.currency - prev.currency) },
    { name: "기타·자본", eff: -(now.liabResidual - prev.liabResidual) },
  ];
  const net = Math.round((now.reserves - prev.reserves) / 100);          // Δ준비금(억)
  const items = raw.map((f) => ({ name: f.name, v: Math.round(f.eff / 100), eff: f.eff }));
  // 반올림 드리프트를 최대 |기여도| 항목에 흡수 → Σv == net 정확히(문장 산수 폐합).
  const drift = net - items.reduce((s, x) => s + x.v, 0);
  if (drift !== 0) { const bi = items.reduce((mi, x, i, a) => (Math.abs(x.eff) > Math.abs(a[mi].eff) ? i : mi), 0); items[bi].v += drift; }
  const I = items.filter((x) => x.v > 0).reduce((s, x) => s + x.v, 0);   // 유입 총액
  const O = items.filter((x) => x.v < 0).reduce((s, x) => s - x.v, 0);   // 유출 총액(양수)

  const money = (v: number) => "$" + Math.abs(v).toLocaleString() + "억"; // 절대값 · 콤마 · 억
  const P = "text-[12px] leading-relaxed text-muted-foreground";
  const dir = net < 0 ? "감소" : "증가";
  const netCol = net < 0 ? FLOW_DN : FLOW_UP;
  const netChip = <b style={{ color: netCol }}>{money(net)} {dir}</b>; // 순변화(숫자+방향)에 색·굵게

  // §1 검산 가드: I−O ≠ net(±1억)이면 상세 문장 포기 → 한 줄 + warn.
  if (!Number.isFinite(net) || Math.abs(I - O - net) > 1) {
    console.warn("[flow] 검산 실패 — I,O,net:", I, O, net);
    return <p className={P}>이번 주 준비금 {netChip}</p>;
  }

  const domWord = net < 0 ? "유출" : "유입", oppWord = net < 0 ? "유입" : "유출";
  const domTotal = net < 0 ? O : I, oppTotal = net < 0 ? I : O, gross = O + I;
  const domItems = items.filter((x) => (net < 0 ? x.v < 0 : x.v > 0)).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const topDom = domItems[0];
  // §4-C6 자산 부연: 최대 항목이 자산이고 방향이 정책 뱃지와 일치(QT↔유출·QE↔유입)하면 괄호 부연.
  const sfx = (it?: { name: string }) => (it && it.name === "자산" && ((net < 0 && phase === "QT") || (net > 0 && phase === "QE")) ? (net < 0 ? "(QT 축소)" : "(QE 확대)") : "");
  const item = (it: { name: string; v: number }) => `${it.name} ${domWord} ${money(it.v)}${sfx(it)}`;

  // §4-C0 보합
  if (Math.abs(net) < FLOW_T.FLAT)
    return <p className={P}>이번 주 준비금은 거의 그대로예요({netChip}). 유출 {money(O)}과 유입 {money(I)}이 상쇄됐어요.</p>;

  // §4-C5 일방향(반대방향 총액이 T_ONE 미만)
  if (oppTotal < FLOW_T.ONE)
    return <p className={P}>이번 주 준비금 {netChip} — 전 항목이 {domWord}이었어요. 최대는 {item(topDom)}.</p>;

  // §4-C3 단일 지배(최대 항목이 총유량 O+I 의 75% 이상)
  if (Math.abs(topDom.v) >= FLOW_T.DOM * gross)
    return <p className={P}>이번 주 준비금 {netChip} — 사실상 {item(topDom)}이 주도했어요 ({oppWord}은 {money(oppTotal)}).</p>;

  // §4-C1/C2 기본 (+ §4-C4 팽팽)
  const tie = domItems.length >= 2 && (Math.abs(domItems[0].v) - Math.abs(domItems[1].v)) / Math.abs(domItems[0].v) < FLOW_T.TIE;
  const second = tie
    ? `${item(domItems[0])}과 ${item(domItems[1])}이 나란히 컸어요.`
    : `최대 ${domWord}은 ${item(topDom)}.`;
  return <p className={P}>이번 주 준비금 {netChip} — {domWord} {money(domTotal)}이 {oppWord} {money(oppTotal)}을 넘었어요. {second}</p>;
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
      {items.map(([n, c]) => <span key={n} className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: c }} />{n}</span>)}
    </div>
  );
}

// 스크롤 섹션 구획 라벨(탭 대신 밴드로 '연준 / 국채' 나눔).
function BandLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1.5">
      <span className="text-[11px] font-bold tracking-wide text-muted-foreground">{children}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ── L2 확장 캔버스 — T-계정 세그먼트(노드) 선택 시 우측에 그 노드의 '이야기' ──
const NODE_META: Record<string, { key: keyof WeekPoint; color: string; label: string }> = {
  treast: { key: "treast", color: A_SOMA, label: "국채(SOMA)" },
  mbs: { key: "mbs", color: A_MBS, label: "MBS" },
  agency: { key: "agency", color: A_AGENCY, label: "기관채" },
  loans: { key: "loans", color: A_LOAN, label: "대출·스왑" },
  assetResidual: { key: "assetResidual", color: A_RESID, label: "기타자산" },
  reserves: { key: "reserves", color: L_RES, label: "지급준비금" },
  rrp: { key: "rrp", color: L_RRP, label: "역레포" },
  tga: { key: "tga", color: L_TGA, label: "TGA" },
  currency: { key: "currency", color: L_CUR, label: "현금통화" },
  liabResidual: { key: "liabResidual", color: L_RESID, label: "기타·자본" },
};

function NodeCanvas({ node, weeks, sel, selPrev, treasury, phase }: {
  node: string; weeks: WeekPoint[]; sel: WeekPoint | null; selPrev: WeekPoint | null; treasury?: Treasury; phase: string;
}) {
  const meta = NODE_META[node] ?? NODE_META.reserves;
  // 준비금 → 앵커형 워터폴(그 주 분해)
  if (node === "reserves") {
    const jo = (v: number) => `$${(v / 1e6).toFixed(2)}조`; // 억 정밀도 조(변화가 보이도록 소수 2자리)
    const sameMonth = !!sel && !!selPrev && selPrev.date.slice(0, 7) === sel.date.slice(0, 7);
    const nowWk = sel ? (sameMonth ? weekLabel(sel.date).replace(/^\d+월\s/, "") : weekLabel(sel.date)) : "";
    return (
      <div className="flex flex-col h-full">
        <div className="text-sm font-semibold" style={{ color: L_RES }}>지급준비금</div>
        {sel && selPrev && (
          <div className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
            {weekLabel(selPrev.date)} <b className="text-foreground">{jo(selPrev.reserves)}</b> → {nowWk} <b className="text-foreground">{jo(sel.reserves)}</b>
          </div>
        )}
        <div className="flex-1 flex flex-col justify-center min-h-0">
          {sel && selPrev ? (
            <div data-canvas="1"><DeltaWaterfall prev={selPrev} now={sel} /><div className="mt-2"><FlowSummary prev={selPrev} now={sel} phase={phase} /></div></div>
          ) : <div className="py-6 text-center text-[12px] text-muted-foreground">첫 주는 이전 주가 없어 표시할 수 없습니다.</div>}
        </div>
      </div>
    );
  }
  // 국채 → 만기별 분해(연준 보유 SOMA)
  if (node === "treast" && treasury && treasury.fedWeekly.length) {
    const fw = treasury.fedWeekly;
    let cur = fw[fw.length - 1];
    for (const w of fw) { if (sel && w.date <= sel.date) cur = w; else break; }
    const tips = cur.total - cur.bills - cur.notesBonds;
    const rows: [string, number, string, string][] = [
      ["단기 Bills", cur.bills, TB.bill, "만기 1년 이하"],
      ["중장기 Notes·Bonds", cur.notesBonds, TB.note, "만기 2~30년"],
      ["TIPS", tips, TB.tips, "물가연동"],
    ];
    const H = 236;
    return (
      <div className="flex flex-col h-full">
        <div className="text-sm font-semibold" style={{ color: A_SOMA }}>국채(SOMA) <span className="text-[11px] font-normal text-muted-foreground">연준 보유 만기별 분해 · {cur.date}</span></div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">총 <b className="text-foreground">{T(cur.total)}</b> = 좌측 T-계정 ‘국채’와 <b style={{ color: A_SOMA }}>같은 값</b> — 같은 막대의 확대. 시장 대비 흡수율은 아래.</div>
        <div className="flex-1 flex flex-col justify-center min-h-0">
        <div className="flex gap-3" style={{ height: H }}>
          {/* 세로 누적 막대 = T-계정 '국채' 막대의 확대(같은 색) */}
          <div data-canvas="1" className="w-16 shrink-0 flex flex-col rounded-md overflow-hidden">
            {rows.map(([lbl, val, color]) => { const sh = (val / cur.total) * H; return (
              <div key={lbl} style={{ height: sh, background: color }} className="flex items-center justify-center overflow-hidden border-t border-black/10 first:border-t-0 text-white text-[10px] font-semibold">{sh >= 16 ? T(val).replace("$", "") : ""}</div>
            ); })}
          </div>
          <div className="w-64 max-w-full flex flex-col">
            {rows.map(([lbl, val, color, tip]) => { const sh = (val / cur.total) * H; return (
              <div key={lbl} style={{ height: sh }} className="flex items-center gap-1.5 overflow-hidden border-t border-border/40 first:border-t-0">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
                <span className="text-[12px] leading-tight">{lbl} <span className="text-[10px] text-muted-foreground">{tip}</span></span>
                <b className="ml-auto pl-2 text-[12px] tabular-nums">{T(val)}</b>
              </div>
            ); })}
          </div>
        </div>
        </div>
      </div>
    );
  }
  // 그 외 계정 → 잔액 시계열 + 선택 주 마커
  const key = meta.key;
  return (
    <div className="flex flex-col h-full">
      <div className="text-sm font-semibold" style={{ color: meta.color }}>{meta.label} <span className="text-[11px] font-normal text-muted-foreground">잔액 추이</span></div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">선택 주 <b style={{ color: meta.color }} className="tabular-nums">{sel ? T(sel[key] as number) : "—"}</b> · {sel?.date}</div>
      <div className="flex-1 flex flex-col justify-center min-h-0 mt-1">
        <div className="h-[188px]" data-canvas="1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weeks} margin={{ top: 8, right: 8, left: 6, bottom: 0 }}>
              <XAxis dataKey="date" tickFormatter={yr} minTickGap={40} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
              <YAxis tickFormatter={(v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}조` : `$${Math.round(v / 100).toLocaleString()}억`)} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={48} className="text-muted-foreground" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [T(v), meta.label]} labelFormatter={(l) => `${weekLabel(String(l))} (${l})`} />
              <Area dataKey={key} stroke={meta.color} strokeWidth={1.5} fill={meta.color} fillOpacity={0.14} isAnimationActive={false} />
              {sel && <ReferenceLine x={sel.date} stroke={NEG} strokeWidth={1} strokeOpacity={0.5} strokeDasharray="3 3" />}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── 국채 종류(만기 기준) — 온커서 설명 · 잔액키(k)/순발행키(nk)/색 ──
const TB_TYPES = [
  { k: "bills", nk: "netBills", label: "단기 Bills", color: TB.bill, desc: "만기 1년 이하 (4·8·13·17·26·52주)." },
  { k: "notes", nk: "netNotes", label: "중기 Notes", color: TB.note, desc: "만기 2~10년 (2·3·5·7·10년)." },
  { k: "bonds", nk: "netBonds", label: "장기 Bonds", color: TB.bond, desc: "만기 20·30년." },
  { k: "tips", nk: "netTips", label: "TIPS", color: TB.tips, desc: "물가연동국채 · 만기 5·10·30년." },
  { k: "frn", nk: "netFrn", label: "FRN", color: TB.frn, desc: "변동금리채 · 만기 2년." },
] as const;

// ── 연준의 국채 흡수(SOMA 만기별 보유·매입 + 흡수율) — 상단 T-계정의 '국채 매입'을 만기별로 확장 ──
//   상단 슬라이더(selDate)와 연동해 '선택 주' 기준으로 표시. 매입 = 그 주의 전주 대비 Δ(주간).
//   ⚠ 연준 H.4.1 은 Bills / 중장기(Notes+Bonds 합산) / TIPS 3개 라인만 공개 — Notes·Bonds 분리·FRN 별도표기는 불가.
//     TIPS = 총보유 − 단기 − 중장기 (물가보정분 포함 → 3버킷이 총계와 정확히 합치).
function FedAbsorption({ t, selDate }: { t: Treasury; selDate?: string }) {
  const { monthly: tm, fedWeekly: fw } = t;
  const pct = (v: number) => (v * 100).toFixed(1) + "%";
  const [fbucket, setFbucket] = useState<"total" | "bills" | "nb" | "tips">("total"); // 주연 플로우 만기 토글
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);                       // 플로우 차트 hover 월
  // 주간 흡수율 = 연준 국채보유(주간) / 재무부 시장성 총액(월간, 해당 주의 최근 월로 ffill).
  //   만기별(연준 3버킷: 단기 Bills / 중장기 Notes·Bonds / TIPS)도 함께 매칭 —
  //   중장기 분모 = 시장 Notes+Bonds+FRN(연준 WSHONBNL 은 FRN 을 nominal 로 포함하므로 분모도 합산).
  const weekly = useMemo(() => {
    let ti = 0, m: typeof tm[number] | null = null;
    return fw.map((w) => {
      while (ti < tm.length && tm[ti].date <= w.date) { m = tm[ti]; ti++; }
      const fedTips = w.total - w.bills - w.notesBonds;
      const mBills = m?.bills ?? NaN, mNb = m ? m.notes + m.bonds + m.frn : NaN, mTips = m?.tips ?? NaN, mTot = m?.total ?? NaN;
      return {
        date: w.date, fedBills: w.bills, fedNb: w.notesBonds, fedTips, fedTotal: w.total,
        mBills, mNb, mTips, mTotal: mTot,
        share: Number.isFinite(mTot) && mTot ? w.total / mTot : NaN,
      };
    });
  }, [fw, tm]);

  // ── 플로우(주연) 원자료: 월별 순발행(공급) vs 연준 보유증감 ΔHoldings ──
  //   ΔHoldings = 매입 − 만기상환 − 매도 (= 월 마지막 수요일 H.4.1 ffill 의 MoM Δ). QT 롤오프면 음수.
  //   버킷: 단기 ΔWSHOBL / 중장기 ΔWSHONBNL(FRN 포함) / TIPS ΔWSHONBIIL(물가보정 WSHOICL 제외 = 원금 기준).
  //   Σ버킷 = Δ(WSHOTSL − WSHOICL) 항등식 자동 성립(구성상). 잔차 = 순발행 − ΔFed = 민간·해외 흡수.
  const flow = useMemo(() => {
    let p = 0; let fedAt: (typeof fw)[number] | null = null;
    const reps = tm.map((pt) => { while (p < fw.length && fw[p].date <= pt.date) { fedAt = fw[p]; p++; } return fedAt; });
    const mk = (sup: number, fed: number) => ({ sup, fed, res: sup - fed });
    return tm.map((pt, i) => {
      const fn = reps[i], fp = i > 0 ? reps[i - 1] : null;
      if (!fn || !fp) return null;
      const dBills = fn.bills - fp.bills, dNb = fn.notesBonds - fp.notesBonds, dTips = fn.tips - fp.tips; // dTips = ΔWSHONBIIL(물가보정 제외)
      return { date: pt.date, bills: mk(pt.netBills, dBills), nb: mk(pt.netNotes + pt.netBonds + pt.netFrn, dNb), tips: mk(pt.netTips, dTips), total: mk(pt.netTotal, dBills + dNb + dTips) };
    });
  }, [fw, tm]);

  const finite = weekly.filter((x) => Number.isFinite(x.share));
  if (!finite.length) return null;
  // 선택 주(상단 슬라이더 연동): selDate 이하 최근 주. 없으면 최신.
  let selIdx = weekly.length - 1;
  if (selDate) { for (let i = 0; i < weekly.length; i++) { if (weekly[i].date <= selDate) selIdx = i; else break; } }
  const cur = weekly[selIdx];
  const peak = finite.reduce((m, x) => (x.share > m.share ? x : m), finite[0]);
  const share = Number.isFinite(cur.share) ? pct(cur.share) : "—";
  // 만기별 3버킷(선택 주) — 연준 보유량(양) + 흡수율. 그래프는 이 3버킷의 보유량 추이가 메인.
  const buckets = [
    { key: "fedBills", label: "단기 Bills", tip: "만기 1년 이하", color: TB.bill, fed: cur.fedBills, mkt: cur.mBills },
    { key: "fedNb", label: "중장기 Notes·Bonds", tip: "만기 2~30년 · FRN 포함", color: TB.note, fed: cur.fedNb, mkt: cur.mNb },
    { key: "fedTips", label: "TIPS", tip: "물가연동", color: TB.tips, fed: cur.fedTips, mkt: cur.mTips },
  ].map((b) => ({ ...b, rate: Number.isFinite(b.fed) && b.mkt ? b.fed / b.mkt : NaN }));

  // 플로우 파생: 선택 월 기준 36개월 창 + 만기 버킷 선택 + 12개월 흡수율 + hover 행.
  const FWIN = 36;
  const selMonth = selDate?.slice(0, 7);
  const firstMonth = tm[0]?.date.slice(0, 7);
  const flowBefore = !!selMonth && !!firstMonth && selMonth < firstMonth;
  const selMi = selMonth ? tm.findIndex((p) => p.date.slice(0, 7) === selMonth) : -1;
  const endMi = selMi >= 0 ? Math.max(selMi, Math.min(FWIN - 1, tm.length - 1)) : tm.length - 1;
  const fk = fbucket;
  const flowWin = flow.slice(Math.max(0, endMi - (FWIN - 1)), endMi + 1).filter(Boolean) as any[];
  const chartData = flowWin.map((r) => ({ date: r.date, sup: r[fk].sup, fed: r[fk].fed, res: r[fk].res }));
  const last12 = flow.slice(Math.max(0, endMi - 11), endMi + 1).filter(Boolean) as any[];
  const sumFed = last12.reduce((s, r) => s + r[fk].fed, 0), sumSup = last12.reduce((s, r) => s + r[fk].sup, 0);
  const flow12 = Math.abs(sumSup) > 20_000 ? sumFed / sumSup : NaN; // 순발행 합 $200억 미만이면 비율 생략(§2-4)
  const hi = hoverIdx != null && hoverIdx >= 0 && hoverIdx < chartData.length ? hoverIdx : chartData.length - 1;
  const hRow = chartData[hi];
  const FB = [{ k: "total", label: "전체" }, { k: "bills", label: "단기" }, { k: "nb", label: "중장기 N·B·FRN" }, { k: "tips", label: "TIPS" }] as const;
  const supColor = fk === "bills" ? TB.bill : fk === "nb" ? TB.note : fk === "tips" ? TB.tips : "#7c3aed";
  const fym = (d: string) => `${d.slice(2, 4)}.${d.slice(5, 7)}`;

  return (
    <Card className="p-3.5">
      {/* 헤더 — 섹션명 교정 + 스톡 보유비중은 우상단 참고 수치로 강등 */}
      <div className="mb-1 flex items-start justify-between gap-2 flex-wrap">
        <div className="text-sm font-semibold flex items-center gap-1">연준의 국채 보유 — 잔액과 증감 <span className="text-[11px] font-normal text-muted-foreground">만기별 · 월간</span>
          <Hint content={<>재무부 <b>순발행</b>(공급)과 같은 기간 연준 <b>보유 증감</b>(수요 밸브)을 나란히 — 잔차 = 민간·해외 흡수.<div className="mt-1 text-muted-foreground">연준은 경매 직접매입 불가 → ‘신규발행 흡수’는 원리상 데이터 없음. 유통시장 매입·롤오프의 순효과인 <b>보유 증감(ΔHoldings)</b>으로 밸브 개폐를 측정. H.4.1 3버킷(단기 / 중장기 N·B·FRN 합산 / TIPS)만 공개.</div></>}>
            <span className="text-[12px] text-muted-foreground cursor-help leading-none">ⓘ</span>
          </Hint>
        </div>
        <div className="text-right text-[11px] text-muted-foreground shrink-0">
          보유 비중(스톡) <b className="text-[12.5px] tabular-nums" style={{ color: FED_ABS }}>{share}</b>
          <span className="text-muted-foreground/70"> · 정점 {peak ? pct(peak.share) : "—"}</span>
        </div>
      </div>

      {/* 만기 토글 + 12개월 플로우 흡수율(누적) */}
      <div className="flex flex-wrap items-center gap-1 mb-1">
        {FB.map((b) => (
          <button key={b.k} type="button" onClick={() => setFbucket(b.k)}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${fk === b.k ? "border-foreground/50 bg-muted font-semibold" : "border-border/60 hover:bg-muted/50"}`}>{b.label}</button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">12개월 흡수율 <b className="tabular-nums" style={{ color: FED_ABS }}>{Number.isFinite(flow12) ? pct(flow12) : "—"}</b></span>
      </div>

      {/* 주연 — 월별 순발행(막대) vs 연준 보유증감(청록 선) */}
      {flowBefore && <div className="text-[11px] text-amber-600 mb-1">⚠ 선택 시점({selMonth})은 발행 데이터(2014~) 이전 — 최신 36개월 기준</div>}
      <div className="h-[186px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 6, bottom: 0 }}
            onMouseMove={(s: any) => setHoverIdx(typeof s?.activeTooltipIndex === "number" ? s.activeTooltipIndex : null)}
            onMouseLeave={() => setHoverIdx(null)}>
            <XAxis dataKey="date" tickFormatter={fym} minTickGap={30} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
            <YAxis tickFormatter={(v) => (v === 0 ? "0" : asMoney(v).replace("$", ""))} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={44} className="text-muted-foreground" />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            {hRow && <ReferenceLine x={hRow.date} stroke={NEG} strokeWidth={1} strokeOpacity={0.35} />}
            <Bar dataKey="sup" name="순발행" fill={supColor} fillOpacity={0.35} isAnimationActive={false} />
            <Line dataKey="fed" name="연준 보유증감" stroke={A_SOMA} strokeWidth={2} dot={{ r: 2, fill: A_SOMA }} isAnimationActive={false} />
            <Tooltip content={() => null} cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.25 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* hover 고정 잔차 문장(§워터폴 요약 패턴) — 기본은 최근월 */}
      {hRow ? (
        <div className="mt-1 text-[12px] tabular-nums">
          <span className="text-muted-foreground">{fym(hRow.date)} · </span>
          순발행 <b>{signed(hRow.sup)}</b> · 연준 <b style={{ color: A_SOMA }}>{signed(hRow.fed)}</b> → 민간·해외 <b>{signed(hRow.res)}</b>
        </div>
      ) : <div className="mt-1 text-[12px] text-muted-foreground">막대에 커서를 올리면 순발행·연준·잔차</div>}
      <div className="mt-0.5 text-[10.5px] text-muted-foreground leading-snug">
        <b>보유 증감</b> = 매입 − 만기상환 − 매도 · 월간 근사(마지막 수요일) · TIPS 물가보정 제외. <span className="text-muted-foreground/80">QT 음수 = 만기분 미재투자로 시장이 새로 받아낸 물량.</span>
      </div>

      {/* 조연 — 만기별 보유 잔액(스톡) 축소 + 버킷 카드 */}
      <div className="mt-2 border-t border-border/50 pt-2">
        <div className="mb-0.5 text-[11px] text-muted-foreground">만기별 보유 잔액(스톡) <span className="text-muted-foreground/70">· {weekLabel(cur.date)}</span></div>
        <div className="h-[104px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={finite} margin={{ top: 4, right: 8, left: 6, bottom: 0 }}>
              <XAxis dataKey="date" tickFormatter={yr} minTickGap={44} tick={{ fontSize: 9, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
              <YAxis tickFormatter={(v) => `${(v / 1e6).toFixed(0)}조`} tick={{ fontSize: 9, fill: "currentColor" }} axisLine={false} tickLine={false} width={34} className="text-muted-foreground" />
              <Area dataKey="fedBills" stackId="s" stroke={TB.bill} fill={TB.bill} fillOpacity={0.5} strokeWidth={0.8} isAnimationActive={false} />
              <Area dataKey="fedNb" stackId="s" stroke={TB.note} fill={TB.note} fillOpacity={0.5} strokeWidth={0.8} isAnimationActive={false} />
              <Area dataKey="fedTips" stackId="s" stroke={TB.tips} fill={TB.tips} fillOpacity={0.5} strokeWidth={0.8} isAnimationActive={false} />
              <ReferenceLine x={cur.date} stroke={NEG} strokeWidth={1} strokeOpacity={0.4} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          {buckets.map((b) => (
            <div key={b.key} className="rounded-md border border-border/60 px-2 py-1">
              <div className="flex items-center gap-1 text-[10.5px] leading-tight"><span className="w-2 h-2 rounded-sm shrink-0" style={{ background: b.color }} /><span className="truncate">{b.label}</span></div>
              <div className="mt-0.5 flex items-baseline justify-between gap-1">
                <b className="text-[12px] tabular-nums">{Number.isFinite(b.fed) ? T(b.fed) : "—"}</b>
                <span className="text-[10px] tabular-nums text-muted-foreground">비중 <b style={{ color: b.color }}>{Number.isFinite(b.rate) ? pct(b.rate) : "—"}</b></span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// 월별 순발행 단일막대 툴팁 — 순액 + 종류별 분해(§6.3).
function NetTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-[12px] text-popover-foreground shadow-md">
      <div className="font-semibold">{String(d.date).slice(0, 7)} 순발행 <span style={{ color: d.netTotal >= 0 ? "#7c3aed" : "#f97316" }}>{signed(d.netTotal)}</span></div>
      <div className="text-muted-foreground mt-0.5 leading-snug">{TB_TYPES.map((x) => `${x.label.replace(/^(단기|중기|장기) /, "")} ${signed(d[x.nk])}`).join(" · ")}</div>
    </div>
  );
}

// ── 재무부 국채 발행(종류별 잔액·순발행) — 공급 측. 각 종류에 온커서 만기 설명 ──
function TreasuryIssuance({ t, selDate }: { t: Treasury; selDate?: string }) {
  const tm = t.monthly;
  const last = tm.at(-1);
  const [hoverK, setHoverK] = useState<string | null>(null);
  const [pctMode, setPctMode] = useState(false); // 절대액 ↔ 구성비(%) — '단기화 여부'는 비중으로
  if (!last) return null;
  const ym = (d: string) => `${d.slice(2, 4)}.${d.slice(5, 7)}`;
  const active = TB_TYPES.find((x) => x.k === hoverK) ?? null;
  const dim = (k: string) => (active && active.k !== k ? true : false);
  // 선택 주차(timeState) → 그 달의 데이터 포인트 날짜. 월간 차트에 수직 가이드라인으로.
  const selMonth = selDate?.slice(0, 7);
  const guideDate = selMonth ? tm.find((p) => p.date.slice(0, 7) === selMonth)?.date : undefined;
  // 순발행 창: '선택 월에서 끝나는 30개월'. 데이터 시작(2014) 근처면 30개월을 시작에 고정(늘어남 방지),
  //   선택월이 2014 이전이면 beforeData=true → 차트 대신 '데이터 없음'. 미래월(최신 MSPD 이후)은 최신 30.
  const WINDOW = 30;
  const firstMonth = tm[0]?.date.slice(0, 7);
  const selMi = selMonth ? tm.findIndex((p) => p.date.slice(0, 7) === selMonth) : -1;
  const beforeData = !!selMonth && !!firstMonth && selMonth < firstMonth;
  const endMi = selMi >= 0 ? Math.max(selMi, Math.min(WINDOW - 1, tm.length - 1)) : tm.length - 1;
  const recentNet = tm.slice(Math.max(0, endMi - (WINDOW - 1)), endMi + 1);
  return (
    <Card className="p-3.5">
      <div className="mb-1 flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm font-semibold flex items-center gap-1">재무부 국채 발행 <span className="text-[11px] font-normal text-muted-foreground">시장성 국채 종류별 · {last.date.slice(0, 7)}</span>
            <Hint content={<>재무부가 자금을 어떤 만기로 조달하는지 — 종류별 잔액과 월별 순발행(발행−상환). 아래 ‘연준의 국채 흡수’가 이 공급의 일부를 받아준다.</>}>
              <span className="text-[12px] text-muted-foreground cursor-help leading-none">ⓘ</span>
            </Hint>
          </div>
          {beforeData && <div className="text-[11px] text-amber-600 mt-0.5">⚠ 선택 시점({selMonth})은 발행 데이터(2014~) 이전 — 아래는 최신 기준 참고용</div>}
        </div>
        <div className="text-right shrink-0 text-[12px] tabular-nums"><div>시장성 총 <b>{T(last.total)}</b></div></div>
      </div>

      {/* 종류 칩 — 클릭 토글(고정). 선택 시 설명·차트 강조 유지, 다시 클릭 해제. */}
      <div className="flex flex-wrap gap-1.5">
        {TB_TYPES.map((x) => (
          <button key={x.k} type="button" onClick={() => setHoverK(hoverK === x.k ? null : x.k)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] cursor-pointer transition-colors ${active?.k === x.k ? "border-foreground/50 bg-muted font-semibold" : "border-border/60 hover:bg-muted/50"}`}>
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: x.color }} />{x.label}
            <span className="tabular-nums text-muted-foreground">{T((last as any)[x.k])}</span>
          </button>
        ))}
      </div>
      <div className="mt-1 min-h-[2.4em] text-[11px] leading-snug text-muted-foreground">
        {active ? <><b className="text-foreground">{active.label}</b> · {active.desc} <span className="text-muted-foreground/70">(다시 클릭 해제)</span></> : "종류를 클릭하면 고정되어 설명·강조가 유지됩니다."}
      </div>

      {/* 종류별 잔액 스택 + 절대액/구성비 토글 */}
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold">종류별 잔액 <span className="text-[10.5px] font-normal text-muted-foreground">{active ? `${active.label} 궤적 · ${tm[0]?.date.slice(0, 4)} ${T((tm[0] as any)[active.k])} → 현재 ${T((last as any)[active.k])}` : pctMode ? "구성비(%) · 단기화 여부" : "시장성 국채 잔액"}</span></div>
        <div className="flex rounded border border-border overflow-hidden text-[10.5px]">
          <button type="button" onClick={() => setPctMode(false)} className={`px-1.5 py-0.5 ${!pctMode ? "bg-muted font-semibold" : "text-muted-foreground"}`}>절대액</button>
          <button type="button" onClick={() => setPctMode(true)} className={`px-1.5 py-0.5 border-l border-border ${pctMode ? "bg-muted font-semibold" : "text-muted-foreground"}`}>구성비%</button>
        </div>
      </div>
      <div className={`h-[180px] ${beforeData ? "opacity-40" : ""}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={tm} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} stackOffset={pctMode ? "expand" : "none"}>
            <XAxis dataKey="date" tickFormatter={yr} minTickGap={44} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
            <YAxis tickFormatter={pctMode ? (v) => `${Math.round(v * 100)}%` : (v) => `$${(v / 1e6).toFixed(1)}조`} domain={pctMode ? [0, 1] : active ? ["auto", "auto"] : undefined} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={44} className="text-muted-foreground" />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any, n: any) => [T(v), n]} labelFormatter={(l) => String(l).slice(0, 7)} />
            {(pctMode || !active)
              ? TB_TYPES.map((x) => <Area key={x.k} dataKey={x.k} name={x.label} stackId="1" stroke={x.color} fill={x.color} fillOpacity={dim(x.k) ? 0.15 : 0.55} isAnimationActive={false} />)
              : <Area key={active.k} dataKey={active.k} name={active.label} stroke={active.color} fill={active.color} fillOpacity={0.3} strokeWidth={2} isAnimationActive={false} />}
            {guideDate && <ReferenceLine x={guideDate} stroke={NEG} strokeWidth={1} strokeOpacity={0.5} strokeDasharray="3 3" />}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* 월별 순발행 — 순액 단일 막대(양수 보라 / 음수 코럴), 종류 분해는 hover(§6.3) */}
      <div className="mt-2">
        <div className="text-[12px] font-semibold mb-0.5">월별 순발행 <span className="text-[10.5px] font-normal text-muted-foreground">발행−상환 순액 · <span style={{ color: "#7c3aed" }}>증가</span>/<span style={{ color: "#f97316" }}>감소</span>{beforeData ? "" : ` · ${recentNet[0]?.date.slice(0, 7)}~${recentNet.at(-1)?.date.slice(0, 7)}`} · 막대 hover=종류별</span></div>
        <div className="h-[150px]">
          {beforeData ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-[12px] text-muted-foreground">
              <div>재무부 국채 종류별 데이터는 <b className="text-foreground">2014년</b>부터 제공됩니다.</div>
              <div className="text-[11px] mt-0.5">더 과거 시점은 표시할 수 없어요. (재무부 MSPD 시작 = {firstMonth})</div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={recentNet} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                <XAxis dataKey="date" tickFormatter={ym} minTickGap={28} tick={{ fontSize: 9, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
                <YAxis tickFormatter={(v) => `${(v / 1e6).toFixed(1)}조`} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={40} className="text-muted-foreground" />
                <Tooltip cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.4 }} content={<NetTip />} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.4} />
                {guideDate && <ReferenceLine x={guideDate} stroke={NEG} strokeWidth={1} strokeOpacity={0.5} strokeDasharray="3 3" />}
                <Bar dataKey="netTotal" isAnimationActive={false}>
                  {recentNet.map((d, i) => <Cell key={i} fill={d.netTotal >= 0 ? "#7c3aed" : "#f97316"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function Fed() {
  const { data, isLoading } = useQuery<Overview>({ queryKey: ["/api/fed/overview"] });
  const [idx, setIdx] = useState<number>(-1);
  const [crisisOpen, setCrisisOpen] = useState<boolean>(false); // L4 위기감지기 수동 펼침
  const [node, setNode] = useState<string>("reserves");         // L2 선택 노드(우측 캔버스). 기본=준비금
  const scrubberRef = useRef<HTMLDivElement>(null);             // L1 스크러버(Card ref)

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
  const selLoans = sel ? sel.loans : latest.loans;          // 위기감지기도 선택 주 기준(Phase 1 timeState 연동)
  // L4 상태(§7): 2단계 임계 — 경계 $500억 / 위기 $2,000억(2008·2020·2023 피크 대비, 설정 상수).
  const CRISIS_CAUTION = 50_000, CRISIS_ALERT = 200_000;
  const crisisLevel = selLoans >= CRISIS_ALERT ? "위기" : selLoans >= CRISIS_CAUTION ? "경계" : "평상시";
  const crisisDot = crisisLevel === "위기" ? "#dc2626" : crisisLevel === "경계" ? "#f59e0b" : "#16a34a";
  const crisisAuto = selLoans >= CRISIS_CAUTION;             // 임계 초과 시 자동 펼침
  // QT/QE 속도 = 선택 주차의 총자산 분기(13주) 변화를 월평균으로(musd/월). 기본=최신=현재.
  //   국면(배지·푸터 공통 단일출처, §2.5): 월평균 ≥+$50억=QE / ≤−$50억=QT / 사이=중립.
  //   임계 $50억(=5,000musd)은 0 근처에서 배지가 깜빡이지 않게 하는 데드밴드.
  const REGIME_BAND = 5_000; // ±$50억/월 데드밴드(설정 상수)
  const paceSel = curIdx >= 13 ? (weeks[curIdx].total - weeks[curIdx - 13].total) / 3 : NaN;
  const phase = !Number.isFinite(paceSel) ? "unknown" : paceSel >= REGIME_BAND ? "QE" : paceSel <= -REGIME_BAND ? "QT" : "중립";
  const phaseCol = phase === "QE" ? "text-emerald-500" : phase === "QT" ? "text-red-500" : "text-muted-foreground";
  // ── L0 이중 판정(§3) ── 주=유동성(준비금 13주 평활 월율, =워터폴 Δ준비금의 13주 누적), 보조=정책(총자산=phase)
  const liqRate = curIdx >= 13 ? (weeks[curIdx].reserves - weeks[curIdx - 13].reserves) / 3 : NaN;
  const liq = !Number.isFinite(liqRate) ? "unknown" : liqRate >= REGIME_BAND ? "확장" : liqRate <= -REGIME_BAND ? "수축" : "중립";
  const dReserves = sel && selPrev ? sel.reserves - selPrev.reserves : NaN; // 이번 주 준비금 변화
  const isPast = curIdx < weeks.length - 1;                                 // 과거 시점 보는 중
  // L1 국면 배경 밴드: 총자산 13주 흐름으로 QE(청록)/QT(적색) 구간 병합(플레인, 렌더당 1회).
  const regimeBands: { x1: string; x2: string; kind: "QE" | "QT" }[] = [];
  { let curB: { x1: string; x2: string; kind: "QE" | "QT" } | null = null;
    for (let i = 13; i < weeks.length; i++) {
      const r = (weeks[i].total - weeks[i - 13].total) / 3;
      const k = r >= REGIME_BAND ? "QE" : r <= -REGIME_BAND ? "QT" : null;
      if (k && curB && curB.kind === k) curB.x2 = weeks[i].date;
      else { if (curB) regimeBands.push(curB); curB = k ? { x1: weeks[i].date, x2: weeks[i].date, kind: k } : null; }
    }
    if (curB) regimeBands.push(curB); }

  return (
    <div className="p-4 md:p-6 space-y-3 max-w-6xl mx-auto">
      {/* L0 판정 헤드라인(스티키). 과거 모드: 앰버 상단보더 + 날짜칩 + '현재로'. ◀▶·날짜칩은 스크러버가 화면 밖일 때만. */}
      <div className="sticky top-0 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-1.5 backdrop-blur border-b border-border bg-background/90">
        <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap">
          <Hint content={<>연준 대차대조표(H.4.1 · 주간) + 재무부 국채 수급(MSPD · 월간)</>}>
            <h1 className="text-base font-bold shrink-0 cursor-help">미국 유동성</h1>
          </Hint>

          {/* 판정 알약 3세그먼트 — 유동성(색) | 정책(무채) | 준비금(무채) */}
          <div className="inline-flex items-stretch rounded-full overflow-hidden border border-border text-[12px] leading-none">
            <Hint content={<div>유동성 = <b>준비금</b>(자산−TGA−역레포−현금−기타)의 13주 평활 월율(= 워터폴 Δ준비금의 13주 누적). ‘정책’과 갈리는 순간이 핵심 신호.<div className="mt-1 text-muted-foreground">최근 13주 {Number.isFinite(liqRate) ? signed(liqRate * 3) : "—"} → 월율 {Number.isFinite(liqRate) ? signed(liqRate) : "—"}</div></div>}>
              <span className={`flex items-center px-2.5 py-1 font-bold cursor-help ${liq === "확장" ? "bg-emerald-500/25 text-emerald-700" : liq === "수축" ? "bg-red-500/20 text-red-700" : "bg-muted text-muted-foreground"}`}>
                {liq === "확장" ? "유동성 확장" : liq === "수축" ? "유동성 수축" : liq === "중립" ? "유동성 중립" : "유동성 —"}
                {Number.isFinite(liqRate) && <> · <span className="inline-block w-[66px] text-right tabular-nums">{signed(liqRate)}</span>/월</>}
              </span>
            </Hint>
            <Hint content={<div>정책 스탠스 = <b>총자산</b> 13주 평활 월율(QE 매입 / QT 축소). {Number.isFinite(paceSel) ? `${signed(paceSel)}/월` : ""}</div>}>
              <span className="flex items-center px-2 py-1 bg-muted/70 text-muted-foreground border-l border-border cursor-help">정책 <span className="inline-block w-[26px] text-left">{phase === "QE" ? "QE" : phase === "QT" ? "QT" : phase === "중립" ? "중립" : "—"}</span></span>
            </Hint>
            <span className="flex items-center px-2 py-1 bg-muted/70 text-muted-foreground border-l border-border">준비금 <span className="inline-block w-[66px] text-right tabular-nums">{Number.isFinite(dReserves) ? signed(dReserves) : "—"}</span></span>
          </div>

          {/* 우측: 날짜 + ◀ 슬라이더(고정폭·오른쪽 고정) ▶ + 현재로(과거 모드) */}
          <span className="flex items-center gap-1.5 shrink-0 ml-auto">
            <span className={`text-[11.5px] tabular-nums shrink-0 ${isPast ? "text-amber-700 font-semibold" : "text-muted-foreground"}`}>
              {sel ? `${sel.date.slice(0, 4)}년 ${weekLabel(sel.date)}` : ""}
            </span>
            <button type="button" onClick={() => setIdx(Math.max(0, curIdx - 1))} disabled={curIdx <= 0} aria-label="이전 주" title="이전 주"
              className="shrink-0 px-0.5 text-[13px] leading-none text-foreground/70 hover:text-foreground disabled:opacity-25 disabled:cursor-default">◀</button>
            <input type="range" min={0} max={weeks.length - 1} value={curIdx} step={1}
              onChange={(e) => setIdx(Number(e.target.value))}
              aria-label="시점 이동" title={`시점 이동 · ${sel?.date ?? ""}`}
              className="h-1.5 w-52 xl:w-64 shrink-0 cursor-pointer accent-red-500 align-middle" />
            <button type="button" onClick={() => setIdx(Math.min(weeks.length - 1, curIdx + 1))} disabled={curIdx >= weeks.length - 1} aria-label="다음 주" title="다음 주"
              className="shrink-0 px-0.5 text-[13px] leading-none text-foreground/70 hover:text-foreground disabled:opacity-25 disabled:cursor-default">▶</button>
            {/* 현재로: 폭을 항상 예약(invisible) → 과거 전환 시 슬라이더가 밀리지 않게 */}
            <button type="button" onClick={() => setIdx(-1)} title="현재(최신 주)로" aria-hidden={!isPast} tabIndex={isPast ? 0 : -1}
              className={`shrink-0 rounded border border-amber-500/50 text-amber-700 px-1.5 py-0.5 text-[10.5px] hover:bg-amber-500/10 ${isPast ? "" : "invisible pointer-events-none"}`}>현재로</button>
          </span>
        </div>
      </div>

      <BandLabel>연준 유동성 · 대차대조표</BandLabel>

      {/* L1 스크러버 — 총자산 추이 + QE청록/QT적색 국면 배경. 시점 선택 컨트롤러. */}
      <Card ref={scrubberRef} className="p-3.5 scroll-mt-16">
        <div className="mb-1 text-sm font-semibold flex items-center gap-1.5 flex-wrap">연준 대차대조표 규모 <span className="text-[11px] font-normal text-muted-foreground">총자산 추이 · 클릭/드래그로 시점 선택</span>
          <span className="text-[11px] font-normal text-muted-foreground flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: POS }} />QE<span className="inline-block w-2.5 h-2.5 rounded-sm ml-1.5" style={{ background: NEG }} />QT 국면</span></div>
        <div className="h-[196px] cursor-crosshair">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weeks} margin={{ top: 18, right: 8, left: 6, bottom: 0 }}
              onClick={(e: any) => { if (e?.activeLabel) setIdx(nearestIdx(weeks, String(e.activeLabel))); }}>
              <defs><linearGradient id="fedsz" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={A_SOMA} stopOpacity={0.4} /><stop offset="100%" stopColor={A_SOMA} stopOpacity={0.03} /></linearGradient></defs>
              {regimeBands.map((b, i) => <ReferenceArea key={i} x1={b.x1} x2={b.x2} fill={b.kind === "QE" ? POS : NEG} fillOpacity={0.07} />)}
              <XAxis dataKey="date" tickFormatter={yr} minTickGap={44} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
              <YAxis tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}조`} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={40} className="text-muted-foreground" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [T(v), "총자산"]} labelFormatter={(l) => `${weekLabel(String(l))} (${l})`} />
              <Area dataKey="total" stroke={A_SOMA} strokeWidth={1.5} fill="url(#fedsz)" />
              {PHASES.map((p) => { const w = weeks[nearestIdx(weeks, p.date)]; return <ReferenceDot key={p.label} x={w.date} y={w.total} r={2.5} fill="hsl(var(--muted-foreground))" stroke="none" />; })}
              {activePhase && <ReferenceDot x={weeks[activePhase.i].date} y={weeks[activePhase.i].total} r={4.5} fill={NEG} stroke="hsl(var(--background))" strokeWidth={1.5}
                label={{ value: `${activePhase.label} · ${activePhase.desc}`, position: "top", fontSize: 10, fill: "hsl(var(--foreground))", fontWeight: 600 }} />}
              {sel && <ReferenceLine x={sel.date} stroke={NEG} strokeWidth={1} strokeOpacity={0.45} />}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* L2 — T-계정 마스터(세그먼트 선택) | 확장 캔버스(선택 노드의 이야기) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
        <Card className="p-3.5">
          <div className="mb-2 text-sm font-semibold">T-계정 <span className="text-[11px] font-normal text-muted-foreground tabular-nums">{sel && weekLabel(sel.date)} · 구성비 · <span style={{ color: NODE_META[node]?.color }}>항목을 클릭</span>하면 우측에 분해/추이</span></div>
          {sel && <TAccount w={sel} selected={node} onSelect={setNode} />}
        </Card>
        <Card className="p-3.5 flex flex-col">
          {sel && <NodeCanvas node={node} weeks={weeks} sel={sel} selPrev={selPrev} treasury={data?.treasury} phase={phase} />}
        </Card>
      </div>

      <BandLabel>국채 수급 · 재무부 발행(공급) → 연준 흡수</BandLabel>

      {/* 재무부 국채 발행(공급) 먼저 — 종류별 잔액·순발행. 선택 주차 가이드라인 연동 */}
      {data?.treasury && data.treasury.monthly.length > 0 && <TreasuryIssuance t={data.treasury} selDate={sel?.date} />}

      {/* 연준의 국채 흡수 — 그 공급을 연준이 얼마나 받아주나(흡수율). 상단 슬라이더 연동 */}
      {data?.treasury && data.treasury.monthly.length > 0 && <FedAbsorption t={data.treasury} selDate={sel?.date} />}

      {/* L4 위기 감지기(§7) — 평상시 한 줄 상태바 / 클릭·자동(경계+) 펼침 시 차트 */}
      <Card className="p-3">
        <button type="button" onClick={() => setCrisisOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: crisisDot }} />
            <span className="text-sm font-semibold">위기 감지기</span>
            <span className="text-[11px] text-muted-foreground">Fed 긴급대출 · {sel && weekLabel(sel.date)}</span>
            <span className="text-[12px] tabular-nums font-semibold" style={{ color: crisisDot }}>{asMoney(selLoans)} · {crisisLevel}</span>
          </div>
          <span className="text-[11px] text-muted-foreground shrink-0">{(crisisOpen || crisisAuto) ? "접기 ▾" : "펼치기 ▸"}{crisisAuto && !crisisOpen ? " · 자동" : ""}</span>
        </button>
        {(crisisOpen || crisisAuto) && (
          <div className="mt-2">
            <div className="text-[11px] text-muted-foreground mb-1">평상시엔 바닥. 이 선들이 튀면 은행·자금시장 어딘가에 불이 났다는 신호 (2008·2020·2023). 임계: <b>경계 $500억</b> / <b>위기 $2,000억</b>.</div>
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
                  {sel && <ReferenceLine x={sel.date} stroke={NEG} strokeWidth={1} strokeOpacity={0.5} strokeDasharray="3 3" />}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
