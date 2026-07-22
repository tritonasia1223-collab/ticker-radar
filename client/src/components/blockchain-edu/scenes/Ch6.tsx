// Ch6 씬 — 크로스체인. 공식 락앤민트(느림·L1보증) vs 서드파티 브릿지(빠름·별도신뢰) 레이스.
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CALIBRATION as C } from "@/lib/blockchain-edu/calibration";
import { LAYER } from "@/lib/blockchain-edu/layers";
import { fmtUSD } from "@/lib/blockchain-edu/format";

export function Ch6Crosschain() {
  const reduce = useReducedMotion();
  const [racing, setRacing] = useState(false);

  const Track = ({ label, sub, color, dur, tag }: { label: string; sub: string; color: string; dur: number; tag: string }) => (
    <div className="rounded-lg border p-2.5" style={{ borderColor: color, background: `${color}10` }}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold" style={{ color }}>{label}</span>
        <span className="text-[10px]" style={{ color }}>{tag}</span>
      </div>
      <div className="my-1.5 h-2.5 w-full overflow-hidden rounded-full bg-white/70">
        <motion.div className="h-full rounded-full" style={{ background: color }}
          initial={{ width: "4%" }} animate={{ width: racing ? "100%" : "4%" }}
          transition={{ duration: reduce ? 0 : dur, ease: "linear" }} />
      </div>
      <p className="text-[10.5px]" style={{ color }}>{sub}</p>
    </div>
  );

  return (
    <div className="w-full space-y-2.5">
      <p className="text-[11.5px] text-muted-foreground">롯데월드 팔찌를 에버랜드에서 못 쓰는 문제 — 체인을 건너려면?</p>
      <Track label="공식 경로 (락앤민트)" sub="L1 경유 — 느리지만 L1이 보증" color={LAYER.L1.solid} dur={3.2} tag="느림 · 안전" />
      <Track label="서드파티 유동성 브릿지" sub="빠르지만 별도 신뢰 가정 — 브릿지 자체가 해킹 표적" color={LAYER.L2.solid} dur={1.1} tag="빠름 · 위험" />
      <button onClick={() => { setRacing(false); setTimeout(() => setRacing(true), 30); }}
        className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground hover:opacity-90 transition-opacity">
        출발 (두 경로 레이스)
      </button>
      <div className="rounded-lg border border-red-400/50 bg-red-50 p-2 text-[11px] text-red-800">
        ⚠ 크로스체인 브릿지 누적 해킹 피해 <b>{fmtUSD(C.bridge.cumulativeHackLossesUSD)}+</b>(2022~, Web3 전체 해킹의 ~40%). 속도의 대가는 신뢰 가정입니다.
      </div>
    </div>
  );
}
