# 자본주의 경제사 모듈 (Capitalism)

> 사이드바 **자본주의 경제사**(`/#/capitalism`). 정치인·내부자·SNS 와 **완전히 분리된 네 번째 모듈** —
> DB 테이블(`cap_*`)·API 라우트(`/api/capitalism/*`)·페이지/컴포넌트(`Cap*`) 전부 별도 네임스페이스.

전후(1944~) 달러 패권의 역사를 **인과 플로우(마인드맵형) 타임라인**으로 직접 편집·열람하는 도구.
각 사건을 카드로 쌓고, 카드 안/사이를 화살표로 잇고, 전 구간 FRED 거시지표 그래프를 옆에 띄워
"그때 무슨 일이 있었나 + 지표가 어떻게 움직였나 + 그게 지금과 어떻게 연결되나(인사이트)"를 한 화면에서 본다.

---

## 1. 화면 구성

```
┌───────────────────────────────────────┬──────────────────────┐
│  타임라인 보드 (연도별 사건 카드 스택)  │  오른쪽 패널          │
│   - 카드 = 하나의 사건(cap_flows)       │   ├ 그래프 모드        │
│   - 카드 안 노드(원인·사건·영향·결과)   │   │  (FRED 지표 패널들) │
│   - 노드 간/카드 간 화살표(링크)        │   └ 인사이트 모드      │
│   - 카드 헤더 ★ = 인사이트 있음         │      (★ 클릭 시 전환)  │
├───────────────────────────────────────┤                      │
│  하단 연도 슬라이더 (재생/스크럽)        │  + 인사이트 모아보기 탭 │
└───────────────────────────────────────┴──────────────────────┘
```

- **타임라인 보드** — 연도순으로 사건 카드를 쌓는다. 카드는 `stack`(세로) 또는 `branch`(기준열 + 좌/우 분기열) 레이아웃.
- **연도 슬라이더** — 끌면 해당 시점으로 보드가 스크롤(`seekToYear`). 카드 클릭은 슬라이더만 옮기고 보드는 안 움직임(`selectYear`) — 편집 클릭 시 화면 점프 방지.
- **오른쪽 패널** — 평소엔 **그래프 모드**(아래 지표 패널). 카드의 ★를 누르면 그 사건의 **인사이트 모드**로 전환(그래프 자리에 인사이트 본문 + 그 시점 그래프).
- **인사이트 모아보기 탭** — 전체 인사이트를 시간순 챕터로 읽는 뷰 + **메타 테제**(사건에 안 묶이는 전체 관통 논증) 공간.

---

## 2. 데이터 모델 (`shared/schema.ts`, prefix `cap_`)

| 테이블 | 역할 | 핵심 컬럼 |
|---|---|---|
| `cap_flows` | 사건 1개 = 인과 플로우 1개 | `slug`(안정키, unique), `date`/`endDate`(기간이벤트), `year`, `title`, `category`(정치·경제·사회), `layout`(stack·branch), **`insight`**(nullable JSON), `sortOrder` |
| `cap_nodes` | 플로우 안 블록(노드) | `flowId`→flows(cascade), `nodeKey`(플로우 내 고유), `kind`(cause·event·effect·result), `inLabel`, `text`, `ref`(메모), `col`(branch: center·left·right), **`tableData`**(nullable JSON 표), `pos` |
| `cap_edges` | 플로우 **내부** 화살표 | `flowId`, `fromKey`/`toKey`(nodeKey) |
| `cap_links` | 보드 **전역** 화살표(카드 경계 넘음) | `(fromSlug,fromKey)→(toSlug,toKey)`, unique |
| `cap_settings` | 도메인 app-level 키-값 | `key` PK, `value` — 메타 테제는 `insight_overview` 키 |

- **`insight` JSON** = `{ text: 리치텍스트마커, charts: [{series, from, to}] }`. 비면 `null`(빈 인사이트 저장 안 함).
- **`tableData` JSON** = `{ title?, widths[], cells[][] }`. 노드 메모(`ref`)와 **같은 층위**(별도 열 아님).
- 노드 본문/메모는 **리치텍스트 마커 문자열**로 직렬화: `[[hl-y|텍스트]]`(하이라이트)·`[[c-r|텍스트]]`(색)·`[[link:slug|텍스트]]`(내부링크), 불릿은 `\t`×레벨 + `• `.

