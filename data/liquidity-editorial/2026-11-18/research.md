# 2026-11-18 외부 조사

조사일 2026-11-20. 사건 마감11/18, 발표일과사건일을구분했다. 전주배포나자동실행을사용자문안승인으로취급하지않았다.

## 질문과 확인 범위

1. **TGA는 왜 발행 증가에도 줄었나?** DTS현금수지 직접조회: 국채현금순조달771.85억보다 그외순지출970.10억이커198.25억감소. 11/16국채이자873.60억이집중. 새로운월초지출을자동이월하지않고실제지급항목을확인했다. H4.1과.01억차이는백만달러단위반올림.
2. **회복은 신규 통화완화인가?** 새NYFed계획도RMP0,재투자140억계획. 최근4주반전은제거주−686.49억의영향이크고6개월수준은낮음. 전체RRP감소는외국공식계정이주요부분으로국내MMF자금방출과구분했다.
3. **왜 준비금 증가에도 SOFR가 다시 올랐나?** 11/16중장기채결제와국채이자지급이겹쳤음을확인. 11월초MMF유입을다룬FHLBNY11/13보고서와ICI새자료(이번주자산소폭감소)를대조. 공급·지급·일중배분의기여율은확정못했으므로단일원인으로쓰지않음.
4. **HY까지 넓어진 신용 프리미엄의 배경은?** 11/18공개의사록과Reuters보도에서추가인상예상과복잡한AI차입구조우려확인. 의사록분석기간은10월이고공개는주간마지막날이라이번주전체원인으로단정하지않았다. 개별지수발행사기여율은미확인.
5. **BDC와 대출 ETF는 왜 달라지나?** 같은3분기NAV분모와주가변화대조. 연준11/13금융안정보고서는10/28까지정보로일부비상장차주의낮은상환여력과높은PIK사용을논의했다. 구조적맥락으로만쓰고새부실공시나주간매도원인으로확정안함.
6. **새 H.8은 무변화인가?** 현재API는11/11조회에도11/4장부를소급포함. 전주동결10/28과대조해야새관측이보임. 공식11/13발표와일치하는시차.
7. **빈 생키는 수요붕괴인가?** 직접API의유효0건과날짜행누락을확인. 재무부의11/16결제계획및DTS발행과구분했다. 원자료가없는배분비중을가공하지않음.
8. **새 산업생산의 하락은 전면적 악화인가?** G17에서제조업증가와유틸리티하락이갈림을확인. 과거지수수정도있어동결9월과새10월만나눈−.53%는본문에미사용.

## 검색 질문

- November 18 2026 high yield CCC credit spreads funding repo
- November 16 2026 Treasury interest payments 87 billion TGA repo
- site.federalreserve.gov November 18 2026 minutes / November 2026 financial stability private credit
- site.fhlbny.com November 13 2026 market
- site.ici.org November 18 2026 Money Market
- November 18 2026 BDC ARCC OBDC FSK private credit shares
- site.federalreserve.gov/releases/g17/20261117 October production

검색 뒤 공식 본문·PDF를 열고 API는 직접 조회했다. 다른 대시보드의 자체 경계값을 위험 판정 규칙으로 가져오지 않았다.

## 出처·공개일·사건일

### dts: DTS 일일 현금 수지

- URL: https://fiscaldata.treasury.gov/datasets/daily-treasury-statement/
- 공개일: 정확한 시각 미확인 / 사건·대상일: 2026-11-12~18 / 열람: 2026-11-20
- 확인범위: 11/12~18 현금 국채 순조달771.85억, 그 외 순지출970.10억. 차액으로 TGA198.25억 감소. 11/16 국채이자873.60억 지급. 원자료 JSON 별도 보존.

### h41: 11월19일 H.4.1

- URL: https://www.federalreserve.gov/releases/h41/Current/
- 공개일: 2026-11-19 / 사건·대상일: 2026-11-18 / 열람: 2026-11-20
- 확인범위: 11/18 수요일 지준3,001,790백만, 할인창구9,055백만. 전체 역레포 감소는 주로 해외 공식기관 계정. 주평균과 구분.

### rmp: NYFed 새 국채매입 운영 계획

