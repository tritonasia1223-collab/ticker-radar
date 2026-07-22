// 블록체인 학습 탭 — 모든 수치의 단일 출처(§4.1). 각 상수에 출처·기준일 주석.
//   파라미터가 바뀌면(가스한도·블롭타깃 등) 이 파일만 수정. feeEngine 은 이 값을 인자/상수로 받는다.
//   기준일: 2026-07-21. 출처는 각 줄 주석 참조(구현 세션에서 웹검증 완료).
//
// ⚠ Ch4 로빈후드 사례: 원 지시문의 "$1,005,430 / L1 $7,430 / 0.74% / 14일" 수치는 웹검증에서
//   재현되지 않았다. 검증된 실측은 아래 caseStudy 로 교체.
//   ▶ 결정(사용자 승인): Ch4 는 [B안] — 특정 회사 수치에 의존하지 않고, "블롭 바닥 → L2 정산비 붕괴
//     → 운영사 마진 극대화"를 엔진(l2TxFee 마진 파생)이 구조적으로 증명하는 방식으로 서술.
//     검증된 실측(1주 ~$57k·90일 보조금)은 정직한 콜아웃 한 줄로만 첨부. Phase 4 에서 이 방침대로 구현.

export const CALIBRATION = {
  // ETH 시세 — 2026-07 평균 ~$1,868 (Fortune 일일 시세, changelly 7월 평균 $1,874). 라운딩.
  ethPriceUSD: 1_870,

  l1: {
    blockGasLimit: 60_000_000,        // Fusaka EIP-7935 기본 가스한도 60M (2025-12 메인넷). 출처: ethereum.org/consensys
    txGasCap: 16_777_216,             // EIP-7825 트랜잭션당 가스 상한 = 2^24. Fusaka 도입.
    baseFeeGwei: 0.05,                // 2026 평시 수준(저혼잡). 엔진 인자로도 주입 가능.
    priorityFeeGwei: 0.5,             // 평시 팁.
    blockTimeSec: 12,
    // 작업별 가스 사용량(표준값).
    gasUsage: { transfer: 21_000, erc20Transfer: 65_000, swap: 150_000, bridgeDeposit: 120_000 },
  },

  blob: {
    sizeKB: 128,                      // 블롭 1개 = 128KB (2^17 = 131072 blob-gas).
    gasPerBlob: 131_072,              // 2^17.
    target: 14, max: 21,              // Fusaka BPO2(2025-12) 이후 타깃 14 / 최대 21. 출처: EF blog.
    retentionDays: 18.2,             // 4096 에포크 ≈ 18.2일.
    minBaseFeeWei: 1,                 // 블롭 base fee 바닥(1 wei) — Ch3 패러독스의 근거.
    updateFraction: 3_338_477,        // EIP-4844 blob base fee 지수조정 분모.
    // 압축 가정: L2 트랜잭션은 서명 제거·state diff 로 ~40바이트/tx 로 압축 → 128KB/40B ≈ 3,200.
    //   보수적으로 3,000 tx/blob 로 둔다(정산비 분할상환 분모).
    avgTxPerBlob: 3_000,
  },

  l2: {
    execFeeUSD: 0.005,                // L2 실행 수수료(고정) ~$0.005. 시퀀서 마진은 이 값 − L1정산분으로 '파생'(엔진 계산).
  },

  // Ch4 실측 콜아웃 — 웹검증된 로빈후드 체인 수치(2026-07, Arbitrum Orbit L2).
  //   출처: cryptonomist/techtimes/cryptobriefing (2026-07-09~10). 원 지시문 수치와 다름(위 ⚠ 참조).
  caseStudy: {
    robinhoodChain: {
      week1ProtocolRevenueUSD: 57_000,   // 1주차 프로토콜 수익 ~$57k (거래 4백만 건 대비 '의도적으로 미미').
      week1TxCount: 4_000_000,
      feeSubsidyDays: 90,                // 런칭 후 90일간 네트워크 수수료를 로빈후드가 대납(≈2026-09말 만료).
      arbitrumFeeSharePct: 0.10,         // 수수료의 10%가 Arbitrum 생태계로(8%는 ARB 트레저리).
      base: "Arbitrum Orbit",
    },
  },

  dex: {
    lpFeeTiers: [0.0005, 0.003],      // 0.05% / 0.30% 풀 티어.
    protocolFeePct: 0.0005,           // 프로토콜/프론트엔드 수수료 0.05%.
    poolDepthUSD: 50_000_000,         // 예시 풀 깊이 $50M(슬리피지 x*y=k 근사용).
  },

  stablecoin: {
    treasuryYieldPct: 0.038,          // 3개월 국채 ~3.82%(2026-07-21). 준비금 이자율.
    ousdPerfFeePct: 0.2,              // 이자를 보유자에게 주고 성과수수료 20% 차감 모델(OUSD류).
    usdgPartnerSharePct: 0.5,         // 준비금 이자를 발행사/파트너가 분배(USDG류) — 파트너 몫 예시 50%.
  },

  rwa: {
    mgmtFeePct: 0.005,                // BUIDL 운용보수 50bps(ETH/Arb/OP). 출처: defillama/coindesk.
    platformFeePct: 0.0015,           // 토큰화 플랫폼(예: Ondo OUSG 15bps) 추가 수수료.
  },

  bridge: {
    // Ch6 콜아웃: 크로스체인 브릿지 누적 해킹 피해 >$2.8B(2022~, Web3 전체 해킹의 ~40%). 출처: yellow/1inch(2026).
    cumulativeHackLossesUSD: 2_800_000_000,
  },
} as const;

export type Calibration = typeof CALIBRATION;
