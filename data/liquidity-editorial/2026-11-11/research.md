# 2026-11-11 외부 조사

조사일2026-11-13. 사건일은주차마감11/11까지; 이후공개H4.1은11/11장부확인용. 초안을인간피드백으로학습하지않는다.

## 조사 질문과 결과

1. TGA감소가발행축소때문인가? DTS직접조회와수지검산. 발행은여전히현금순조달287억을만들었지만기타순지출528억이더커TGA241억감소. 지난주월초지급집중에비해규모축소. 이번주모든지출을특정프로그램·캘린더하나의결과로단정하지않음.
2. 13주합계반전은정책변화인가? 제거주8/5~12−574억을확인. RMP운영계획에서는추가매입중단유지; 재투자는계속되는별도항목. 11/11UST보유증가를RMP재개로부르지않음.
3. SOFR하락원인은? 검색'November 6 2026 SOFR fell repo funding pressures November 10 2026',NYFed페이지및FHLBNY11/6검토. FHLBNY가11/5시점월말압력완화징후를보고.11/6이후실제음수는입력확인. TGA방출·월경계완화는합치되는배경이나각기여율은미확인. NYFedAPI웹도구직접접근오류로공식페이지와고정수집본대조; RMP재개주장은근거없음.
4. 회사채세등급상승이신용악화인가? BLS11/10CPI+.4%,core+.3%; Kiplinger당일국채10년+12.6bp확인. IG/HYOAS감소와CCC+33bp를분리. 잔차(금리변화−OAS변화)는국채몫근사이며특정국채만기와정확히동일하지않음.
5. CCC악화가시장전체붕괴인가? Vanguard11/10은BloombergCCC일부통신·미디어발행사집중을제시. 우리ICE와등급구성·수치를혼합하지않고분산차별화의외부맥락만사용. 저신용대출이사모대출/레버리지론으로이동했다는구조적설명도검토했으나이번주ETF·BDC반등을곧바로안전신호또는지연붕괴로단정안함.
6. BDC반등은실적효과인가? ARCC10/27,OBDC11/4,FSK11/5발표일과NAV대조. 같은3Q분모에서주가회복. 실적발표후인시간관계만확인했으며원인기여미확인.
7. 입찰자료가정말미발표인가? FiscalData직접7행확인;10/29공식결과공개증거는이미보존.11/10추정PDF주소는접근실패라출처로인용하지않음. API표본부족을공식미발표또는수요붕괴로쓰지않음.
8. 결측은시장신호인가? SIFMA11/11휴일일정확인. CP30일관측이없는11/11은휴일이고나머지4영업일은있음. 오래된90일물과분리.

## 출처·공개일·사건일

### dts: DTS 재무부 현금 보고서

- URL: https://fiscaldata.treasury.gov/datasets/daily-treasury-statement/
- 공개일: 정확한시각미확인 / 사건·대상일: 2026-11-05~10 / 열람: 2026-11-13
- 확인범위: 11/5~10 국채 현금 순조달287.20억, 기타 순지출528.34억, TGA−241.14억. 직접 조회 JSON 보존.

### h41: 연준 H.4.1

- URL: https://www.federalreserve.gov/releases/h41/current/
- 공개일: 2026-11-12 / 사건·대상일: 2026-11-11 / 열람: 2026-11-13
- 확인범위: 11/11 수요일 지급준비금2,969,977백만, 할인창구9,268백만, repo5백만. 주평균과 구분.

### refunding: 11월 분기 발행 계획

- URL: https://home.treasury.gov/news/press-releases/sb0678
- 공개일: 2026-11-04 / 사건·대상일: 2026-11-04 / 열람: 2026-11-13
- 확인범위: 정례 중장기채 규모 유지, 계절 자금 수요는 단기채로 조절. 11월 말 TGA 고점 전망과 연말 목표는 미래 계획.

### fomc: 10월 FOMC 성명

- URL: https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm
- 공개일: 2026-10-28 / 사건·대상일: 2026-10-28 / 열람: 2026-11-13
- 확인범위: 3.75~4.00% 동결. 2명은 인상을 선호.

### implementation: 10월 FOMC 시행문

- URL: https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a1.htm
- 공개일: 2026-10-28 / 사건·대상일: 2026-10-29 / 열람: 2026-11-13
- 확인범위: IORB 3.90% 유지, 만기 국채 차환·기관채 원금 국채 재투자 유지.

### rmp: NYFed 국채 매입 일정

- URL: https://www.newyorkfed.org/markets/domestic-market-operations/monetary-policy-implementation/treasury-securities/treasury-securities-operational-details
- 공개일: 2026-10-14 / 사건·대상일: 2026-10-15~2026-11-13 / 열람: 2026-11-13
- 확인범위: 10/15~11/13 추가 RMP0, 재투자146억 계획. 미래 집행 완료로 해석하지 않음.

### sloos: 10월 SLOOS

- URL: https://www.federalreserve.gov/data/sloos/sloos-202610.htm
- 공개일: 2026-11-02 / 사건·대상일: 2026-07~09; 응답 마감 10/05 / 열람: 2026-11-13
- 확인범위: 기업 대출 수요 약화, 투자 감소와 자금 조달처 이동을 응답 이유로 제시. 비은행 대출 수요·심사는 다른 방향.

### nfci: Chicago Fed NFCI 및 수정 설명

- URL: https://www.chicagofed.org/research/data/nfci/current-data
- 공개일: 정확한시각미확인 / 사건·대상일: 2026-10-30 / 열람: 2026-11-13
- 확인범위: 월초에는 월간·분기 자료 반영으로 과거 수정이 커질 수 있음. 이번 전주치 수정과 실제 새 주간 변화 구별.