- URL: https://www.newyorkfed.org/markets/domestic-market-operations/monetary-policy-implementation/treasury-securities/treasury-securities-operational-details
- 공개일: 2026-11-13 / 사건·대상일: 2026-11-16~2026-12-11 / 열람: 2026-11-20
- 확인범위: 11/16~12/11 재투자140억 계획, 추가 RMP0. 국채 재투자와 신규 준비금 관리 매입을 구분.

### refunding: 11월 분기 차환 발행 계획

- URL: https://home.treasury.gov/news/press-releases/sb0678
- 공개일: 2026-11-04 / 사건·대상일: 2026-11-09~16 / 열람: 2026-11-20
- 확인범위: 3·10·30년물 합계1250억, 민간 만기970억 차환 뒤 신규현금280억 계획. 11/16 결제. 통상 단기채·CMB로 계절 수요를 조절. 월말 TGA 전망은 계획이며 현재 실적과 구분.

### minutes: 10월 FOMC 의사록

- URL: https://www.federalreserve.gov/monetarypolicy/fomcminutes20261028.htm
- 공개일: 2026-11-18 / 사건·대상일: 2026-10-27~28 / 열람: 2026-11-20
- 확인범위: 11/18 공개. 10월 회의 참가자 대다수 추가인상 필요성을 예상. 당시 자금시장과 충분한 준비금 평가를 이번 주 관측으로 오인하지 않음.

### funding: FHLBNY 주간 자금시장 보고

- URL: https://www.fhlbny.com/w/fi/msd/2026/261113
- 공개일: 2026-11-13 / 사건·대상일: 2026-11-05~12 / 열람: 2026-11-20
- 확인범위: 10월 단기채 공급·MMF 만기 단축 배경 및 11월 초 MMF 유입과 단기 조달 압력 완화 가능성. 11/16 이후 결과를 보고한 자료가 아님.

### mmf: ICI 주간 MMF 자산

- URL: https://www.ici.org/research/stats/mmf
- 공개일: 2026-11-19 / 사건·대상일: 2026-11-18 / 열람: 2026-11-20
- 확인범위: 11/18 주간 총자산7.97644조, 전주대비35.8억 감소. 11월초의 대규모 유입을 이번주 원인으로 자동 이월하지 않음. 자산 증감을 순수 유출입으로 동일시하지 않음.

### h8: 11월13일 H.8

- URL: https://www.federalreserve.gov/releases/h8/Current/
- 공개일: 2026-11-13 / 사건·대상일: 2026-11-04 / 열람: 2026-11-20
- 확인범위: 최신11/4 관측을 전주 동결본10/28과 비교. 현재 API의 과거 주차 재조회는 같은11/4 자료를 소급 포함하므로0차이를 무변화로 해석하지 않음.

### fsr: 연준 11월 금융안정보고서

- URL: https://www.federalreserve.gov/publications/files/financial-stability-report-20261113.pdf
- 공개일: 2026-11-13 / 사건·대상일: 2026-10-28 이전 / 열람: 2026-11-20
- 확인범위: 10/28까지 정보가 주된 분석 기준. 일부 비상장 차주의 낮은 이자상환 여력과 높은 PIK 사용을 취약점으로 다룸. BDC3사 새 부실 공시 또는 이번주 하락 원인의 직접 증거는 아님.

### reuters-minutes: Reuters: 의사록과 금융안정 우려

- URL: https://www.investing.com/news/economy-news/fed-policymakers-concerned-about-financial-system-risks-minutes-show-5036972
- 공개일: 2026-11-18 / 사건·대상일: 2026-11-18 / 열람: 2026-11-20
- 확인범위: 11/18 의사록 공개와 AI 투자·차입 연결 우려를 보도. 같은 날 및 주간 BDC·CCC 가격 변동에 대한 정량 기여도는 확인하지 못함.

### auction-api: 입찰 원자료 API 직접 조회

- URL: https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query
- 공개일: 정확한 시각 미확인 / 사건·대상일: 2026-10-22~2026-11-18 / 열람: 2026-11-20
- 확인범위: 10/22~11/18 단1행,10/22 낙찰필드null. 유효 합산0건. 제외1건이 전체 누락 건수라는 뜻은 아님.

