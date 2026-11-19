// Ch1 씬 — 두 개의 층 토글 + L2 스펙트럼.
import { useState } from "react";
import { useJourney } from "@/lib/blockchain-edu/journeyState";
import { l1TxFee, l2TxFee } from "@/lib/blockchain-edu/feeEngine";
import { CALIBRATION as C } from "@/lib/blockchain-edu/calibration";
import { LAYER } from "@/lib/blockchain-edu/layers";
import { fmtUSDprecise } from "@/lib/blockchain-edu/format";
import ComparisonCards, { type CompareCard } from "@/components/blockchain-edu/ComparisonCards";

// 같은 송금을 L1(현금) vs L2(선불 팔찌)로 — 비용·속도가 어떻게 달라지는지.
export function Ch1Toggle() {
  const { state } = useJourney();
  const [layer, setLayer] = useState<"L1" | "L2">("L1");
  const isL1 = layer === "L1";
  const cost = isL1 ? l1TxFee(C.l1.gasUsage.transfer).total : l2TxFee(state.amountUSD).total;
  const pal = isL1 ? LAYER.L1 : LAYER.L2;
  const speed = isL1 ? "~12초 + 최종성 대기" : "~2초, 즉시 체감";
  const metaphor = isL1 ? "현금 — 직접 건넨다. 무겁고 비싸지만 그 자체로 최종." : "놀이공원 선불 팔찌 — 가볍고 싸다. 정산은 나중에 L1에서.";

  return (
    <div className="w-full">
      <div className="mb-3 flex gap-1.5">
        {(["L1", "L2"] as const).map((l) => {
          const on = l === layer, p = LAYER[l];
          return (
            <button key={l} onClick={() => setLayer(l)}
              className="flex-1 rounded-lg border px-3 py-2 text-[length:var(--font-size-12px)] font-semibold transition-colors"
              style={on ? { background: p.soft, borderColor: p.solid, color: p.ink } : { borderColor: "hsl(var(--border))" }}>
              {p.label}
            </button>
          );
        })}
      </div>
      <div key={layer}   
        className="rounded-lg border p-3" style={{...({ borderColor: pal.solid, background: pal.soft }),opacity: 1}}>
        <p className="text-[length:var(--font-size-11-5px)]" style={{ color: pal.ink }}>{metaphor}</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-md bg-background/70 p-2">
            <div className="text-[length:var(--font-size-10px)] text-muted-foreground">같은 송금 수수료</div>
            <div className="text-[length:var(--font-size-16px)] font-bold tabular-nums" style={{ color: pal.ink }}>{fmtUSDprecise(cost)}</div>
          </div>
          <div className="rounded-md bg-background/70 p-2">
            <div className="text-[length:var(--font-size-10px)] text-muted-foreground">속도</div>
            <div className="text-[length:var(--font-size-13px)] font-semibold" style={{ color: pal.ink }}>{speed}</div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-[length:var(--font-size-10-5px)] text-muted-foreground">위 금액 슬라이더를 움직여 보세요. L1 수수료는 금액과 무관(고정비)이고, L2는 거의 공짜입니다.</p>
    </div>
  );
}

const L2_CARDS: CompareCard[] = [
  { name: "로빈후드 체인", initial: "R", accent: "var(--tone-teal-600)",
    rows: [{ label: "기반", value: "Arbitrum Orbit" }, { label: "정렬", value: "선착순(FCFS)" }, { label: "개방성", value: "개방+시퀀서 필터링" }],
    note: "FCFS의 의미는 Ch3, 필터링의 의미는 Ch5에서 회수." },
  { name: "Base", initial: "B", accent: "var(--tone-blue-500)",
    rows: [{ label: "기반", value: "OP Stack" }, { label: "정렬", value: "가스 우선순위" }, { label: "개방성", value: "완전 개방형" }] },
  { name: "DAMA 2", initial: "D", accent: "var(--tone-indigo-400)",
    rows: [{ label: "기반", value: "허가형 ZK 롤업" }, { label: "정렬", value: "허가된 시퀀서" }, { label: "개방성", value: "사전 허가제" }],
    note: "도이체방크 — 기업 전용 체인." },
  { name: "Tempo", initial: "T", accent: "var(--tone-orange-500)",
    rows: [{ label: "기반", value: "독자 체인" }, { label: "정렬", value: "자체 메커니즘" }, { label: "개방성", value: "결제 특화" }],
    note: "스트라이프 — 결제 특화." },
];

export function Ch1Spectrum() {
  return (
    <div className="w-full">
      <p className="mb-2 text-[length:var(--font-size-11-5px)] text-muted-foreground">L2는 단일 종이 아니다 — 시퀀싱 정책·컴플라이언스·개방성은 운영사의 <b>설계 선택지</b>다.</p>
      <ComparisonCards cards={L2_CARDS} />
    </div>
  );
}
