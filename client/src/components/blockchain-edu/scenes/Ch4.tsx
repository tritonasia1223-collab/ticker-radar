// Ch4 씬 — 수수료의 해부(클라이맥스). 4개 케이스 분해 + 금액 역전 + 운영사 마진(엔진 파생).
import { useJourney } from "@/lib/blockchain-edu/journeyState";
import { actionSplits, ACTION_LABEL, totalUSD, type ActionKind } from "@/lib/blockchain-edu/scenarios";
import { l2TxFee } from "@/lib/blockchain-edu/feeEngine";
import { RECIPIENT_META } from "@/lib/blockchain-edu/layers";
import { fmtUSDprecise, fmtPct } from "@/lib/blockchain-edu/format";
import FeeStackBar from "@/components/blockchain-edu/FeeStackBar";

const CASES: ActionKind[] = ["bridgeDeposit", "l2Swap", "l2Transfer", "withdraw"];

export function Ch4Anatomy() {
  const { state } = useJourney();
  const amt = state.amountUSD;
  const swap = actionSplits("l2Swap", amt);
  const l2 = l2TxFee(amt);
  const marginPct = l2.sequencer / l2.total; // 시퀀서(운영사) 몫 — 엔진 파생

  return (
    <div className="w-full space-y-3">
      {/* 4개 케이스 */}
      <div className="grid grid-cols-2 gap-2">
        {CASES.map((k) => {
          const s = actionSplits(k, amt);
          const tot = totalUSD(s);
          const top = [...s].sort((a, b) => b.amountUSD - a.amountUSD)[0];
          return (
            <div key={k} className="rounded-lg border border-border bg-background p-2.5">
              <div className="text-[11.5px] font-semibold">{ACTION_LABEL[k]}</div>
              <div className="text-[13px] font-bold tabular-nums">{fmtUSDprecise(tot)}</div>
              <div className="text-[10px] text-muted-foreground">주 수취인 · {top ? RECIPIENT_META[top.recipient].label : "—"}</div>
            </div>
          );
        })}
      </div>

      {/* 스왑의 역전 */}
      <div className="rounded-lg border border-border p-2.5">
        <div className="mb-1 text-[11.5px] font-semibold">DEX 스왑 — 위 슬라이더로 $10↔$1M 드래그</div>
        <FeeStackBar splits={swap} />
        <p className="mt-1.5 text-[10.5px] text-muted-foreground">소액이면 가스(고정비)가, 거액이면 슬리피지·LP(비례비)가 지배 — 교차점이 존재합니다.</p>
      </div>

      {/* 운영사 마진 (엔진 파생) */}
      <div className="rounded-lg border border-amber-400/50 bg-amber-50 p-2.5">
        <div className="text-[11.5px] font-bold text-amber-900">L2 정산비 붕괴 → 운영사 마진</div>
        <p className="mt-1 text-[11px] text-amber-900/90">
          L2 실행료 <b>{fmtUSDprecise(l2.total)}</b> 중 L1 정산분은 <b>{fmtUSDprecise(l2.l1DataCostShare)}</b>(블롭 바닥 덕에 사실상 0),
          나머지 <b className="tabular-nums">{fmtPct(marginPct)}</b>가 시퀀서(운영사) 몫입니다.
        </p>
        <p className="mt-1 border-t border-amber-400/40 pt-1 text-[10.5px] text-amber-900/80">
          실제 예: 로빈후드 체인은 1주 프로토콜 수익이 ~$57k로 미미했고(+90일 수수료 보조금), 진짜 수익은 지갑·커스터디·주문흐름에서 났습니다.
        </p>
      </div>
    </div>
  );
}
