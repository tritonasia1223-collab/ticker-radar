// Ch3 씬 — 시퀀서 순서권(FCFS vs 경매) · 압축 · 블롭 타임라인 · 블롭 바닥 패러독스.
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { nextBlobBaseFee } from "@/lib/blockchain-edu/feeEngine";
import { CALIBRATION as C } from "@/lib/blockchain-edu/calibration";
import { LAYER } from "@/lib/blockchain-edu/layers";

// ── 3-1. 시퀀서의 두 가지 권력: 순서 결정 → MEV ──
interface Tx { id: string; label: string; tip: number; kind?: "mine" | "bot" }
const MEMPOOL: Tx[] = [
  { id: "a", label: "거래 A", tip: 0.2 },
  { id: "me", label: "내 스왑", tip: 0.5, kind: "mine" },
  { id: "bot", label: "봇 (프론트런)", tip: 2.0, kind: "bot" },
  { id: "b", label: "거래 B", tip: 0.3 },
];

export function Ch3Sequencer() {
  const [mode, setMode] = useState<"fcfs" | "auction">("fcfs");
  const ordered = mode === "fcfs" ? MEMPOOL : [...MEMPOOL].sort((a, b) => b.tip - a.tip);
  const botIdx = ordered.findIndex((t) => t.kind === "bot");
  const meIdx = ordered.findIndex((t) => t.kind === "mine");
  const frontrun = mode === "auction" && botIdx < meIdx;

  return (
    <div className="w-full">
      <div className="mb-2 flex gap-1.5">
        {(["fcfs", "auction"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              m === mode ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>
            {m === "fcfs" ? "선착순 (FCFS)" : "가스 경매"}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {ordered.map((t, i) => {
          const c = t.kind === "mine" ? "#1e40af" : t.kind === "bot" ? "#dc2626" : "#94a3b8";
          return (
            <motion.div key={t.id} layout transition={{ type: "spring", stiffness: 400, damping: 32 }}
              className="flex items-center justify-between rounded-md border px-3 py-1.5 text-[12px]"
              style={{ borderColor: c, background: `${c}14` }}>
              <span className="flex items-center gap-2 font-medium" style={{ color: c }}>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold" style={{ color: c }}>{i + 1}</span>
                {t.label}
              </span>
              <span className="tabular-nums text-muted-foreground">팁 {t.tip} gwei</span>
            </motion.div>
          );
        })}
      </div>
      <p className="mt-2 text-[11.5px]" style={{ color: frontrun ? "#dc2626" : "hsl(var(--muted-foreground))" }}>
        {frontrun
          ? "⚠ 경매 모드: 높은 팁의 봇이 내 스왑 앞에 끼어듭니다 (프론트러닝 = MEV)."
          : "선착순 모드: 도착 순서 그대로 — 팁으로 추월 불가. 설계가 MEV를 막습니다."}
      </p>
    </div>
  );
}

// ── 3-2a. 압축: 서명 제거 + state diff ──
export function Ch3Compression() {
  const [compressed, setCompressed] = useState(false);
  const RAW = 200, COMP = 40; // 바이트/tx (근사)
  const per = compressed ? COMP : RAW;
  const fit = Math.floor((C.blob.sizeKB * 1024) / per);
  return (
    <div className="w-full">
      <div className="mb-2 flex items-end justify-between">
        <span className="text-[12px] font-semibold">트랜잭션 1건 크기</span>
        <span className="text-[15px] font-bold tabular-nums" style={{ color: LAYER.L2.ink }}>{per} 바이트</span>
      </div>
      <div className="h-5 w-full overflow-hidden rounded bg-secondary">
        <motion.div animate={{ width: `${(per / RAW) * 100}%` }} transition={{ duration: 0.4 }} className="h-full rounded" style={{ background: LAYER.L2.solid }} />
      </div>
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        {compressed ? "서명 제거 + state diff → 128KB 블롭 1개에 " : "원본(서명 포함) → 128KB 블롭에 "}
        <b className="text-foreground tabular-nums">{fit.toLocaleString()}건</b>{compressed ? " 적재" : "밖에 못 담음"}
      </p>
      <button onClick={() => setCompressed((v) => !v)} className="mt-2 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium hover:bg-accent transition-colors">
        {compressed ? "원본으로" : "압축하기"}
      </button>
    </div>
  );
}

// ── 3-2b. 블롭 타임라인: 18.2일 후 데이터 소멸, KZG 지문만 잔존 ──
export function Ch3BlobTimeline() {
  const [day, setDay] = useState(0);
  const gone = day >= C.blob.retentionDays;
  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>경과 <b className="text-foreground tabular-nums">{day.toFixed(1)}일</b></span>
        <span>보존 {C.blob.retentionDays}일 (4096 에포크)</span>
      </div>
      <input type="range" min={0} max={25} step={0.2} value={day} onChange={(e) => setDay(Number(e.target.value))} className="w-full accent-primary" />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border p-2.5 text-center">
          <div className="text-[10px] text-muted-foreground">블롭 데이터 (128KB)</div>
          <motion.div animate={{ opacity: gone ? 0.15 : 1 }} className="mt-1 text-[13px] font-bold" style={{ color: LAYER.L2.ink }}>
            {gone ? "소멸됨" : "존재"}
          </motion.div>
        </div>
        <div className="rounded-lg border p-2.5 text-center" style={{ borderColor: LAYER.L1.solid, background: LAYER.L1.soft }}>
          <div className="text-[10px]" style={{ color: LAYER.L1.ink }}>KZG 커밋먼트 (지문)</div>
          <div className="mt-1 text-[13px] font-bold" style={{ color: LAYER.L1.ink }}>영구 잔존</div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">L1은 데이터 보관소가 아니라 <b className="text-foreground">공증소</b> — 데이터의 존재를 증명하는 암호학적 지문만 남깁니다.</p>
    </div>
  );
}

// ── 3-3. 블롭 바닥의 패러독스: 타깃 미만은 1 wei 고착, 초과 지속돼야 상승 ──
export function Ch3BlobFloor() {
  const [demand, setDemand] = useState(10);
  const sim = useMemo(() => {
    let excess = 0; const fees: number[] = [];
    for (let i = 0; i < 40; i++) { const r = nextBlobBaseFee(excess, demand); fees.push(r.baseFeeWei); excess = r.nextExcess; }
    return { fees, finalFee: fees[fees.length - 1] };
  }, [demand]);
  const atFloor = sim.finalFee <= C.blob.minBaseFeeWei + 1e-9;
  const maxFee = Math.max(...sim.fees, C.blob.minBaseFeeWei);
  const belowTarget = demand < C.blob.target;

  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>블롭 수요 <b className="text-foreground tabular-nums">{demand}</b> / 블록</span>
        <span>타깃 {C.blob.target} · 최대 {C.blob.max}</span>
      </div>
      <input type="range" min={0} max={C.blob.max} value={demand} onChange={(e) => setDemand(Number(e.target.value))} className="w-full accent-primary" />
      {/* 40블록 후 base fee 미니 스파크 */}
      <div className="mt-2 flex h-16 items-end gap-[2px] rounded-md bg-secondary/60 p-1.5">
        {sim.fees.map((f, i) => (
          <div key={i} className="flex-1 rounded-sm" style={{ height: `${Math.max(2, (f / maxFee) * 100)}%`, background: belowTarget ? "#94a3b8" : LAYER.burn.solid }} />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11.5px]">40블록 후 blob base fee</span>
        <span className="text-[13px] font-bold tabular-nums" style={{ color: atFloor ? "#64748b" : LAYER.burn.ink }}>
          {atFloor ? `${C.blob.minBaseFeeWei} wei (바닥)` : `${sim.finalFee.toExponential(1)} wei ↑`}
        </span>
      </div>
      <p className="mt-1.5 text-[11px]" style={{ color: belowTarget ? "hsl(var(--muted-foreground))" : LAYER.burn.ink }}>
        {belowTarget
          ? "타깃 미만 수요 → base fee가 1 wei 바닥에 고착. 아무리 오래 지속돼도 안 움직입니다."
          : "타깃 초과 수요가 지속돼야 비로소 지수 상승. 바닥 이탈은 비대칭적으로 어렵습니다."}
      </p>
      <p className="mt-1 text-[10.5px] text-muted-foreground">→ "L2 정산비가 거의 공짜"인 건 우연이 아니라 수수료 공식의 구조적 귀결.</p>
    </div>
  );
}
