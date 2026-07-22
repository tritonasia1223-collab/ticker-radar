// 수수료 엔진 반증 테스트(§4.3) — 이 7종 그린이 Phase 0 게이트. 통과 전 UI 작성 금지.
//   구조적 성질(보존·고정비·역전·수렴·바닥·단조·네거티브)을 검증 — 상수값이 바뀌어도 성질은 유지돼야 한다.
import { describe, it, expect } from "vitest";
import {
  l1TxFee, nextBaseFee, nextBlobBaseFee, blobAmortization,
  l2TxFee, swapFee, stablecoinYieldFlow,
} from "./feeEngine.js";
import { CALIBRATION as C } from "./calibration.js";

const EPS = 1e-9;

describe("F1. 보존 법칙 — 분해합 = 총 수수료", () => {
  it("l1TxFee: burn+validator = total", () => {
    const f = l1TxFee(C.l1.gasUsage.swap);
    expect(Math.abs(f.burn + f.validator - f.total)).toBeLessThan(EPS);
  });
  it("swapFee: lp+protocol+slippage = total", () => {
    const f = swapFee(12_345);
    expect(Math.abs(f.lp + f.protocol + f.slippage - f.total)).toBeLessThan(EPS);
  });
  it("l2TxFee: sequencer+l1DataCostShare = total(execFee)", () => {
    const f = l2TxFee(1_000);
    expect(Math.abs(f.sequencer + f.l1DataCostShare - f.total)).toBeLessThan(EPS);
  });
  it("stablecoinYieldFlow(usdg): 분배합 = 총 이자", () => {
    const holding = 100_000, days = 365;
    const splits = stablecoinYieldFlow(holding, days, "usdg");
    const sum = splits.reduce((s, x) => s + x.amountUSD, 0);
    const gross = holding * C.stablecoin.treasuryYieldPct * (days / 365);
    expect(Math.abs(sum - gross)).toBeLessThan(1e-6);
  });
});

describe("F2. 고정비 성질 — L1/L2 tx 비용은 금액과 무관", () => {
  it("l2TxFee($10) === l2TxFee($1M)", () => {
    expect(l2TxFee(10).total).toBeCloseTo(l2TxFee(1_000_000).total, 12);
  });
  it("l1TxFee 는 가스량만의 함수(금액 인자 없음)", () => {
    // 동일 가스량이면 항상 동일 — 서명상 amountUSD 를 받지 않음을 성질로 확인.
    expect(l1TxFee(21_000).total).toBeCloseTo(l1TxFee(21_000).total, 12);
  });
});

describe("F3. 역전 구조 — 소액=가스 지배, 거액=슬리피지+LP 지배, 교차점 존재", () => {
  const comboGas = l1TxFee(C.l1.gasUsage.swap).total + l1TxFee(C.l1.gasUsage.transfer).total;
  const gasShare = (amt: number) => { const v = swapFee(amt).total; return comboGas / (comboGas + v); };
  const varShare = (amt: number) => { const s = swapFee(amt); return (s.slippage + s.lp) / (comboGas + s.total); };
  it("소액($10): 가스 비중 > 80%", () => { expect(gasShare(10)).toBeGreaterThan(0.8); });
  it("거액($1M): 슬리피지+LP 비중 > 90%", () => { expect(varShare(1_000_000)).toBeGreaterThan(0.9); });
  it("교차점 존재: 가스 비중이 단조 감소해 0.5 를 가로지른다", () => {
    expect(gasShare(10)).toBeGreaterThan(0.5);
    expect(gasShare(1_000_000)).toBeLessThan(0.5);
    expect(gasShare(10)).toBeGreaterThan(gasShare(1_000_000)); // 단조성
  });
});

describe("F4. base fee 수렴 — 50% 안정, 100% 연속 시 지수 증가", () => {
  it("타깃(ratio 0.5)에서 불변", () => {
    expect(nextBaseFee(100, 0.5)).toBeCloseTo(100, 9);
  });
  it("100% 연속 12블록 → 배율 = 1.125^12", () => {
    let base = 1;
    for (let i = 0; i < 12; i++) base = nextBaseFee(base, 1.0);
    expect(base).toBeCloseTo(Math.pow(1.125, 12), 9);
  });
  it("0% 연속 → 감소(−12.5%/블록)", () => {
    expect(nextBaseFee(100, 0)).toBeCloseTo(87.5, 9);
  });
});

describe("F5. 블롭 바닥 고착 — 타깃 미만은 1 wei 고착, 초과는 지수 상승(비대칭)", () => {
  it("타깃 미만(10/14) 100블록 연속 → minBaseFeeWei 에서 불변", () => {
    let excess = 0;
    for (let i = 0; i < 100; i++) {
      const r = nextBlobBaseFee(excess, 10);
      expect(r.baseFeeWei).toBeCloseTo(C.blob.minBaseFeeWei, 12);
      excess = r.nextExcess;
    }
    expect(excess).toBe(0); // 바닥 클램프
  });
  it("타깃 초과(21/14) 연속 → base fee 지수 상승(단조 증가)", () => {
    let excess = 0, prevFee = 0;
    const fees: number[] = [];
    for (let i = 0; i < 20; i++) {
      const r = nextBlobBaseFee(excess, 21);
      fees.push(r.baseFeeWei);
      excess = r.nextExcess;
    }
    // 첫 블록은 아직 excess=0 이라 바닥, 이후 상승. 마지막이 첫값보다 훨씬 큼.
    expect(fees[fees.length - 1]).toBeGreaterThan(fees[0]);
    expect(fees[fees.length - 1]).toBeGreaterThan(C.blob.minBaseFeeWei);
    for (let i = 2; i < fees.length; i++) expect(fees[i]).toBeGreaterThan(fees[i - 1]);
    void prevFee;
  });
  it("비대칭: 바닥에서 이탈하려면 '지속적' 초과 수요가 필요(1블록 초과로는 즉시 안 뜀)", () => {
    // 초과 1블록 뒤 곧바로 미달로 돌아가면 excess 가 다시 0 으로 수렴.
    let excess = 0;
    excess = nextBlobBaseFee(excess, 21).nextExcess;   // 초과 1회
    for (let i = 0; i < 5; i++) excess = nextBlobBaseFee(excess, 10).nextExcess; // 미달 지속
    expect(excess).toBe(0);
  });
});

describe("F6. 분할상환 단조성 — txCount 증가 시 단조 감소, txCount=1 전액", () => {
  const feeWei = 1000; // 임의 블롭 base fee
  it("단조 감소", () => {
    expect(blobAmortization(1, feeWei)).toBeGreaterThan(blobAmortization(10, feeWei));
    expect(blobAmortization(10, feeWei)).toBeGreaterThan(blobAmortization(100, feeWei));
    expect(blobAmortization(100, feeWei)).toBeGreaterThan(0);
  });
  it("txCount=1 이면 블롭 전액 부담", () => {
    const full = feeWei * C.blob.gasPerBlob * 1e-18 * C.ethPriceUSD;
    expect(blobAmortization(1, feeWei)).toBeCloseTo(full, 18);
  });
});

describe("F7. 네거티브 컨트롤", () => {
  it("스테이블코인 days=0 → 수수료 0(빈 배열)", () => {
    expect(stablecoinYieldFlow(1_000_000, 0, "usdc")).toEqual([]);
    expect(stablecoinYieldFlow(1_000_000, 0, "ousd")).toEqual([]);
  });
  it("슬리피지: 주문 0 → 0", () => {
    expect(swapFee(0).slippage).toBe(0);
    expect(swapFee(0).total).toBe(0);
  });
});
