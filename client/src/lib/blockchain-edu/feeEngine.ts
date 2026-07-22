// 블록체인 학습 탭 — 수수료 계산 엔진(§4.2). 순수 함수만. React import 금지.
//   모든 금액 단위 USD. 상수는 calibration.ts 에서 주입(기본값) 또는 인자로 오버라이드.
//   반증 테스트(feeEngine.test.ts, §4.3)가 이 모듈의 게이트다 — 수식이 먼저 맞아야 UI 를 짠다.
import { CALIBRATION } from "./calibration.js";

// ── 공용 타입(§3) ──
export type Recipient =
  | "burn" | "validator" | "sequencer" | "lp" | "protocol" | "issuer" | "custodian" | "assetManager";
export type Layer = "L1" | "L2" | "offchain";
export interface FeeSplit { recipient: Recipient; amountUSD: number; layer: Layer }

const C = CALIBRATION;
const gweiToUSD = (gwei: number, ethPriceUSD = C.ethPriceUSD) => gwei * 1e-9 * ethPriceUSD;
const weiToUSD = (wei: number, ethPriceUSD = C.ethPriceUSD) => wei * 1e-18 * ethPriceUSD;

// ── 1. L1 트랜잭션 수수료(EIP-1559 분해) ── burn=base×gas(소각), validator=priority×gas(팁).
//   금액(amountUSD)과 무관한 '고정비' — 가스량만의 함수.
export function l1TxFee(
  gasUsed: number,
  baseFeeGwei = C.l1.baseFeeGwei,
  priorityFeeGwei = C.l1.priorityFeeGwei,
  ethPriceUSD = C.ethPriceUSD,
): { burn: number; validator: number; total: number } {
  const burn = gweiToUSD(gasUsed * baseFeeGwei, ethPriceUSD);
  const validator = gweiToUSD(gasUsed * priorityFeeGwei, ethPriceUSD);
  return { burn, validator, total: burn + validator };
}

// ── 2. base fee 지수 조정 ── 타깃(50%) 대비 ±12.5%/블록. ratio=gasUsed/max(0~1).
export function nextBaseFee(currentBaseFee: number, gasUsedRatio: number): number {
  // EIP-1559: base_{n+1} = base_n × (1 + (1/8)×((gasUsed−target)/target)), target=max/2.
  //   (gasUsed−target)/target = 2·ratio − 1  →  배율 = 1 + (2·ratio−1)/8.
  const r = Math.max(0, Math.min(1, gasUsedRatio));
  return currentBaseFee * (1 + (2 * r - 1) / 8);
}

// ── 3. 블롭 전용 fee 시장(§Ch3-3) ── 타깃 미만 수요가 지속되면 minBaseFeeWei(1 wei) 바닥 고착.
//   초과 수요가 지속돼야 지수 상승. currentExcess 를 blob-gas 단위로 누적(0에서 클램프 → 바닥의 비대칭성).
export function nextBlobBaseFee(
  currentExcess: number,
  blobsUsed: number,
): { nextExcess: number; baseFeeWei: number } {
  const { gasPerBlob, target, minBaseFeeWei, updateFraction } = C.blob;
  const targetBlobGas = target * gasPerBlob;
  const nextExcess = Math.max(0, currentExcess + blobsUsed * gasPerBlob - targetBlobGas);
  // 현재 블록의 base fee 는 진입 시점 excess 로 계산(EIP-4844 fake_exponential 을 Math.exp 로 근사).
  const baseFeeWei = minBaseFeeWei * Math.exp(currentExcess / updateFraction);
  return { nextExcess, baseFeeWei };
}

// ── 4. 블롭 정산비 분할상환 ── 블롭 1개 비용 ÷ 담긴 트랜잭션 수. txCount 에 대해 단조감소.
export function blobAmortization(
  txCount: number,
  blobBaseFeeWei: number,
  ethPriceUSD = C.ethPriceUSD,
): number {
  if (txCount <= 0) return 0;
  const blobCostUSD = weiToUSD(blobBaseFeeWei * C.blob.gasPerBlob, ethPriceUSD);
  return blobCostUSD / txCount;
}

