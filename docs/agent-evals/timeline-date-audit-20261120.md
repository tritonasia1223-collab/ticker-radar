# 국제 연표: 독립 사건과 확정 시점 분리

사용자 요청: 연간·유럽 공동 블록에서 제목과 설명처럼 묶인 독립 사건들을 분리하고, 시점이 명확한 다른 사례도 정리한 뒤 배포한다.

## 범위와 판단

기본 데이터 265개(월 미지정·기간 포함 61개)를 점검했다. 28개 묶음을 수정하고 43개 독립 항목을 추가한다. 원래 있는 사건을 삭제하지 않는다. 같은 슬라이스·동일 참여국의 공동 사건은 한 블록에 담되, 각 사건에 제목과 개별 편집 메뉴를 둔다. 같은 연간 자료도 서로 종속되지 않는 항목은 같은 크기의 제목으로 표시한다.

예시인 1974년은 OPEC 흑자와 유로통화시장 규모를 연간 블록의 두 제목으로 표시한다. 유동성 지원 성명은 9월로 옮기고, 12월 바젤은행감독위원회 설립은 기존 대사건을 재사용한다.

검토 전 원문, 수정 필드, 추가 항목, 중복 방지 참조, 출처는 `client/src/data/international-timeline-date-audit.json`에 보존했다. 수치는 기존 사용자 조사본을 보존한 것이며 전체 통계의 신규 검증을 의미하지 않는다. 원문에 월이 명시된 항목은 그 월을 사용한다. 추가로 일자를 확정하거나 사건의 성격을 교정한 경우에는 다음 일차 자료를 사용했다.

| 검토 | 근거 |
|---|---|
| 1974.9 유동성 성명, 12월 바젤위원회 | [Fed 당시 연례보고](https://fraser.stlouisfed.org/title/prelude-annual-report-236/monetary-policy-us-economy-1974-5805/fulltext), [BIS 연혁](https://www.bis.org/about/history/timelines) |
| 1975.6.5 영국 EC 국민투표 | [영국 의회](https://commonslibrary.parliament.uk/research-briefings/cbp-7253/) |
| 미키 1974.12.9·오히라 1978.12.7 내각 | [일본 총리관저](https://japan.kantei.go.jp/past_cabinet/index.html) |
| 서독 1980.10.5 총선·11.5 총리 선출 구분 | [연방선거관리](https://www.bundeswahlleiterin.de/bundestagswahlen/1980.html), [연방의회 연혁](https://www.bundestag.de/resource/blob/418076/WD-1-060-12-pdf.pdf) |
| 401(k): 1978.11.6 법률과 1981.11.10 규칙안 구분 | [법률 원문](https://www.govinfo.gov/content/pkg/STATUTE-92/pdf/STATUTE-92-Pg2763.pdf), [의회 청문자료](https://www.govinfo.gov/content/pkg/CHRG-110shrg41835/pdf/CHRG-110shrg41835.pdf) |
| 1983.6.18 볼커 지명·8.6 임기 시작 | [Fed Bulletin 1983.8](https://fraser.stlouisfed.org/files/docs/publications/FRB/1980s/frb_081983.pdf) |
| 1982.1.16 프랑스 근로시간 명령 | [Legifrance](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000000889135) |
| 1984.9.8 멕시코 MYRA는 원칙 합의 | [IMF 역사](https://www.elibrary.imf.org/display/book/9781557759719/ch009.xml) |
| 1980.3.27 은 폭락 | [Kansas City Fed](https://www.kansascityfed.org/documents/6510/integrityfairnessandresolve.pdf) |
| 1980.4 G10 은행감독 논의 | [IMF 1980 보고](https://www.imf.org/external/pubs/ft/ar/archive/pdf/ar1980.pdf) |
| 1981.3 폴란드 요청·4월 공적 채권자 합의 | [IMF 역사](https://www.imf.org/external/pubs/ft/history/2001/ch08.pdf) |
| 1982.10.15 간–세인트저메인법 | [Fed History](https://www.federalreservehistory.org/essays/garn-st-germain-act) |
| 1985.12.12 그램–루드먼–홀링스법 | [미국 상원 역사](https://www.govinfo.gov/content/pkg/CDOC-109sdoc24/html/CDOC-109sdoc24.htm) |
| 1989.7.1 독일 이자 원천세 폐지 | [Bundesbank 1989 보고](https://www.bundesbank.de/resource/blob/702906/5272342f92283f5911fba5700532f9cd/472B63F073F071307366337C94F8C870/1989-annual-report-data.pdf) |

시점이 불명확한 시장 규모·부채·흐름은 연간에 남긴다. 이미 별도 사건이 있는 북해유전 생산 개시, 스미스소니언 협정, 바르데포트 강화, 플라자 합의, 단일유럽의정서 서명은 다시 생성하지 않는다. 제도의 시행 예정일이나 과거 대비 설명, EMS 설계처럼 이어지는 과정은 무조건 별도 사건으로 만들지 않는다.

## 저장 보호

브라우저별 저장 데이터를 이관 직전 `fiscus-international-timeline-before-date-audit-20261120`에 백업한다. 검토 원문과 제목·본문·날짜·기간·레인·범위가 다른 항목은 전체 변경과 하위 사건 추가를 건너뛴다. 사용자가 바꾼 라벨·type은 보존한다. 삭제 항목과 이미 존재하는 추가 항목은 되살리거나 중복 생성하지 않는다. 빈 컬렉션·사용자 항목만 있는 컬렉션은 그대로 둔다. 이관 마커로 반복 실행을 막는다.

## 검증

- TypeScript 통과, 전체 82개 테스트 파일 / 649개 테스트 통과.
- 프로덕션 빌드 통과. 기존 Browserslist 노후·대형 청크 경고만 존재.
- 테스트: 전체 기본 데이터 이관, 저장 후 재파싱, 수정·삭제 보호, 빈 컬렉션, 멱등성, 수치 색상 보존, 공동 레인 그룹·필터 처리.
- 로컬 실제 화면: 1974년 두 독립 연간 제목, 9월 성명 행, 12월 기존 바젤 대사건과 미키 내각 확인.
