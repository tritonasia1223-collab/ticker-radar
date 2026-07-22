// Ch5 씬 — 출금과 신뢰의 근거. Optimistic vs ZK + 검열 시나리오(escape hatch).
import { useState } from "react";
import { LAYER } from "@/lib/blockchain-edu/layers";

export function Ch5Withdraw() {
  const [proof, setProof] = useState<"optimistic" | "zk">("optimistic");
  const [scenario, setScenario] = useState<"normal" | "down" | "reject">("normal");

  const proofDesc = proof === "optimistic"
    ? { title: "Optimistic — 7일 챌린지", body: "일단 인출을 신청하면 7일간 '누구나 사기 증명 제출 가능'. 아무도 반박 못하면 확정.", tag: "느리지만 저렴" }
    : { title: "ZK — 유효성 증명", body: "출금 시 유효성 증명(validity proof)을 생성해 L1이 즉시 검증 → 확정.", tag: "즉시 확정" };

  const scen = {
    normal: { label: "정상", body: "시퀀서가 정상 처리 → 위 경로대로 출금.", tone: "muted" as const },
    down: { label: "시퀀서 멈춤", body: "시퀀서 다운 → L1 강제 포함(escape hatch)으로 자산을 직접 회수합니다.", tone: "warn" as const },
    reject: { label: "시퀀서가 거부", body: "제재 대상 지갑이 시퀀서 단에서 거부됨 → 같은 escape hatch로 L1에 직접 트랜잭션을 제출해 검열을 우회합니다.", tone: "warn" as const },
  }[scenario];

  return (
    <div className="w-full space-y-3">
      <div className="flex gap-1.5">
        {(["optimistic", "zk"] as const).map((p) => (
          <button key={p} onClick={() => setProof(p)}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              p === proof ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>
            {p === "optimistic" ? "Optimistic" : "ZK"}
          </button>
        ))}
      </div>
      <div className="rounded-lg border p-2.5" style={{ borderColor: LAYER.L2.solid, background: LAYER.L2.soft }}>
        <div className="text-[12px] font-bold" style={{ color: LAYER.L2.ink }}>{proofDesc.title} <span className="ml-1 text-[10px] font-normal">· {proofDesc.tag}</span></div>
        <p className="mt-1 text-[11.5px]" style={{ color: LAYER.L2.ink }}>{proofDesc.body}</p>
      </div>

      <div>
        <div className="mb-1.5 flex gap-1.5">
          {(["normal", "down", "reject"] as const).map((s) => (
            <button key={s} onClick={() => setScenario(s)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                s === scenario ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>
              {{ normal: "정상", down: "시퀀서 멈춤", reject: "시퀀서가 거부" }[s]}
            </button>
          ))}
        </div>
        <div className={`rounded-lg border p-2.5 text-[11.5px] ${scen.tone === "warn" ? "border-amber-400/50 bg-amber-50 text-amber-900" : "border-border text-muted-foreground"}`}>
          {scen.body}
        </div>
      </div>

      <p className="text-[11px] font-medium">escape hatch는 장애 대비책이 아니라 <b>검열 저항의 최후 보루</b> — 이것이 진짜 L2와 사설 DB의 경계선입니다. L2의 보안은 L1에서 상속됩니다.</p>
    </div>
  );
}