// ── 5. L2 트랜잭션 수수료 ── 고정비(금액 무관). 시퀀서 마진 = 실행료 − L1정산 분담분(파생).
//   "L2 정산비가 거의 공짜 → 운영사 마진이 사실상 전부"가 여기서 구조적으로 나온다.
export function l2TxFee(
  _amountUSD: number,
  blobBaseFeeWei = C.blob.minBaseFeeWei,
  execFeeUSD = C.l2.execFeeUSD,
): { sequencer: number; l1DataCostShare: number; total: number } {
  const l1DataCostShare = blobAmortization(C.blob.avgTxPerBlob, blobBaseFeeWei);
  const sequencer = execFeeUSD - l1DataCostShare;
  return { sequencer, l1DataCostShare, total: execFeeUSD };
}

// ── 6. DEX 스왑 수수료 ── LP(비례) + 프로토콜(비례) + 슬리피지(x*y=k 근사, 비선형).
//   슬리피지 = 주문/풀깊이 비율의 초선형 함수 → 주문 0 에서 0(네거티브 컨트롤).
export function swapFee(
  amountUSD: number,
  poolDepthUSD = C.dex.poolDepthUSD,
  lpFeeTier = C.dex.lpFeeTiers[1],       // 기본 0.30%
  protocolFeePct = C.dex.protocolFeePct,
): { lp: number; protocol: number; slippage: number; total: number } {
  const lp = amountUSD * lpFeeTier;
  const protocol = amountUSD * protocolFeePct;
  // 상수곱 x*y=k 근사: 체결가 충격 비율 ≈ amount/(poolDepth+amount). 손실액 = amount × 그 비율.
  const slippage = amountUSD * (amountUSD / (poolDepthUSD + amountUSD));
  return { lp, protocol, slippage, total: lp + protocol + slippage };
}

// ── 7. 스테이블코인 이자 흐름 ── 거래가 아니라 '보유 기간'에 발생. 모델별 수취인이 다르다.
//   반환 = '수수료(누군가 떼가는 몫)' 분해. 나머지는 암묵적으로 보유자 몫.
export type StablecoinModel = "usdc" | "usdg" | "ousd";
export function stablecoinYieldFlow(
  holdingUSD: number,
  days: number,
  model: StablecoinModel,
): FeeSplit[] {
  const yieldUSD = holdingUSD * C.stablecoin.treasuryYieldPct * (days / 365);
  if (yieldUSD <= 0) return [];
  switch (model) {
    case "usdc": // 발행사가 준비금 이자 전액 수취.
      return [{ recipient: "issuer", amountUSD: yieldUSD, layer: "offchain" }];
    case "usdg": { // 발행사·파트너가 이자 분배.
      const partner = yieldUSD * C.stablecoin.usdgPartnerSharePct;
      return [
        { recipient: "issuer", amountUSD: yieldUSD - partner, layer: "offchain" },
        { recipient: "protocol", amountUSD: partner, layer: "offchain" }, // 파트너/유통사
      ];
    }
    case "ousd": // 이자는 보유자에게, 발행사는 성과수수료만.
      return [{ recipient: "issuer", amountUSD: yieldUSD * C.stablecoin.ousdPerfFeePct, layer: "offchain" }];
  }
}

// ── 8. 여정 결산서 ── 수취인별 합계 + 소각률 + 'L1 전용' 가상 비교.
export interface JourneyReceipt {
  byRecipient: Record<string, number>;
  totalUSD: number;
  burnPct: number;
  l1OnlyVirtualUSD: number;   // 같은 작업을 전부 L1 에서 했다면(가상) 낸 가스비 근사.
}
export function journeyReceipt(
  ledgerSplits: FeeSplit[],
  l1OnlyVirtualUSD = 0,
): JourneyReceipt {
  const byRecipient: Record<string, number> = {};
  let totalUSD = 0, burn = 0;
  for (const s of ledgerSplits) {
    byRecipient[s.recipient] = (byRecipient[s.recipient] ?? 0) + s.amountUSD;
    totalUSD += s.amountUSD;
    if (s.recipient === "burn") burn += s.amountUSD;
  }
  return { byRecipient, totalUSD, burnPct: totalUSD > 0 ? burn / totalUSD : 0, l1OnlyVirtualUSD };
}
