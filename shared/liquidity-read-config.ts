// 미국 유동성(읽기) — 결정이 필요한 값(명세 8장). 임의로 채우지 않는다.
// null 이면 해당 그림 요소만 숨기거나 '준비 중'으로 대체하고, 결론 문장은 남은 데이터로 생성한다(명세 9장).
// 단위: 금액은 million USD(기존 파이프라인과 동일), 스프레드는 %p.

export interface ReservesZones {
  unit: "musd" | "gdp_pct";   // 눈금 단위 — 달러 수준 또는 GDP 대비 %
  tight: number;              // 이 값 미만 = 빠듯
  ample: number;              // 이 값 이상 = 넉넉 (사이 = 경계)
  gdpMusd?: number;           // unit 이 gdp_pct 일 때 분모(명목 GDP, musd)
}

export interface ReadConfig {
  TGA_TARGET: number | null;                 // 재무부 목표 현금 잔고(분기 차입 계획 발표값), musd
  RESERVES_ZONES: ReservesZones | null;      // 지급준비금 빠듯/경계/넉넉 구간
  HY_THRESHOLD: number | null;               // 하이일드 스프레드 경계선, %p
  EMERGENCY_LOAN_THRESHOLD: number | null;   // 긴급대출 경계선, musd
  DOMINANT_SHARE: number;                    // '주도 요인' 판정 비율
  FLAT_PCT: number;                          // '거의 그대로' 판정, % (|ΔNL%| 미만)
}

export const READ_CONFIG: ReadConfig = {
  TGA_TARGET: null,               // 사용자 입력 대기
  RESERVES_ZONES: null,           // 사용자 입력 대기
  HY_THRESHOLD: null,             // 사용자 입력 대기
  EMERGENCY_LOAN_THRESHOLD: null, // 사용자 입력 대기
  DOMINANT_SHARE: 0.5,
  FLAT_PCT: 0.3,
};
