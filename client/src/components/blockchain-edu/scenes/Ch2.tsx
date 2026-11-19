// Ch2 씬 — 락앤민트. ETH가 L1 브릿지에 잠기고 L2에서 사본이 발행된다.
import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Lock, LockOpen } from "lucide-react";
import { LAYER } from "@/lib/blockchain-edu/layers";

export function Ch2LockMint() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<"idle" | "locked">("idle");
  const locked = phase === "locked";

  return (
    <div className="w-full">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {/* L1: 브릿지 금고 */}
        <div className="rounded-lg border p-3 text-center" style={{ borderColor: LAYER.L1.solid, background: LAYER.L1.soft }}>
          <div className="text-[10px] font-semibold" style={{ color: LAYER.L1.ink }}>{LAYER.L1.label}</div>
          <div className="mt-2 flex flex-col items-center gap-1">
            {locked ? <Lock className="h-7 w-7" style={{ color: LAYER.L1.ink }} /> : <LockOpen className="h-7 w-7" style={{ color: LAYER.L1.ink }} />}
            <div className="text-[11px]" style={{ color: LAYER.L1.ink }}>브릿지 컨트랙트</div>
            <div className="text-[12px] font-bold" style={{ color: LAYER.L1.ink }}>{locked ? "🔒 ETH 담보 잠김" : "비어 있음"}</div>
          </div>
        </div>

        {/* 화살표 */}
        <div className="flex flex-col items-center text-[10px] text-muted-foreground">
          <motion.div animate={{ x: locked && !reduce ? [0, 6, 0] : 0 }} transition={{ repeat: locked && !reduce ? Infinity : 0, duration: 1.2 }}>→</motion.div>
          <span>사본 발행</span>
        </div>

        {/* L2: 사본 발행 */}
        <div className="rounded-lg border p-3 text-center" style={{ borderColor: LAYER.L2.solid, background: LAYER.L2.soft }}>
          <div className="text-[10px] font-semibold" style={{ color: LAYER.L2.ink }}>{LAYER.L2.label}</div>
          <div className="mt-2 flex min-h-[64px] flex-col items-center justify-center gap-1">
            <AnimatePresence>
              {locked && (
                <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.35 }} className="text-[12px] font-bold" style={{ color: LAYER.L2.ink }}>
                  🪙 wETH 사본 발행됨
                </motion.div>
              )}
            </AnimatePresence>
            {!locked && <div className="text-[11px] text-muted-foreground">아직 없음</div>}
          </div>
        </div>
      </div>

      <p className="my-2 text-center text-[11.5px] font-medium">코인이 이동하는 게 아니라, <b>담보로 잠기고 사본이 생긴다.</b></p>
      <div className="flex justify-center">
        <button onClick={() => setPhase(locked ? "idle" : "locked")}
          className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground hover:opacity-90 transition-opacity">
          {locked ? "되돌리기" : "입금 실행 (락앤민트)"}
        </button>
      </div>
    </div>
  );
}
