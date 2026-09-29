# 미국 민간 신용 모니터

A안 `/#/liquidity`의 마지막 영역에 은행·비은행 카드를 하나씩 두고 이름 버튼·좌우 화살표로 5개·9개 지표를 전환한다. 14개 지표 모두 실제 자료를 표시하되 회사채 발행량은 전체만 자동 수집하며 IG·HY 세부 값은 입력 대기다. 시나리오 A~F는 규칙 기반이며 LLM 호출을 사용하지 않는다.

## 설정

`shared/credit/credit_indicators.json`이 지표·소스·티커·계열·임계값·시나리오의 단일 설정 원본이다. 신호의 숫자는 공식 판정 기준이 아닌 초기 실험값이다. `signals`에서 조정하고 `scenarios.rules`에서 가중치와 필수 여부를 바꾼다. 코드에서 개별 지표 목록을 별도로 관리하지 않는다.

- `BUSLOANS`는 월간이라 주간 기업대출에는 `TOTCI`를 사용한다.
- NDFI는 사모대출 펀드만이 아닌 비은행 금융회사 전체 대출이다.
- 대형/소형 은행 비교는 예금과 전체 대출·리스의 네 계열이다.
- CP 가격은 A2/P2 비금융이고 CP 잔액은 전체 시장이다.
- 대출 ETF는 CLO 스프레드 자체를 측정하지 않는다.

## 실행

```powershell
npm run credit:verify
npm run credit:init
npm run credit:collect
npm run credit:collect -- --dry-run
npm run credit:audit
npm run credit:import -- data/credit/manual/my-data.csv --check
npm run credit:import -- data/credit/manual/my-data.csv
```

`credit:init`는 신용 전용 테이블만 `CREATE TABLE IF NOT EXISTS`로 추가한다. 공유 DB 전체를 비교하는 drizzle-kit push를 사용하지 않는다. `credit:collect`는 기존 앱과 같은 DATABASE_URL에 저장한다. `--dry-run`은 DB를 읽거나 쓰지 않으며 공개 소스 연결을 점검한다. 부분 수집 실패 시 마지막 유효 자료를 남기고 종료코드 2로 끝난다.

FRED_API_KEY가 있으면 인증 API를 우선 사용한다. 없으면 **기존 유동성 페이지와 같은 공개 fredgraph.csv**를 사용한다. `.env`와 키 값은 출력·커밋하지 않는다. 인증 키가 없는 검증 보고서에는 인증 메타데이터 검증을 하지 못했다고 명시한다. 보고서는 `output/credit/series-verification.json`, 수집 결과는 `output/credit/collection-status.json`이다.

SEC는 EDGAR_UA 설정을 지원하며 공개 Company Facts의 검증된 주당 NAV 태그를 읽는다. ARCC·OBDC·FSK는 JSON에 회사 식별자와 태그를 보관한다. 부실·PIK는 10-Q/10-K iXBRL 및 실적발표 8-K에서 읽는다. 주가는 Yahoo의 일별 가격을 읽으며 당일 미완료 봉을 제외한다. 데이터 제공처의 결측·오류는 노출한다.

`.github/workflows/credit-monitor.yml`은 master 반영 후 UTC 화~토 01:20, **한국시간 화~토 10:20**에 수집하는 작업이다. 미국 월~금 장 마감 후이며 H.8 금요일 오후 발표도 포함한다. DATABASE_URL은 필수, FRED_API_KEY·EDGAR_UA는 선택 secret이다. 이 파일을 로컬에서 추가한 것만으로 원격 예약이 활성화되지는 않는다. 실행 성공·실패 시 수집 보고서를 Actions artifact로 30일 보관한다.

## 공개 엑셀·공시 수집

