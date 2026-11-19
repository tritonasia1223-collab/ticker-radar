// 블록체인 학습 탭 — 수수료 구성 비율 스택바(§5). 금액 슬라이더와 연동돼 '역전'을 시각화.
//   막대 너비가 morph(0.3s)하며 소액=가스 지배 → 거액=슬리피지·LP 지배로 뒤집히는 걸 보여준다.
import type { FeeSplit } from "@/lib/blockchain-edu/feeEngine";
import { recipientPalette, RECIPIENT_META } from "@/lib/blockchain-edu/layers";
import { fmtUSD, fmtUSDprecise, fmtPct } from "@/lib/blockchain-edu/format";

export default function FeeStackBar({ splits, title = "수수료 구성" }: { splits: FeeSplit[]; title?: string }) {
  const total = splits.reduce((s, x) => s + x.amountUSD, 0);
  const sorted = [...splits].filter((s) => s.amountUSD > 0).sort((a, b) => b.amountUSD - a.amountUSD);

  if (total <= 0) return <div className="text-[length:var(--font-size-11px)] text-muted-foreground">{title} · 수수료 없음</div>;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[length:var(--font-size-11px)] text-muted-foreground">{title}</span>
        <span className="text-[length:var(--font-size-12px)] font-semibold tabular-nums">총 {fmtUSDprecise(total)}</span>
      </div>
      <div className="flex h-6 w-full overflow-hidden rounded-md">
        {sorted.map((s) => {
          const pct = s.amountUSD / total;
          const pal = recipientPalette(s.recipient);
          return (
            <div key={s.recipient} title={`${RECIPIENT_META[s.recipient].label} ${fmtUSDprecise(s.amountUSD)} (${fmtPct(pct)})`}
              
              
              
              style={{...({ background: pal.solid }),width: `${pct * 100}%`}}
              className="flex items-center justify-center overflow-hidden">
              {pct > 0.12 && <span className="truncate px-1 text-[length:var(--font-size-10px)] font-semibold" style={{ color: "var(--surface)" }}>{fmtPct(pct)}</span>}
            </div>
          );
        })}
      </div>
      {/* 범례 */}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {sorted.map((s) => {
          const pal = recipientPalette(s.recipient);
          return (
            <span key={s.recipient} className="flex items-center gap-1 text-[length:var(--font-size-10_5px)] text-muted-foreground">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: pal.solid }} />
              {RECIPIENT_META[s.recipient].label} <span className="tabular-nums">{fmtPct(s.amountUSD / total)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