### sifma: SIFMA 전체 회사채 발행 통계

- URL: https://www.sifma.org/wp-content/uploads/2021/02/US-Fixed-Income-Securities-Statistics-SIFMA.xlsx
- 공개일: 정확한시각미확인 / 사건·대상일: 2026-10 / 열람: 2026-11-13
- 확인범위: 수집본10월139.83131B, 수정9월275.19656B. 같은달·연속3개월 비교로 단월 과장 방지.

### obdc: OBDC 3분기 실적

- URL: https://www.blueowlcapitalcorporation.com/investors/news-events/press-releases/detail/96/blue-owl-capital-corporation-announces-september-30-2026
- 공개일: 2026-11-04 / 사건·대상일: 2026-09-30 / 열람: 2026-11-13
- 확인범위: NAV14.32, 부실원가2.9%, PIK와 총투자수익 분기 실적.

### fsk: FSK 3분기 실적

- URL: https://fskkrcapitalcorp.gcs-web.com/static-files/55182db1-2f95-4947-a184-dfe6e163bf73
- 공개일: 2026-11-05 / 사건·대상일: 2026-09-30 / 열람: 2026-11-13
- 확인범위: 11/5 공개: 부실 원가6.4%, NAV18.28, PIK46/294. 11/4 주가 반응 원인으로 사용하지 않음.

### arcc-10q: ARCC 3분기 10-Q

- URL: https://www.sec.gov/Archives/edgar/data/1287750/000162828026067383/arcc-20260930.htm
- 공개일: 2026-10-27 / 사건·대상일: 2026-09-30 / 열람: 2026-11-13
- 확인범위: 분기 PIK 이자·배당125백만/투자수익763백만=16.38%. 부실 대출 비율과 다른 분모.

### funding: FHLBNY 11월6일 보고서

- URL: https://www.fhlbny.com/w/fi/msd/2026/261106
- 공개일: 2026-11-06 / 사건·대상일: 2026-11-05 / 열람: 2026-11-13
- 확인범위: 11/5 작성 시점에 월말 압박 완화 징후. 국채 공급·RMP 중단 등 배경, 향후 상승 가능성은 전망이지 실제 결과가 아님.

### holiday: SIFMA 2026 휴장 일정

- URL: https://www.sifma.org/resources/general/holiday-schedule/
- 공개일: 정확한시각미확인 / 사건·대상일: 2026-11-11 / 열람: 2026-11-13
- 확인범위: 11/11 Veterans Day 채권시장 휴장 권고. SOFR·CP·단기국채 최신 관측은11/10.

### h8: H.8 11월6일 발표

- URL: https://www.federalreserve.gov/releases/h8/20261106/
- 공개일: 2026-11-06 / 사건·대상일: 2026-10-28 / 열람: 2026-11-13
- 확인범위: 10/28 신규 장부: 기업대출 소폭 증가, 비은행 대출 감소. 두 계열 장기 증가 유지.

### cpi: 10월 CPI 발표

- URL: https://www.bls.gov/news.release/cpi.nr0.htm
- 공개일: 2026-11-10 / 사건·대상일: 2026-10 / 열람: 2026-11-13
- 확인범위: 10월 전월비 headline+.4%, core+.3%. 2025/10 결측으로 전년비를 임의 계산하지 않음.

### rates-news: 11월10일 인플레이션 발표와 채권 반응

- URL: https://www.kiplinger.com/investing/stocks/stocks-drop-as-rate-hike-worries-rise-stock-market-today
- 공개일: 2026-11-10 / 사건·대상일: 2026-11-10 / 열람: 2026-11-13
- 확인범위: 물가 발표 후 10년 국채금리12.6bp 상승 보도. 주간 등급별 신용 차이 전체의 원인으로 확대하지 않음.

### vanguard: Vanguard CCC 스트레스 분석

- URL: https://corporate.vanguard.com/content/corporatesite/us/en/corp/articles/beyond-ccc-high-yield-appears-resilient.html
- 공개일: 2026-11-10 / 사건·대상일: 2026-11-10 / 열람: 2026-11-13
- 확인범위: Bloomberg 기준 일부 통신·미디어 차주에 집중. 저신용 대출의 사모대출·레버리지론 이동을 장기 맥락으로 제시. ICE 수치와 혼합 금지.

### auction-api: 입찰 API 직접 확인

- URL: https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query
- 공개일: 2026-11-13 / 사건·대상일: 2026-10-15~11-11 / 열람: 2026-11-13
- 확인범위: 4주7행 중 유효2행, 낙찰값결측5행. 유효 최신10/15, 행 최신10/22. 그 후 입찰 행도 부재.

### auction-pdf: 재무부 10월29일 7년물 입찰 결과

- URL: https://www.treasurydirect.gov/instit/annceresult/press/preanre/2026/R_20261029_3.pdf
- 공개일: 2026-10-29 / 사건·대상일: 2026-10-29 / 열람: 2026-11-06
- 확인범위: 개별 결과는 발표됐음. API 미반영과 공식 미발표를 구분.

## 한계와 채택하지 않은 주장

SOFR하락의원인별기여도,CCC지수업종별이번주기여도,BDC반등동기는확정하지못했다. Vanguard의BloombergCCC약1000bp를ICE1330bp에덮어쓰지않았다. 2025/10CPI가없어전년비를만들지않았다. FHLBNY의향후RMP재개예상을이미실현된정책으로쓰지않았다. 입찰데이터누락은다음재확인대상으로남긴다.
