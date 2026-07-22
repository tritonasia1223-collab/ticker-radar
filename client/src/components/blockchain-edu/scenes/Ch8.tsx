// Ch8 씬 — RWA: 파이프라인 + 권리 스펙트럼 + 도산 격리 + 결산서.
import { useState } from "react";
import { useJourney } from "@/lib/blockchain-edu/journeyState";
import { journeyReceipt, l1TxFee } from "@/lib/blockchain-edu/feeEngine";
import { CALIBRATION as C } from "@/lib/blockchain-edu/calibration";
import { RECIPIENT_META, recipientPalette } from "@/lib/blockchain-edu/layers";
import { fmtUSDprecise, fmtPct } from "@/lib/blockchain-edu/format";
import ComparisonCards, { type CompareCard } from "@/components/blockchain-edu/ComparisonCards";

// 8-1. 파이프라인 + 화이트리스트 전송 제한.
export function Ch8Pipeline() {
  const [blocked, setBlocked] = useState(false);
  const steps = ["국채", "커스터디 (BNY멜론)", "토큰화 (Securitize)", "온체인 토큰"];
  return (
    <div className="w-full space-y-3">
      <div className="flex items-center gap-1 overflow-x-auto">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <div className="rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-medium whitespace-nowrap">{s}</div>
            {i < steps.length - 1 && <span className="text-muted-foreground">→</span>}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">수수료: 운용보수(자산운용사 {(C.rwa.mgmtFeePct * 100).toFixed(1)}%) + 플랫폼 수수료({(C.rwa.platformFeePct * 100).toFixed(2)}%).</p>
      <div className="rounded-lg border border-border p-2.5">
        <div className="text-[11.5px] font-semibold">일반 토큰과의 차이 — 화이트리스트 전송 제한</div>
        <button onClick={() => setBlocked(true)} className="mt-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium hover:bg-accent transition-colors">허가 안 된 주소로 전송 시도</button>
        {blocked && <p className="mt-1.5 text-[11.5px] font-medium text-red-600">✗ 전송 거부 — 화이트리스트에 없는 주소입니다.</p>}
      </div>
    </div>
  );
}

// 8-2. 권리 스펙트럼 + 도산 격리.
const RIGHTS_CARDS: CompareCard[] = [
  { name: "펀드 지분 (BUIDL류)", initial: "F", accent: "#1e40af",
    rows: [{ label: "정체", value: "펀드 지분", on: true }, { label: "수익 분배 청구권", value: "있음", on: true }, { label: "의결권", value: "제한적", on: false }] },
  { name: "주식 토큰 (로빈후드류)", initial: "S", accent: "#ea580c",
    rows: [{ label: "정체", value: "채무 증권(SPV)", on: false }, { label: "의결권", value: "없음", on: false }, { label: "배당 청구권", value: "없음", on: false }],
    note: "저지섬 SPV가 발행한 구조화 노트 — 주가 수익률 변제 약정. 규제 권역 거주자 취득 금지." },
  { name: "스테이블코인", initial: "$", accent: "#0d9488",
    rows: [{ label: "정체", value: "상환 청구권", on: true }, { label: "이자 수취권", value: "없음", on: false }, { label: "발행사 청구", value: "상환만", on: true }] },
];

export function Ch8Rights() {
  const [insolvent, setInsolvent] = useState(false);
  return (
    <div className="w-full space-y-2.5">
      <p className="text-[11.5px] font-medium">락앤민트 그림이 같아도, 토큰에 붙는 <b>법적 권리</b>가 자산의 실체를 결정합니다. 온체인에서 보이는 건 토큰이지 권리가 아니에요.</p>
      <ComparisonCards cards={RIGHTS_CARDS} rightsMode />
      <div className="rounded-lg border border-border p-2.5">
        <button onClick={() => setInsolvent((v) => !v)} className="rounded-md border border-border px-3 py-1.5 text-[12px] font-medium hover:bg-accent transition-colors">
          {insolvent ? "되돌리기" : "발행사 파산 시나리오"}
        </button>
        {insolvent && <p className="mt-1.5 text-[11.5px] text-emerald-700">담보(실물 주식)는 별도 커스터디에 격리 → 독립 수탁 대리인이 장내 매각 → 토큰 보유자에게 현금 분배. <b>발행사가 죽어도 담보는 산다.</b></p>}
      </div>
    </div>
  );
}

// 결산서 — 원장 전체를 수취인별로 집계 + 소각률 + L1-only 가상 비교.
export function Ch8Receipt() {
  const { state } = useJourney();
  const allSplits = state.ledger.flatMap((e) => e.feeBreakdown);
  // L1-only 가상: 각 원장 항목을 전부 L1 스왑 가스로 했다면.
  const l1Only = state.ledger.length * l1TxFee(C.l1.gasUsage.swap).total;
  const r = journeyReceipt(allSplits, l1Only);
  const entries = Object.entries(r.byRecipient).sort((a, b) => b[1] - a[1]);

  if (state.ledger.length === 0) {
    return <div className="text-center text-[12px] text-muted-foreground">아직 원장이 비어 있어요. 아래 '돈의 행방'에서 거래를 <b>원장에 기록</b>하면 여기 결산됩니다.</div>;
  }
  return (
    <div className="w-full space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold">여정 결산서</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">거래 {state.ledger.length}건 · 총 {fmtUSDprecise(r.totalUSD)}</span>
      </div>
      <div className="space-y-1">
        {entries.map(([rec, v]) => {
          const pal = recipientPalette(rec as keyof typeof RECIPIENT_META);
          const meta = RECIPIENT_META[rec as keyof typeof RECIPIENT_META];
          return (
            <div key={rec}>
              <div className="flex justify-between text-[10.5px]"><span style={{ color: pal.ink }}>{meta.label}</span><span className="tabular-nums">{fmtUSDprecise(v)} · {fmtPct(r.totalUSD ? v / r.totalUSD : 0)}</span></div>
              <div className="h-2 w-full overflow-hidden rounded bg-secondary"><div className="h-full rounded" style={{ width: `${r.totalUSD ? (v / r.totalUSD) * 100 : 0}%`, background: pal.solid }} /></div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-md border border-border p-2"><div className="text-muted-foreground">소각률(EIP-1559)</div><div className="font-bold tabular-nums">{fmtPct(r.burnPct)}</div></div>
        <div className="rounded-md border border-border p-2"><div className="text-muted-foreground">전부 L1이었다면(가상)</div><div className="font-bold tabular-nums">{fmtUSDprecise(r.l1OnlyVirtualUSD)}</div></div>
      </div>
    </div>
  );
}
