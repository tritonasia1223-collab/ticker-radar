# A안 하단 민간 신용 경로 모니터 — 검증 및 구현 계획

작성일: 2026-09-29. 이 문서는 사전 검토 계획이며 이후 사용자가 구현을 승인했다. 실제 구현·실행 방법과 차이는 [CREDIT-MONITOR.md](CREDIT-MONITOR.md)를 참고한다.

## 1. 목표와 화면

기존 A안(/#/liquidity) 마지막 맥락 영역 아래에 민간 신용 모니터를 추가한다. 초기 목적은 지표를 모두 보며 페이지 설계를 다듬는 것이다. 은행 5개·비은행 9개의 논리적 지표 카드를 모두 펼치고, 필수 6개에는 배지만 붙인다. 필수 지표부터 개발하되 최종 화면에서 나머지를 숨기지 않는다.

배치 초안:

1. 기존 A안 전체.
2. 민간 신용 경로 모니터 제목, 독립 기준일(기본 최신), 차트 기간 1·3·5·10년.
3. 은행 경로 5개 카드: 대출기준, C&I, 수요, 비은행 대출, 대형/소형.
4. 비은행 경로 9개 카드: JSON의 priority 순서 유지. 카드에 회사채·단기자금·사모대출 분류 표시.
5. 은행·공개시장·사모대출 상태 요약 및 시나리오 A~F 적합도 전체.

데스크톱 2열·모바일 1열. 지표마다 이름, 한 줄 정의, 단위, 최신값, 관측일, 발표일(알려진 경우), 자료 경과일, 1·4·13주 변화, 백분위, 실제 분석 기간, 시계열, 출처를 표시한다. 수동 입력·자료 부족·수집 실패·오래된 자료를 구분한다. 복합 지표는 한 카드 안에 하위 차트를 둔다. 예금과 대출의 규모 차이는 각각 기준일=100 또는 증감률로 비교한다.

기존 A안 주 선택과 신규 신용 모니터의 기준일은 초기에는 독립시킨다. 상단 주를 바꿨는데 하단이 같은 기준일인 것처럼 보이지 않도록 신규 섹션에 기준일을 명시한다. 과거 시점 기능은 관측일뿐 아니라 발표일·수집본 존재를 확인한 범위에서 제공한다.

## 2. 검증 결과와 한계

현재 프로세스 및 프로젝트 .env를 읽는 Node dotenv 환경에 FRED_API_KEY가 설정되어 있지 않음을 값 출력 없이 확인했다. 따라서 인증 FRED API의 메타데이터/관측치 검증은 수행하지 못했다. 아래는 FRED 공식 페이지 및 발행기관 자료를 확인한 결과이며 API 검증 완료가 아니다. 키를 로컬 환경에 설정한 뒤 인증 API 검증을 구현의 첫 관문으로 삼는다. 키를 채팅에 붙여 넣을 필요는 없다.

| # | 지표 | 공식 자료 확인 결과 / 구현 제안 |
|---|---|---|
| 1 | SLOOS 기준 ★ | [DRTSCILM](https://fred.stlouisfed.org/series/DRTSCILM): 분기, 순응답 %, 비계절조정. JSON 설명과 일치. |
| 2 | H.8 C&I ★ | [BUSLOANS](https://fred.stlouisfed.org/series/BUSLOANS)는 **월간**, 십억 달러, 계절조정. 주간 목적에는 [TOTCI](https://fred.stlouisfed.org/series/TOTCI)(수요일 종료 주간, 동일 단위·계절조정)를 제안. 승인 후 JSON에 수정 기록. |
| 3 | SLOOS 수요 | [DRSDCILM](https://fred.stlouisfed.org/series/DRSDCILM): 분기, 순응답 %, 비계절조정. 현재 needs_lookup 후보가 설명과 일치. |
| 4 | 비은행 금융회사 대출 | [LNFACBW027SBOG](https://fred.stlouisfed.org/series/LNFACBW027SBOG): 주간, 십억 달러, 계절조정. 후보로 제안. NDFI 전체이며 사모대출 펀드만의 잔액으로 표시하지 않는다. |
| 5 | 대형/소형 은행 | 예금 [DPSLCBW027SBOG](https://fred.stlouisfed.org/series/DPSLCBW027SBOG)·[DPSSCBW027SBOG](https://fred.stlouisfed.org/series/DPSSCBW027SBOG), 대출·리스 [LLBLCBW027SBOG](https://fred.stlouisfed.org/series/LLBLCBW027SBOG)·[LLBSCBW027SBOG](https://fred.stlouisfed.org/series/LLBSCBW027SBOG). 모두 수요일 종료 주간, 십억 달러, 계절조정. C&I만이 아닌 총 대출·리스 기준인 후보. |
| 6 | HY OAS ★ | [BAMLH0A0HYM2](https://fred.stlouisfed.org/series/BAMLH0A0HYM2): 일간 종가, Percent, 비계절조정. 앱에서 스프레드 수준은 %p, 변화는 bp로 표시. |
| 7 | CP 스프레드 ★ | [RIFSPPNA2P2D90NB](https://fred.stlouisfed.org/series/RIFSPPNA2P2D90NB), [DTB3](https://fred.stlouisfed.org/series/DTB3) 모두 일간 %, 비계절조정. 공통 유효 날짜에서 JSON의 차감식을 적용한다. DTB3는 할인율 기준이므로 엄밀하게 수익률 관행을 통일한 OAS와는 구분한다. |
| 8 | CCC OAS ★ | [BAMLH0A3HYC](https://fred.stlouisfed.org/series/BAMLH0A3HYC): 일간 종가, Percent, 비계절조정. HY와 같은 표시 규칙. |
| 9 | BDC P/NAV ★ | ARCC·OBDC·FSK의 회사/SEC 공시에서 주당 NAV 확인 가능. 가격 시계열 제공 경로 및 각 회사의 NAV 추출 매핑은 추가 검증 필요. 공시 확인과 자동 수집 성공을 구분한다. |
| 10 | IG OAS | [BAMLC0A0CM](https://fred.stlouisfed.org/series/BAMLC0A0CM): 일간 종가, Percent, 비계절조정. HY와 같은 표시 규칙. |
| 11 | 회사채 발행량 | [SIFMA 통계](https://www.sifma.org/research/statistics)에 회사채 자료 존재. 월별 IG/HY 정의·다운로드 형식은 입력 시 확인. 지시대로 자동 수집 없이 CSV 템플릿만 제작. |
| 12 | CP 잔액 | [COMPOUT](https://fred.stlouisfed.org/series/COMPOUT): 수요일 종료 주간, 십억 달러, 계절조정. 전체 CP 시장으로 A2/P2 비금융만의 수량은 아니다. 조합 해석에 범위 차이를 표시. |
| 13 | BDC 부실·PIK | 회사별 분기 공시 기반 CSV 템플릿만 제작. non-accrual 원가/공정가치 기준 및 PIK의 분모를 명시하고 서로 다른 정의를 합산하지 않는다. |
| 14 | 레버리지론 | 유료 원자료를 수집하지 않고 [BKLN](https://www.invesco.com/us/en/financial-products/etfs/invesco-senior-loan-etf.html)·[SRLN](https://www.ssga.com/us/en/institutional/etfs/state-street-blackstone-senior-loan-etf-srln) ETF를 사용. 공식 상품 정의 확인. 가격 공급의 완전성은 별도 확인. CLO 스프레드 자체를 관측한 것처럼 표시하지 않는다. |

★ 필수 6개.

HY·CCC·IG FRED 공식 페이지에는 2026년 4월부터 3년 관측치만 제공한다는 안내가 있다. 따라서 10년 백분위를 무조건 제공할 수 없다. 10년 자료가 없으면 10년 백분위는 '자료 부족', 별도로 실제 확보 기간 백분위를 표시한다. 사용 가능한 기존 장기 원자료가 있으면 출처·정의·이용 범위를 확인한 뒤 연결한다. 무료 조회와 공개 재배포는 다르므로 ICE 시리즈의 명시된 제3자 배포 제한도 실제 게시 범위를 정할 때 반영한다. 현재 단계는 계획과 출처 확인이다.

NDFI 계열에는 분류 변경 효과가 있을 수 있다. [연준 H.8 2026-04-03 릴리스](https://www.federalreserve.gov/releases/h8/20260403/)는 2025-12-31 주간의 재분류를 설명한다. 급증을 경제적 신규 대출로만 해석하지 않도록 원천의 구조 변경 주석을 함께 보존한다.

BDC 공식 자료 확인 예시: [ARCC SEC 실적 공시](https://www.sec.gov/Archives/edgar/data/1287750/000162828026050303/arccq2-2026exhibit991.htm), [OBDC 투자자 페이지](https://www.blueowlcapitalcorporation.com/investors), [FSK SEC 실적 공시](https://www.sec.gov/Archives/edgar/data/1422183/000110465926058250/tm2614112d1_ex99-1.htm). 최신 NAV 수치나 XBRL 태그가 모두 자동 검증되었다는 의미는 아니다.

## 3. 폴더 구조와 설정 원본

아래는 구현 승인 후 만들 경로이며 아직 생성하지 않았다.

```text
shared/credit/credit_indicators.json     지표·소스·티커·변환·표시·시나리오의 단일 원본
shared/credit/schema.ts                  Zod 설정/응답 검증 및 타입
shared/credit/signals.ts                 날짜 정렬·변화율·백분위 순수 계산
shared/credit/scenarios.ts               설정의 조건식·가중치를 평가하는 일반 엔진
server/credit/sources.ts                 FRED/가격/SEC/수동 CSV 소스 어댑터
server/credit/storage.ts                 스냅샷·관측치 저장/조회
server/credit/routes.ts                  GET /api/liquidity/credit
script/verify-credit-series.ts           FRED 메타데이터·실제 관측 검증
script/collect-credit.ts                 초기 수집·갱신 CLI
script/import-credit-csv.ts              수동 자료 검증·가져오기
script/db-push-credit.ts                 해당 테이블만 만드는 명시적 마이그레이션
data/credit/manual/*.template.csv        수동 입력 템플릿
client/src/components/credit/            섹션·공통 카드·차트·시나리오 패널
tests/credit-signals.test.ts             계산·결측·발표일 회귀 검사
tests/credit-scenarios.test.ts           필수 근거·불충분·상충 사례 검사
```

첨부 JSON의 지표 ID·설명·우선순위를 보존한다. 승인된 series ID 수정, subseries, 단위·주기, 데이터 상태, 공시 태그, sources provenance를 같은 JSON에 추가한다. 별도 지표 목록을 UI/서버에 복사하지 않는다.

임계값은 애플리케이션 코드가 아닌 이 설정 파일의 signal_rules에, 시나리오 조건·가중치는 기존 scenarios 항목의 rules에 둔다. 즉 코드와 설정을 분리하면서 지표 설정 원본은 하나로 유지한다. reference_ranges를 실행 규칙으로 자동 해석하지 않는다. formula는 허용된 연산과 series 참조의 구조화된 표현식으로 검증하며 eval하지 않는다. 필드가 불확실하면 needs_lookup를 유지한다.

기존 React·TypeScript·Recharts·TanStack Query·Zod·Express·Drizzle·postgres·date-fns·Vitest를 재사용한다. HTTP는 Node fetch, 비밀값은 dotenv/서버 환경변수만 사용한다. CSV는 인용부호·쉼표·BOM을 지원하는 검증된 파서(csv-parse 후보)를 추가한다. 가격 어댑터는 기존 morning-market-sources의 구조를 참고하되 지표 티커나 정의를 하드코딩하지 않는다.

## 4. 저장과 수집

기존 Supabase PostgreSQL에 credit 전용 테이블을 제안한다. fed_balance_sheet 및 경제사 데이터와 분리한다. Vercel 파일시스템·메모리 캐시를 장기 저장소로 쓰지 않는다.

- credit_collection_runs: run_id, collected_at, config_version/hash, provider, 요청 범위, 성공/부분 실패, 원문 응답 해시 및 원문(압축/JSONB).
- credit_observation_versions: series_key, observation_date, value, unit, published_at(확인된 경우), retrieved_at, source_vintage(제공 시), run_id. 값이 바뀌면 새 버전 보존.
- credit_filings: ticker, period_end, published_at, effective_at, metric, value, denominator_basis, source_url, accession, retrieved_at.
- credit_analysis_snapshots: as_of, calculated_at, config_hash, 사용한 관측 버전, 신호·근거·시나리오 결과.

수집 실행은 페이지 요청과 분리한다. API는 저장된 마지막 유효 자료를 읽고, 수집 실패 시 이전 자료의 날짜와 실패 상태를 표시한다. 인증 API의 키/URL 쿼리는 로그에서 제거한다. 데이터가 없으면 0이나 정상으로 채우지 않는다.

초기 수집은 최대 11년(10년 평가 창 + 전년비 계산용 이전 자료)을 요청하고 실제 확보 범위를 기록한다. H.8은 수정 이력을 잡기 위해 정기적으로 전 평가 창을 다시 비교한다. 수집 시점부터의 스냅샷 보존은 과거 당시 발표본 확보와 다르며, 과거 시점 재현은 ALFRED 등 vintage가 검증된 경우에만 '당시 알려진 값'이라고 부른다.

개발 순서: 필수 6개 수집/계산 → 나머지 8개 → 전체 14개 화면 → 시나리오 검증. 수동 항목은 템플릿과 입력 대기 카드까지가 자동 구현 범위이며 사용자가 데이터를 넣기 전 차트는 비어 있게 둔다. 유료 데이터는 요청하지 않는다.

수동 CSV 공통 열: indicator_id, entity, observation_date, published_at, metric, value, unit, basis, source_url. BDC non-accrual은 원가·공정가치 비율을 별도 metric으로, PIK는 금액/분모/비율 정의를 함께 저장한다. 서로 다른 기간의 분기치·누적치를 혼합하지 않는다.

BDC NAV는 **분기말이 아니라 실제 공개된 시점부터** forward-fill한다. 종가와 연결할 때 장 마감 후 발표면 다음 거래일에 적용한다. 주가·NAV의 주식분할 기준을 맞춘다. P/NAV에는 배당 재투자 수정주가를 쓰지 않는다. ETF 수익률·낙폭은 분배금·분할 조정 여부를 명시하고 배당락만으로 급락 경보가 뜨지 않도록 별도 검증한다. BIZD는 가격 보조선으로만 쓰고 개별 BDC P/NAV 대체로 사용하지 않는다.

## 5. 신호 계산 초안

- 날짜 정렬: CP 차감은 양쪽이 모두 유효한 같은 날짜에서만 계산. 각 구성 계열을 따로 forward-fill하여 차감하지 않는다.
- 일간·주간의 1/4/13주 변화: 마지막 유효 관측일에서 7/28/91일 전을 목표로, 해당 날짜 이전 최근 관측을 사용한다. 허용 간격은 설정으로 두고 실제 비교일을 출력한다. 먼 과거 값을 억지로 연결하지 않는다.
- 월간·분기: 1/4/13주 전 당시 발표된 값과 비교 가능한 경우에만 '알려진 값의 변화'로 표기. 새 발표가 없으면 '신규 발표 없음(유지)' 표시. 전월/전분기 변화도 제공. 발표일이 없으면 주간 비교는 계산 불가로 둔다.
- 단위: 스프레드 변화는 bp, SLOOS 변화는 %p, 잔액 변화는 달러 및 %, P/NAV는 배 및 배 차이. 1%p=100bp.
- C&I: 전년비와 13주 연율화 ((현재/91일 전)^(365.25/실제 경과일수)-1)×100. 분모 0·음수·비교 자료 부족은 결측.
- 백분위: 기준일 이전 최대 10년 실제 관측치만 사용. P=100×(작은 값 개수+동률 개수/2)/N. forward-fill 복제값으로 표본을 부풀리지 않는다. 원값 백분위와 스트레스 방향 백분위를 분리한다. 추세가 있는 잔액의 위험 판정은 수준 백분위보다 증가율 백분위 사용.
- 10년 미확보 시 10년 값은 결측. 별도의 '확보 기간 백분위'에 시작일/종료일/N을 표시. 분기 자료 최소 20개, 월간 36개, 주간 104개, 일간 500개를 잠정 최소 표본으로 제안.
- higher/lower 방향은 일반 연산자로 처리. lower_is_weak_demand는 '수요 약화', rapid_growth/divergence는 '연결·집중 위험' 축으로 구분해 신용 경색으로 바로 합치지 않는다. both는 증가/감소 신호를 각각 계산해 CP와 결합.
- 자료 경과일과 수집 경과일을 따로 출력한다. 잠정 stale 기준은 일간 7일, 주간 21일, 월간 75일, 분기 150일(마지막 발표 기준)이며 데이터별 조정 가능. 예측 발표일을 아는 경우 예정일+유예기간 방식으로 대체.

아래 숫자는 공식 기준이나 검증된 투자 판단 기준이 아닌, 사용자 검토용 시작값이다. 현재 시장 판정에는 아직 적용하지 않았다.

| 조건 이름 | 잠정 실행 규칙 |
|---|---|
| SLOOS 강화/완화/중립 | 최신 순응답 ≥+10% 또는 전분기 +10%p 이상 강화 / 최신 ≤−10% 또는 전분기 −10%p 이하 완화 / 최신 절댓값 <10%이고 전분기 변화 절댓값 <5%p. 강화·완화가 동시에 맞는 경우 수준과 방향 상충으로 처리. |
| 수요 감소 | 최신 ≤−10% 또는 전분기 −10%p 이하 |
| C&I 증가/둔화 | 13주 연율화 ≥+2% / ≤0%. 그 사이 중간. '비상 급증'은 4주 +3% 이상과 증가 속도 백분위 ≥90을 모두 충족. |
| 스프레드 확대 | 4주 변화가 HY +75bp, CCC +150bp, IG +20bp 이상. CP 급등은 +50bp 이상 또는 수준 ≥100bp이고 4주 +25bp 이상. |
| 스프레드 안정 | 수준 백분위 ≤75이고 4주 변화 절댓값이 HY 25bp, CCC 50bp, IG 10bp, CP 10bp 이내. '확대 아님'을 '안정'으로 바꾸지 않는다. |
| 스프레드 축소 | 4주 변화가 위 안정 폭의 음수 이하이고 수준 백분위 ≤75. 높은 수준에서 소폭 감소한 경우 '여전히 높음' 표시. |
| 발행 활발/감소/급감 | IG/HY 각각 최근 3개월 합의 전년 동기비 ≥0% / ≤−10% / ≤−30%. 미완료 월 제외. IG 증가가 HY 폐쇄를 덮지 않도록 각각 평가. |
| CP 잔액 급감 | 4주 −5% 이하 |
| BDC 안정/할인 작음 | 기업별 P/NAV ≥0.9, 4주 배 차이 ≥−0.03. 최소 2/3개 충족을 묶음 조건으로 사용. |
| BDC 할인 확대/급락 | 4주 P/NAV 배 차이 ≤−0.05 / 분할·분배금 영향을 검토한 4주 수익률 ≤−15%. 최소 2/3개 충족. NAV 갱신으로만 생긴 변화는 가격 원인과 나눠 설명. |
| 부실·PIK 증가 | 비교 가능한 동일 분모 기준에서 non-accrual 전분기 +1%p, PIK +2%p 이상. 최소 2개사 근거가 없으면 업계 전체 판단을 보류. |
| 은행 규모 간 괴리 | 소형 예금 4주 ≤−3%, 대형 대비 성장률 차이 ≤−3%p, 소형 대출 13주 증가율 ≤0%의 조합. 원인 확정 대신 괴리 경보. |
| NDFI 급증 | 13주 연율화 ≥15%이며 성장률 백분위 ≥90. 분류 변경 관측은 구조 변화로 별도 표시. |

## 6. 시나리오 규칙과 적합도

각 조건은 true/false/unknown 및 실제 수치·비교일·이유를 돌려준다. 실행 규칙은 위 조건을 조합하며 이름·지표·조건·가중치 모두 JSON에 둔다. 아래 각 묶음을 기본 동일 가중치로 시작하고 필수 근거는 별도 지정한다.

| 시나리오 | 조건 묶음 초안 | 후보 선정에 반드시 필요한 근거 |
|---|---|---|
| A 건강한 확장 | SLOOS 완화, C&I 증가, IG/HY 안정·축소, IG/HY 발행 활발, BDC 할인 작음 | SLOOS·C&I·IG/HY·발행량·BDC |
| B 경로 이동 | SLOOS 강화, C&I 둔화, IG/HY 안정, 발행 활발, BDC 안정 | 은행 공급 축소와 실제 시장 발행량 확인 |
| C 수요 둔화 | SLOOS 중립, 수요 감소, C&I 둔화, IG/HY 안정, 발행 감소, BDC 안정 | 대출수요·대출기준·C&I·발행량 |
| D 숨은 스트레스 | 은행 기준 중립·C&I 급변 없음, HY 안정, CCC 확대, BDC 할인 확대, PIK 증가 | HY/CCC 괴리와 BDC 가격; PIK 없으면 '가격 경보·실물 확인 대기' |
| E 단기 자금 경색 | CP 급등, CP 잔액 급감, C&I 비상 급증; BDC 약화는 보조 | CP 가격·수량·C&I 3개. SOFR 등은 현재 14개 밖의 별도 보조 근거로 명시 |
| F 전면 긴축 | SLOOS 강화, C&I 둔화, IG/HY 동반 확대, 발행 급감, BDC 급락, 부실 증가 | 은행·공개시장·BDC 3경로 모두 관측. 부실 자료 없으면 '전면 가격 스트레스·부실 확인 대기' |

매칭 점수 = 100 × 충족 조건 가중치 / 평가 가능한 조건 가중치. 자료 충족률 = 평가 가능한 가중치 / 전체 가중치. 둘을 항상 함께 출력하며 '발생 확률'로 표현하지 않는다. 결측·기준일 불명·기한 초과는 unknown으로 처리한다. 후보 순위 참고값은 매칭 점수×자료 충족률이며 필수 조건이 충족되어야 대표 후보가 될 수 있다.

최소 자료 충족률 70%, 매칭 점수 70점을 잠정 후보 문턱으로 제안한다. 문턱 미달·필수 근거 결측이면 단일 결론 대신 '판단 보류'. 복수 후보가 가능하면 함께 표시하고 순위 참고값 차이 10점 이내는 '혼합'. A~F는 심각도 순서가 아니며 하나가 맞으면 나머지를 끄지 않는다. 각 시나리오에 일치·반대·부족 근거를 전부 보여준다.

필수 6개만으로 모든 시나리오를 확정할 수는 없다. C에는 수요, A/B/C/F에는 발행량, E에는 CP 잔액이 특히 중요하다. 6개 우선 구현은 개발 순서이며 근거 없는 확정 판정을 허용한다는 뜻이 아니다. 규칙 요약부터 구현하며 LLM 호출은 이번 범위에 추가하지 않는다. 향후 해설을 붙여도 검증된 신호·기준일·결측만 입력으로 사용한다.

## 7. 구현 후 검증 범위

1. 모든 FRED 메타데이터와 샘플 관측치의 존재·단위·주기·계절조정·시작일·최신일 확인. 결과를 표와 설정 검증 상태로 저장.
2. CP 공통 날짜, 휴장·결측, 월/분기 신규 발표 없음, 발표 이전 NAV 누출, 분할·분배금, H.8 개정 저장, 10년 미확보 백분위 검사.
3. C&I 급증+CP 경색을 A의 건강한 증가로 판정하지 않는 사례, 데이터 부족으로 B/C/D가 과대 확정되지 않는 사례, 상충 시나리오 점수 검사.
4. 확보 가능한 자료로 2020·2023 등 사례 재생. 개정된 현재 시계열을 사용했다면 '사후 재현'으로 명시하고 당시 알려진 정보 기반 검증과 구분.
5. A안에서 14개 카드가 전부 표시되는지, 독립 기준일·단위·실제 분석 기간·오류 상태, 모바일/다크 테마, 기존 A안 유지 확인. TypeScript 검사와 관련 테스트 수행.

## 8. 확인할 제안

- A안 아래 모든 카드를 먼저 표시하는 구성.
- BUSLOANS→TOTCI 변경과 NDFI/대형·소형 후보 계열 채택.
- 10년 자료 미확보 항목은 10년 백분위를 비워두고 확보 기간 백분위를 별도로 제공.
- 수동 지표는 CSV 템플릿 및 입력 대기 표시, 시나리오는 필요한 근거가 들어올 때까지만 잠정 평가.

사용자의 '먼저 계획만 제시하고 확인 뒤 구현' 요청에 따라 여기서 구현은 대기한다. 인증 API 검증을 완료하려면 서버 환경의 FRED_API_KEY 설정이 필요하다.