---

## 3. API (`server/capitalism.ts` ↔ `server/routes.ts`)

| 메서드 | 경로 | 함수 |
|---|---|---|
| GET | `/api/capitalism/flows` | `listFlows()` — 노드·엣지·표·인사이트까지 조립(`assemble`) |
| POST | `/api/capitalism/flows` | `upsertFlow()` — **트랜잭션**(flow+nodes+edges 원자적 교체) |
| DELETE | `/api/capitalism/flows/:slug` | `deleteFlow()` — 트랜잭션, 연결된 전역 링크도 정리 |
| GET/POST/DELETE | `/api/capitalism/links` | 전역 화살표(`cap_links`) CRUD |
| GET/PUT | `/api/capitalism/settings/:key` | `getSetting`/`setSetting` — 메타 테제 등 |

- `upsertFlow`/`deleteFlow` 는 **Supabase 세션 풀러에서 트랜잭션 동작 확인됨**(`db.transaction`).
- 빈 노드(텍스트·표·메모 다 없음)는 저장 전 `nodeHasContent`로 걸러짐(client `capitalism-flowops.ts`).

---

## 4. FRED 거시지표 그래프

전 구간 시계열을 **빌드타임 정적 JSON**(`client/src/data/capitalism-series.json`, ~357KB)으로 안고 들어간다.
런타임 API 호출 없음 — 그래서 `/capitalism` 라우트는 **코드 스플릿**으로 분리(이 JSON이 초기 번들에 안 섞이게).

### 패널 (`client/src/lib/capitalism-config.ts` — `PANELS`)

| 카테고리 | 패널(기본 ON ✅) |
|---|---|
| **거시경제** | 실질 GDP 성장률 ✅ · 인플레이션(CPI YoY) ✅ · GDP 대비 정부부채 ✅ · 실업률 |
| **주식시장** | 미국 시총 ✅ · S&P500 추종 · 나스닥 종합 |
| **금리** | 연준 정책금리 ✅ · 단기(3M T-Bill) · 장기(10Y) |
| **통화·대외** | 달러지수 ✅ · 유가(WTI) · 금값(oz) · 무역수지 · M2 |
| **연준 유동성** | 본원통화 · 연준 총자산 · 지급준비금 · 역레포(ON RRP) |

- **기본 ON 6개**: 실질 GDP 성장률 · 인플레이션 · 미국 시총 · GDP 대비 정부부채 · 연준 정책금리 · 달러지수.
- **Y축 기본 = "시점 맞춤"**(window) — 슬라이더 구간에 보이는 값 범위로 자동 스케일.
- **달러→원화 토글** — `$B`/`$/oz` 등 **단위 라벨을 클릭**하면 고정환율(`USD_KRW=1380`)로 환산(`krwConversion`). 조₩·₩/bbl·₩/oz.
- **라벨 클릭 → 전체범위 팝업** — 슬라이더 ±10년이 아니라 그 지표 전 구간을 크게.
- **호버 툴팁** — 세로 안 넓고 그래프 안 가리게 1줄 압축(`tickFmt`, `position={{y:0}}`).
- **연도 헤더 지도자 병기**(`leadersForYear`) — 대통령/연준의장(존슨~트럼프2기 / 마틴~파월·워시). 2026.5.22 파월→워시 취임 병기.

### 시리즈 갱신

```bash
npx tsx script/fetch-capitalism-series.ts   # FRED CSV(키 불필요) → capitalism-series.json 재생성
```

- 대부분 FRED 공개 CSV(`fredgraph.csv?id=X`, 키 없음).
- **FRED 가 막는 것**(라이선스): S&P500 → OECD `SPASTT01USM661N`, 금값 → datahub.io GitHub raw CSV 로 우회.
- 시리즈 키 19종: `gdp_growth, inflation, unrate, debt_gdp, mktcap, sp500, nasdaq, fedfunds, tb3ms, gs10, dollar, oil, gold, trade, m2, monbase, walcl, wresbal, rrp`.

---

## 5. 인사이트 시스템

과거 사건을 **현재와 연결짓는 해설**. 카드별로 0~1개.

