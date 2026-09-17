// 연준 T-계정(구성비 스택) — /fed 와 /liquidity(베타)가 공유. client/src/pages/Fed.tsx 에서 순수 이동(동작 변경 없음).
//   WeekPoint 는 server/fed.ts buildWeekly 의 응답 형태(모든 수치 million USD).

// server/fed.ts 의 응답 형태(모든 수치 million USD).
export interface WeekPoint {
  date: string; total: number;
  treast: number; mbs: number; agency: number; soma: number;
  discount: number; btfp: number; repo: number; swap: number; loans: number; assetResidual: number;
  reserves: number; rrp: number; tga: number; currency: number; liabResidual: number;
}

// ── 색 ── SOMA 세분(국채·MBS·기관채)=teal 3단 / 대출=amber / 기타=slate / 부채=purple+gray
export const A_SOMA = "#0d9488", A_MBS = "#14b8a6", A_AGENCY = "#5eead4"; // 국채·MBS·기관채
export const A_LOAN = "#f59e0b", A_RESID = "#94a3b8";                     // 대출·스왑 / 기타자산
export const L_RES = "#7c3aed", L_RRP = "#a855f7", L_TGA = "#d8b4fe", L_CUR = "#9ca3af", L_RESID = "#6b7280";
export const POS = "#16a34a", NEG = "#dc2626";
export const LEND = { discount: "#f59e0b", btfp: "#ef4444", repo: "#3b82f6", swap: "#8b5cf6" };
// 국채 종류별(재무부) — 단기(파랑)→장기(보라) 그라데이션 + TIPS(teal)·FRN(amber). 연준 흡수율=rose.
export const TB = { bill: "#3b82f6", note: "#6366f1", bond: "#8b5cf6", tips: "#14b8a6", frn: "#f59e0b" };
export const FED_ABS = "#e11d48";

// ── 단위: 세미 한국식($억/$조) ── musd → 억=÷100, 조=÷1e6(소수점 1자리)
export const asMoney = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}조`;
  if (a >= 100) return `${s}$${Math.round(a / 100).toLocaleString()}억`;
  return `${s}$${(a / 100).toFixed(2)}억`;
};
export const T = asMoney;
export const signed = (v: number) => Number.isFinite(v) ? (v >= 0 ? "+" : "−") + asMoney(Math.abs(v)) : "—";
export const yr = (d: string) => d.slice(0, 4);
export const weekLabel = (d: string) => `${Number(d.slice(5, 7))}월 ${Math.ceil(Number(d.slice(8, 10)) / 7)}주차`;
export const textOn = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#0f172a" : "#ffffff";
};
export const nearestIdx = (weeks: WeekPoint[], date: string) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < weeks.length; i++) { const d = Math.abs(+new Date(weeks[i].date) - +new Date(date)); if (d < bd) { bd = d; best = i; } }
  return best;
};

// ── T-계정 한쪽 컬럼(꽉 찬 구성비 스택) ──
export interface Seg { label: string; val: number; color: string; sub?: [string, number][]; desc?: string; node?: string }
export const STACK_H = 320;
export function StackColumn({ segs, total, align, group, selected, onSelect }: {
  segs: Seg[]; total: number; align: "left" | "right";
  group?: { label: string; count: number }; // 앞 count 개 세그먼트를 상위 분류로 묶는 브래킷(왼쪽)
  selected?: string; onSelect?: (node: string) => void; // 노드 선택(우측 캔버스 전환)
}) {
  const stack = (
    <div className="flex flex-1 flex-col rounded-md" style={{ height: STACK_H }}>
      {segs.map((s, i) => {
        const h = Number.isFinite(s.val) ? Math.max(0, (s.val / total) * STACK_H) : 0;
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
  const gh = Number.isFinite(gval) ? (gval / total) * STACK_H : 0;
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

export function TAccount({ w, selected, onSelect }: { w: WeekPoint; selected?: string; onSelect?: (n: string) => void }) {
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
