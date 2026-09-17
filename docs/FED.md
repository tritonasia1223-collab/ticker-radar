# 미국 유동성 — 현재 구현

메인 경로는 /#/fed. 연준 H.4.1 자산·부채, 준비금 변화 분해, 재무부 시장성 국채 종류별 잔액과 순발행을 확인합니다.

| 파일 | 책임 |
|---|---|
| client/src/pages/Fed.tsx | 시점 선택, T-계정·워터폴·국채 차트·위기 감지기 |
| server/fed.ts | 시리즈 정의, 단위 정규화, API 응답 조립 |
| script/fed-backfill.ts | FRED 공개 CSV·FiscalData MSPD JSON 수집 및 upsert |
| script/fed-verify.ts | 단위 앵커·분해 검증 |
| .github/workflows/fed.yml | 목요일 22:30 UTC 수집·검증 |

API는 GET /api/fed/overview, 테이블은 fed_balance_sheet입니다. 달러 금액은 million USD로 통일하며 지수는 원래 단위를 유지합니다. 수요일 준비금은 WLODLL, 현금통화는 WLFN을 사용합니다. 주간 평균과 수요일 잔액을 혼합하지 않습니다.

FRED 공개 CSV와 재무부 공개 JSON을 사용하므로 현재 수집 경로에는 FRED API 키가 필요 없습니다. DB 연결은 DATABASE_URL로 설정합니다. 일간 순유동성 데이터 함수는 있지만 현재 화면과 정기 수집은 주간·월간 중심입니다.

명령은 [README](../README.md)를 참고하세요. fed-balance-sheet-tab-plan.md의 일간 일정·API 키 설명은 초기 계획입니다. 정의 변경 시 서버 계산·검증·프런트 표시를 함께 확인합니다.


계산과 결측 처리:

- 순발행은 바로 전 달 잔액이 있을 때만 계산합니다. 빠진 달을 건너뛴 차이는 월간 변화로 표시하지 않습니다.
- 국채 수급 차트는 달력상의 빈 달을 유지합니다. 12개월 흡수율은 12개 달과 각 계산값이 모두 유효할 때 표시합니다.
- 주간 변화와 13주 변화는 배열 행 수 대신 실제 날짜 간격으로 비교합니다.
- 프로그램별 관측 누락은 0으로 간주하지 않습니다. 합계가 불완전하면 ‘자료 부족’으로 표시합니다. 프로그램 시작 이전처럼 실제로 비활성이었더라도 자료가 없으면 판정을 보류합니다.
- 서버 내부 결측은 NaN, JSON 응답에서는 null입니다. 클라이언트는 숫자 연산 전 결측을 복원해 null이 0으로 계산되지 않게 합니다.
- API 조회 실패는 빈 데이터와 구분하고 ‘다시 불러오기’로 재시도합니다.

회귀 테스트는 `tests/stability.test.ts`, 날짜 비교 함수는 `shared/time-series.ts`에 있습니다.

## 국채 증감 분해·거래 워터폴

기존 T-계정, 오른쪽 상세 캔버스, 지급준비금 워터폴, 월별 순발행 비교 그래프는 유지합니다. 월별 비교 그래프와 위기 감지기 사이에 `client/src/components/TreasuryFlowDetails.tsx`를 추가했습니다.

- 가로 막대는 기존 그래프와 같은 월·만기 선택을 따릅니다. 연준 보유 증감과 연준 외 보유 증감(잔액 차감 추정)을 양수·음수로 분해하며, 중복 숫자 카드는 표시하지 않습니다.
- 거래 워터폴은 펼칠 때만 `GET /api/fed/treasury-transactions?month=YYYY-MM`를 조회합니다. 상세 거래는 **전체 국채** 기준입니다. 원천 분류가 기존 만기 버킷과 달라 임의로 나누지 않습니다.
- `server/treasury-transactions.ts`는 공식 공개 API를 읽고 완전한 응답을 최대 6시간 캐시합니다. 별도 DB 변경이나 수집 크론은 필요 없습니다. 일부 출처가 실패해도 확인 가능한 다른 출처는 표시하고, 실패 응답은 캐시하지 않아 즉시 재시도할 수 있습니다.

| 거래 | 출처·집계 기준 |
|---|---|
| 재무부 발행·상환 | FiscalData DTS Table IIIA, 월말 마지막 관측의 월누적액. 시장성 Bills·Notes·Bonds와 TIPS 물가보정, FFB 제외. 단위 백만 달러·액면 기준 |
| 바이백 | FiscalData `buybacks_operations`, 결제월의 실제 낙찰 액면. 현금관리·유동성 지원·기타 목적 구분. 발표 한도 및 결과 미공표는 실행액으로 사용하지 않음 |
| 연준 매입·매도 | New York Fed Treasury operations, 결제월의 실제 낙찰 액면 |
| 연준 만기 재투자 | FiscalData `auctions_query`의 `soma_accepted`, 발행일 기준 |
| 연준 만기도래 | 직전 수요일 SOMA 종목별 액면에서 다음 주 만기도래를 합산한 **추정**. 주간 사이 거래·결제일 변동을 완전히 재현하지 않음 |