- 카드 헤더 **★**(빨강, 네온 글로우 펄스 `cap-star-neon`) = 인사이트 있음 → 클릭 시 오른쪽이 인사이트 모드로 전환.
- **본문**: 리치텍스트(왼쪽 정렬, 하이라이트·색 마커). **그래프**: 여러 개 첨부 가능, 추가 시 기본 범위 = **카드 시점 ±5년 창**(자유 조정).
- **인사이트끼리 직접 링크는 없음**(카드 점프 방식 폐기) — 대신 **모아보기 탭**에서 시간순으로 읽는다.
- **메타 테제**(`insight_overview` 세팅) — 사건에 안 묶이는 전체 논증("달러 패권 = 숙주를 갈아타는 바이러스") 한 곳에.
- POST-per-keystroke 방지: 편집은 로컬, **blur 시 1회 커밋**(`chartsRef`/`textRef`).

---

## 6. 컴포넌트·라이브러리 지도

| 파일 | 역할 |
|---|---|
| `client/src/pages/Capitalism.tsx` | 페이지 셸 — 보드·슬라이더·오른쪽 패널·탭 상태 |
| `client/src/components/CapFlow.tsx` | 사건 카드(노드 열, branch 분기, ★, 인사이트 클릭) |
| `client/src/components/CapInsight.tsx` | `InsightPanel`·`InsightsCollection`·`OverviewBlock`·`InsightChartView` |
| `client/src/components/CapChartPanel.tsx` | `PanelChart`(스케일·압축포맷) + 확대 모달·원화 토글 |
| `client/src/components/CapRichEditor.tsx` | contentEditable 리치 에디터(마커 직렬화, `align` 옵션) |
| `client/src/components/CapRichText.tsx` | 읽기 전용 리치텍스트 렌더 |
| `client/src/components/CapTable.tsx` | 노드 표 편집/렌더(flex 가중 열, 헤더 음영) |
| `client/src/components/CapLinkOverlay.tsx` | 전역 화살표 오버레이(SVG) |
| `client/src/lib/capitalism-config.ts` | `PANELS`·`CATEGORIES`·`leadersForYear`·`krwConversion`·불릿 |
| `client/src/lib/capitalism-types.ts` | DTO 타입(Flow·Node·Insight·Table) |
| `client/src/lib/capitalism-flowops.ts` | `nodeHasContent`·`toInput`·persist 필터 |
| `client/src/lib/capitalism-richtext.ts` | 마커 ↔ DOM 직렬화 |
| `client/src/lib/capitalism-undo.ts` | 편집 undo 스택 |

---

## 7. 운영 스크립트

| 명령 | 설명 |
|---|---|
| `tsx script/db-push-capitalism.ts` | `cap_flows`/`cap_nodes`/`cap_edges`/`cap_links` 생성(IF NOT EXISTS) |
| `tsx script/db-push-capitalism-table.ts` | `cap_nodes.table_data` 컬럼 추가(IF NOT EXISTS) |
| `tsx script/db-push-capitalism-insight.ts` | `cap_flows.insight` 컬럼 추가(IF NOT EXISTS) |
| `tsx script/db-push-capitalism-settings.ts` | `cap_settings` 테이블 생성(IF NOT EXISTS) |
| `npx tsx script/fetch-capitalism-series.ts` | FRED 시계열 → `capitalism-series.json` 재생성 |
| `npx tsx script/seed-capitalism.ts` | 사건 카드 시드(`capitalism-flows-seed.json`) |
| `npx tsx script/seed-capitalism-insights.ts [--write]` | 인사이트·메타테제 시드(비파괴, 기존 인사이트 안 덮음) |

> ⚠️ **DDL 은 raw 스크립트로만**(`ADD COLUMN/CREATE TABLE IF NOT EXISTS`). 공유 Supabase 에 `drizzle-kit push` 절대 금지 —
> 전-DB diff 라 미선언 테이블을 DROP 한다. 대량 파괴적 UPDATE 도 금지.
> 입력된 사건 데이터(현재 1968~1994)는 **손실 금지** — 시드는 전부 비파괴(존재 시 건너뜀).

---

## 8. 성능

- `/capitalism` 라우트는 `React.lazy`로 **코드 스플릿** — 357KB 시계열 JSON + framer-motion + 리치에디터가
  별도 청크로 빠져 다른 페이지 초기 번들에 안 섞인다(메인 번들 gzip 420KB→90KB).
- 시계열은 정적 JSON(런타임 fetch 0). 진입 시 청크 1회 로드 후 캐시.