### g17: 10월 산업생산 발표

- URL: https://www.federalreserve.gov/releases/g17/20261117/default.htm
- 공개일: 2026-11-17 / 사건·대상일: 2026-10 / 열람: 2026-11-20
- 확인범위: 10월 총생산−0.4%, 제조업+.3%, 유틸리티−4.3%. 이전 동결9월 지수와 직접 비교한−.53%는 수정된9월과 섞은 계산이라 본문에 사용하지 않음.

### sloos: 10월 SLOOS

- URL: https://www.federalreserve.gov/data/sloos/sloos-202610.htm
- 공개일: 2026-11-02 / 사건·대상일: 2026-07~09; 응답 마감 10/05 / 열람: 2026-11-13
- 확인범위: 기업 대출 수요 약화, 투자 감소와 자금 조달처 이동을 응답 이유로 제시. 비은행 대출 수요·심사는 다른 방향.
- 재사용: 2026-11-11 revision-002; 이번 주 재열람을 주장하지 않는 기준 자료

### nfci: Chicago Fed NFCI 및 수정 설명

- URL: https://www.chicagofed.org/research/data/nfci/current-data
- 공개일: 정확한 시각 미확인 / 사건·대상일: 2026-10-30 / 열람: 2026-11-13
- 확인범위: 월초에는 월간·분기 자료 반영으로 과거 수정이 커질 수 있음. 이번 전주치 수정과 실제 새 주간 변화 구별.
- 재사용: 2026-11-11 revision-002; 이번 주 재열람을 주장하지 않는 기준 자료

### sifma: SIFMA 전체 회사채 발행 통계

- URL: https://www.sifma.org/wp-content/uploads/2021/02/US-Fixed-Income-Securities-Statistics-SIFMA.xlsx
- 공개일: 정확한 시각 미확인 / 사건·대상일: 2026-10 / 열람: 2026-11-13
- 확인범위: 수집본10월139.83131B, 수정9월275.19656B. 같은달·연속3개월 비교로 단월 과장 방지.
- 재사용: 2026-11-11 revision-002; 이번 주 재열람을 주장하지 않는 기준 자료

### obdc: OBDC 3분기 실적

- URL: https://www.blueowlcapitalcorporation.com/investors/news-events/press-releases/detail/96/blue-owl-capital-corporation-announces-september-30-2026
- 공개일: 2026-11-04 / 사건·대상일: 2026-09-30 / 열람: 2026-11-13
- 확인범위: NAV14.32, 부실원가2.9%, PIK와 총투자수익 분기 실적.
- 재사용: 2026-11-11 revision-002; 이번 주 재열람을 주장하지 않는 기준 자료

### fsk: FSK 3분기 실적

- URL: https://fskkrcapitalcorp.gcs-web.com/static-files/55182db1-2f95-4947-a184-dfe6e163bf73
- 공개일: 2026-11-05 / 사건·대상일: 2026-09-30 / 열람: 2026-11-13
- 확인범위: 11/5 공개: 부실 원가6.4%, NAV18.28, PIK46/294. 11/4 주가 반응 원인으로 사용하지 않음.
- 재사용: 2026-11-11 revision-002; 이번 주 재열람을 주장하지 않는 기준 자료

### arcc-10q: ARCC 3분기 10-Q

- URL: https://www.sec.gov/Archives/edgar/data/1287750/000162828026067383/arcc-20260930.htm
- 공개일: 2026-10-27 / 사건·대상일: 2026-09-30 / 열람: 2026-11-13
- 확인범위: 분기 PIK 이자·배당125백만/투자수익763백만=16.38%. 부실 대출 비율과 다른 분모.
- 재사용: 2026-11-11 revision-002; 이번 주 재열람을 주장하지 않는 기준 자료

## 남은 확인 사항

- 입찰API:전체누락복구가안되어배분판단을보류. 토요일재조회예정. 수집성공을표본완비로취급하지않는다.
- 시장원인:일중레포배분과ICE발행사별기여,BDC개별매도동기는정량확인못함. 구조적위험과동행을사실인원인으로승격하지않는다.
- H8및산업생산과거수정,ETF과거수정가격은comparison.json에별도보존.