- SIFMA [공개 엑셀](https://www.sifma.org/wp-content/uploads/2021/02/US-Fixed-Income-Securities-Statistics-SIFMA.xlsx)의 Issuance 시트에서 Corporates 열을 읽는다. 대상·십억 달러 단위·시트·헤더·날짜·숫자를 검증한다. 연간·분기 합계는 제외한다. 제공 파일은 월별 13개월 창이므로 이후 창에서 빠진 월은 기존 DB에 보존하고 겹치는 월의 수정값은 갱신한다. 파일 갱신일을 과거 각 월의 최초 발표일로 추정하지 않는다.
- [IG/HY 다운로드](https://www.sifma.org/research/statistics/us-corporate-bonds-statistics)는 현재 HubSpot 양식으로 연결된다. 공개 전체 발행액을 등급별 값으로 대체하지 않는다. IG/HY 신호에는 원래 두 계열만 사용하며 전체는 참고 차트다. 전체에는 전환사채·MTN·Yankee 채권 등이 포함된다.
- ARCC non-accrual은 공시의 전체 포트폴리오 공정가치·원가 비율 태그를 읽는다. OBDC는 해당 분기의 공정가치와 원가가 모두 있는 전체 포트폴리오 표를 사용한다. 과거 원가만 있는 부채 포트폴리오 표는 분모가 달라 섞지 않는다. FSK는 동일 발표일 8-K의 실적발표에서 전체 포트폴리오의 두 비율을 추출한다. 직접 대출 일부만의 비율은 사용하지 않는다.
- PIK는 같은 분기의 총투자수익으로 나눈다. ARCC는 PIK 이자+배당, OBDC는 회사가 공시한 PIK 이자+배당 발생액, FSK는 별도 공시된 PIK 이자수익이다. 회사 간 범위가 달라 자체 추세 중심으로 해석한다. ARCC/FSK 누적 수익은 이전 누적을 차감한다. OBDC 연간 값은 확보된 해당 연도 1~3분기 원금액을 차감할 수 있을 때만 4분기로 변환한다. 분자·분모를 관측과 함께 저장한다.
- SEC 최근 공시 목록에서 최대 20개 정기보고서를 확인한다. 2026-09-29 최초 수집 기준 ARCC·FSK 부실 16분기, PIK 12분기, OBDC 부실 2분기, PIK 7분기를 검증했다. 누락 과거를 0으로 채우거나 보간하지 않는다. 이미 채운 과거 분기는 재다운로드를 건너뛰고 최신 분기 및 미확인 구간을 재검사한다. 최신 분기 추출 실패는 수집 실패로 보고하고 기존 자료를 보존한다.

## 갱신 주기 점검

| 대상 (14개 지표) | 원자료 발표 | 확인 방식 |
| --- | --- | --- |
| SLOOS 기준·수요 2개 | 분기, 통상 1~2·4~5·7~8·10~11월 | 예약 실행마다 FRED 확인 |
| H.8 C&I·비은행 금융회사·대형/소형 3개 | 주간, 미국 동부 금요일 16:15 (공휴일 조정) | 토요일 한국시간 실행에 포함 |
| HY·CCC·IG·CP 스프레드 4개 | 영업일 일간, CP는 통상 1영업일 발표 시차 | 예약 실행마다 확인 |
| CP 잔액 1개 | 수요일 마감 기준, 통상 다음 영업일 발표 | 금요일 한국시간 실행에 포함 |
| BDC P/NAV 1개 | 주가 일간 + NAV 분기 | 주가·공시 각각 확인 |
| 회사채 발행량 1개 | 월간 | 공개 엑셀 확인, IG/HY는 별도 입력 |
| BDC 부실·PIK 1개 | 분기 실적·정기 공시 | 공시 목록 확인 후 신규·미확인 보고서 추출 |
| 레버리지론 대용 ETF 1개 | 거래일 일간 | 수정 종가 확인 |

발표 주기 출처: [H.8](https://www.federalreserve.gov/releases/h8/), [SLOOS](https://www.federalreserve.gov/data/sloos.htm), [CP](https://www.federalreserve.gov/releases/cp/about.htm). 발표 당일 FRED 반영 시각과 GitHub Actions 실행 시각은 지연될 수 있다.

`credit:audit`는 저장된 14개 지표와 하위 계열의 관측일·공시일·마지막 확인일·미수집·지연을 `output/credit/refresh-audit.json`으로 출력한다. 수집 시에도 동일 보고서를 만든다. 화면은 **관측 경과와 수집 지연을 별도로 표시**한다. 일간 7일·주간 21일·월간 75일·분기 120일을 관측/공시 경과 허용치로 사용하며, 자동 소스가 3일 넘게 확인되지 않으면 수집 지연으로 분리한다. 값은 JSON settings에서 수정한다. 이는 공식 발표 마감이 아닌 보수적인 운영 경고 기준이다. 지연 자료는 시나리오 근거에서 제외한다.

## 수동 자료

`data/credit/manual/corporate-bond-issuance.template.csv`와 `bdc-credit-quality.template.csv`를 복사해 채운다. BDC 수동 입력은 공시 파서 미지원 구간의 보완용이며 자동 수집과 겹치는 값은 다음 수집 시 원문 검증값으로 갱신될 수 있다. 기존 DB 호환을 위해 BDC 원계열 키의 manual: 접두사는 유지하지만 실제 provider는 sec_credit다. 열은 source_key, observation_date, published_at, value, unit, basis, source_url이다. 값이 빈 템플릿 행은 건너뛰고 전부 비어 있으면 저장하지 않는다.

회사채는 월별 IG/HY의 총발행액을 십억 달러로 입력한다. BDC non-accrual은 공정가치/원가를 분리한다. PIK는 PIK 수익/총투자수익 비율(%)을 사용한다. 다른 분모의 공시 수치를 그대로 넣지 않는다. 출처 URL과 발표일이 필수이며 미래 발표일·중복·단위·분모 불일치를 거부한다. 미입력 자료를 0으로 표시하지 않는다.

## 시점과 해석

- 신용 모니터의 기준일은 현재 날짜이며 상단 연준 주 선택과 독립적이다.
- 일간·주간 변화는 최신 실제 관측에서 7/28/91일 전 이하의 관측과 비교하고 실제 날짜를 표시한다.
- 월간·분기는 알려진 발표일이 있어야 주간 비교를 계산한다. 없는 경우 주간 수치를 비워두고 직전 관측 대비 변화를 표시한다. SLOOS 공개 CSV만으로 발표일 이력을 추정하지 않는다.
- BDC NAV는 공시일 다음 날짜부터 적용한다. 분기말로 소급하지 않는다. 공시 시각을 모르므로 공시 당일 종가에도 적용하지 않는 보수적 방식이다.
- P/NAV는 당시 주식수 기준 종가를 사용하고, BDC 급락 신호와 ETF 변화는 분배금·분할 수정 가격으로 계산한다.
- ICE HY/CCC/IG는 실제 수집에서 약 3년만 확보됐다. 10년 백분위는 비워두며 확보 기간 백분위를 별도로 표시한다. 원값 백분위와 스트레스 방향을 동일시하지 않는다.
- 수집 실패·자료 지연·비교 관측 부족은 시나리오의 unknown이다. 필수 근거가 없으면 높은 부분 점수라도 대표 후보가 되지 않는다.
- 점수는 조건 적합도이며 발생 확률이 아니다. 일치·반대·부족 근거와 관측일을 함께 제공한다.
- BDC 안정은 동일한 두 회사 이상이 수준과 변화를 모두 만족해야 한다. CP 급등과 C&I 급증이 겹치면 건강한 확장 후보를 차단한다.

## 저장

전용 `credit_collection_runs`에 정규화된 전체 수집본을 불변 JSON으로 보관한다. `credit_observation_versions`는 바뀐 값의 수집 이력을 추가하고, `credit_analysis_snapshots`에 설정 해시와 시나리오 근거를 저장한다. 수집·수동 입력은 DB 잠금 안에서 합쳐 최신 자료가 과거 실행으로 덮이지 않도록 한다.

수집본 보존은 ALFRED의 당시 발표본 전체 확보와 다르다. UI 차트는 현재 확보한 개정 시계열이며, 역사적 예측 성능이나 당시 정보만을 사용한 백테스트라고 주장하지 않는다. 원천의 전체 HTTP 응답 대신 정규화된 관측과 출처·수집 경로를 보존한다.

API `GET /api/liquidity/credit`는 저장된 자료를 읽고 현재 설정으로 다시 계산한다. 페이지 요청으로 원천 자료를 수집하거나 DB에 쓰지 않는다. 로컬 파일이나 Vercel 메모리는 영구 저장소로 쓰지 않는다.

## 검증

`tests/credit-monitor.test.ts`는 CP 공통일·결측, 발표일 없는 분기 변화, NAV 공시 이전 누출, 가격 분할/분배금, 백분위 기간 부족, 시나리오 필수 근거·상충, 수동 CSV를 검증한다. 기존 유동성 테스트와 함께 실행한다.

```powershell
npm run check
npx vitest run tests/credit-monitor.test.ts tests/credit-sources.test.ts tests/liquidity-beta.test.ts tests/liquidity-read.test.ts
npm run build
```

화면 검증: 데스크톱/390px 모바일, 경로별 지표 전환, 차트 기간 전환, BDC 종목 선택, 실제 값/기준100 전환, 근거 펼치기, 다시 불러오기, IG/HY 미입력과 갱신 안내를 확인한다.
