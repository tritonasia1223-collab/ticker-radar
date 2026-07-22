// Ch7 씬 — 스테이블코인: 달러의 락앤민트. 담보만 다르다. 수수료는 '보유 기간'에 발생.
import { useState } from "react";
import { useJourney } from "@/lib/blockchain-edu/journeyState";
import { stablecoinYieldFlow, type StablecoinModel } from "@/lib/blockchain-edu/feeEngine";
import { CALIBRATION as C } from "@/lib/blockchain-edu/calibration";
import { fmtUSDprecise } from "@/lib/blockchain-edu/format";

const MODELS: { id: StablecoinModel; name: string; desc: string }[] = [
  { id: "usdc", name: "USDC", desc: "발행사가 준비금 이자를 전액 가져갑니다." },
  { id: "usdg", name: "USDG", desc: "발행사와 파트너(유통사)가 이자를 나눕니다." },
  { id: "ousd", name: "OUSD", desc: "이자를 보유자에게 주고, 발행사는 성과수수료만 뗍니다." },
];

export function Ch7Stablecoin() {
  const { state } = useJourney();
  const [model, setModel] = useState<StablecoinModel>("usdc");
  const [days, setDays] = useState(365);
  const holding = state.amountUSD;
  const gross = holding * C.stablecoin.treasuryYieldPct * (days / 365);
  const splits = stablecoinYieldFlow(holding, days, model);
  const feeTaken = splits.reduce((s, x) => s + x.amountUSD, 0);
  const holderKeeps = gross - feeTaken;
  const rows: { label: string; v: number; c: string }[] = [
    ...splits.map((s) => ({ label: s.recipient === "issuer" ? "발행사" : "파트너", v: s.amountUSD, c: "#1e40af" })),
    { label: "보유자(나)", v: holderKeeps, c: "#0d9488" },
  ];

  return (
    <div className="w-full space-y-3">
      <p className="text-[11.5px] text-muted-foreground">Ch2와 <b className="text-foreground">같은 그림, 담보만 다르다</b> — ETH 대신 국채·예금이 잠기고 달러 토큰이 발행됩니다.</p>
      <div className="flex gap-1.5">
        {MODELS.map((m) => (
          <button key={m.id} onClick={() => setModel(m.id)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-[12px] font-semibold transition-colors ${
              m.id === model ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>
            {m.name}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{MODELS.find((m) => m.id === model)!.desc}</p>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>보유 기간 <b className="text-foreground tabular-nums">{days}일</b></span>
        <span>준비금 이자율 {(C.stablecoin.treasuryYieldPct * 100).toFixed(2)}% · 보유 {fmtUSDprecise(holding)}</span>
      </div>
      <input type="range" min={0} max={730} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full accent-primary" />

      <div className="rounded-lg border border-border p-2.5">
        <div className="mb-1 flex justify-between text-[11.5px]"><span>기간 총 이자</span><b className="tabular-nums">{fmtUSDprecise(gross)}</b></div>
        {gross > 0 && rows.map((r) => (
          <div key={r.label} className="mb-1">
            <div className="flex justify-between text-[10.5px]"><span style={{ color: r.c }}>{r.label}</span><span className="tabular-nums">{fmtUSDprecise(r.v)}</span></div>
            <div className="h-2 w-full overflow-hidden rounded bg-secondary"><div className="h-full rounded" style={{ width: `${Math.max(0, (r.v / gross) * 100)}%`, background: r.c }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