DTS 상환에 포함된 바이백은 한 번만 분리합니다. 발행·상환·물가보정 합과 기존 MSPD 잔액 변화 사이의 차이는 별도 회색 막대로 대조합니다. 연준 거래는 달력 월 결제일 기준, 기존 보유 증감은 마지막 수요일 기준이므로, 남는 차이를 실제 매입·상환으로 단정하지 않고 `관측일·기타 차이`로 표시합니다. RMP·재투자 계획을 실제 매입액으로 대체하거나 목적별 실행액을 임의 배분하지 않습니다.

`shared/treasury-transactions.ts`에 부호별 분해와 워터폴 계산이 있으며, `tests/treasury-transactions.test.ts`에서 음수·0·결측, 바이백 중복 차감, 결제월, 만기도래 주간 경계, 실패 후 재조회 등을 검증합니다.

## 미국 유동성(베타) — /#/liquidity

기존 /#/fed 는 그대로 두고, 내비 "미국 유동성" 아래 "미국 유동성(베타)"로 추가한 새 페이지입니다. 연준 대차대조표 중심에서 "미국 전반의 유동성"으로 무게중심을 옮기되, 얼마나 → 어디서 → 어디로 세 질문을 한 흐름으로 잇습니다.

| 파일 | 책임 |
|---|---|
| client/src/pages/LiquidityBeta.tsx | 띠(얼마나·어디서·어디로), 5년 전년비 차트, T계정 재사용, 만기별 발행→인수자 생키, 생애주기 표, 맥락 띠 |
| client/src/components/fed-taccount.tsx | /fed 에서 순수 이동한 T계정·구성비 스택·색 상수·금액 헬퍼. 두 페이지가 공유 |
| shared/liquidity-beta.ts | 순수 계산: 전년비·기간 변화·세금일·띠 항등식·입찰 집계·생키 데이터·판정 |
| server/liquidity-beta.ts | FRED 공개 CSV 11개 + FiscalData 입찰 낙찰 분해를 라이브 조회, 6시간 캐시. DB 미사용 |
| tests/liquidity-beta.test.ts | 결측 NaN/제외·항등식·링크 합·플래그 매핑 회귀 |

API 는 GET /api/liquidity/context (M2SL·DPSACBW027SBOG·SOFR·IORB·NFCI·BAMLH0A0HYM2·DFII10·DTWEXBGS·INDPRO·UNRATE·PCEPILFE) 와 GET /api/liquidity/auctions?months=1|3 (auctions_query 의 딜러·직접·간접·비경쟁·SOMA 낙찰액, 결제일 기준 창). 부분 실패는 errors 로 명시하고 실패 응답은 캐시하지 않습니다. 금액 시리즈는 million USD 로 통일합니다(FRED billions ×1000, FiscalData dollars ÷1e6). 띠와 T계정은 기존 /api/fed/overview 를 그대로 읽습니다.

띠의 연결은 H.4.1 항등식입니다. Δ순유동성 = Δ자산 − ΔTGA − Δ역레포 (어디서), Δ지급준비금 = Δ순유동성 − Δ현금통화 − Δ기타 (어디로의 첫 막대). 은행 예금(H.8 주간)·단기채 잔액(MSPD 월간)은 같은 기간 잔액 변화를 나란히 둘 뿐 합산하지 않습니다. 비교 구간에 분기 세금일(4·6·9·12월 15일)이 있으면 표기만 하고 보정하지 않습니다.

입찰 집계 규칙: FiscalData 는 TIPS 를 Note/Bond 에 inflation_index_security=Yes, FRN 을 floating_rate=Yes 로 표시하므로 플래그로 가릅니다. 낙찰액이 null(결과 미공표)이거나 귀속 항목 하나라도 결측이면 그 입찰은 통째로 제외하고 건수로 보고합니다. 다섯 주체 귀속 합과 total_accepted 는 FIMA 등 미분류분만큼 차이(실측 최대 약 3%)가 나며, 0 으로 메우지 않고 비율로 표시합니다. 생애주기 표의 만기상환은 인수 − 보유 변화의 추정치입니다.

알려진 한계: MMF 저수지는 출처 미정이라 자리만 있음 · 맥락 띠의 SOFR−IORB 임계(+10/+25bp)는 반증 테스트 전 초기 상수 · 라이브 조회 캐시는 인스턴스 메모리라 서버리스 콜드스타트마다 재조회. 정식 승격 시 새 시리즈는 server/fed.ts 레지스트리와 fed-backfill 로 이관합니다.
