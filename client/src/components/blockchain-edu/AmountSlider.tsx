// 블록체인 학습 탭 — 금액 슬라이더(§5). 로그 스케일 $10~$1M. 상단 고정.
//   값 변경 시 현재 씬 수수료가 실시간 재계산(과거 원장은 불변, §3).
import { useJourney, AMOUNT_MIN, AMOUNT_MAX } from "@/lib/blockchain-edu/journeyState";
import { fmtUSD } from "@/lib/blockchain-edu/format";

const LOG_MIN = Math.log10(AMOUNT_MIN), LOG_MAX = Math.log10(AMOUNT_MAX);
const toSlider = (a: number) => ((Math.log10(a) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 1000;
const toAmount = (s: number) => Math.round(10 ** (LOG_MIN + (s / 1000) * (LOG_MAX - LOG_MIN)));

export default function AmountSlider() {
  const { state, setAmount } = useJourney();
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="bc-amount" className="text-[12px] font-medium text-muted-foreground">거래 금액 <span className="text-[10.5px]">(로그 스케일)</span></label>
        <span className="text-[17px] font-bold tabular-nums">{fmtUSD(state.amountUSD)}</span>
      </div>
      <input id="bc-amount" type="range" min={0} max={1000} value={toSlider(state.amountUSD)}
        onChange={(e) => setAmount(toAmount(Number(e.target.value)))}
        className="mt-1.5 w-full accent-primary" />
      <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>$10</span><span>$1K</span><span>$1M</span>
      </div>
    </div>
  );
}
