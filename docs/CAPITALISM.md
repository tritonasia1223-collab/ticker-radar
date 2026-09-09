# 자본주의 경제사 모듈 (Capitalism)

> 사이드바 **자본주의 경제사**(`/#/capitalism`). **메인 편집 모듈** —
> DB 테이블(`cap_*`)·API 라우트(`/api/capitalism/*`)·페이지/컴포넌트(`Cap*`) 전부 별도 네임스페이스.

전후(1944~) 달러 패권의 역사를 **인과 플로우(마인드맵형) 타임라인**으로 직접 편집·열람하는 도구.
각 사건을 카드로 쌓고, 카드 안의 인과관계를 연결하고, 전 구간 FRED 거시지표 그래프를 옆에 띄워
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
| `cap_settings` | 도메인 app-level 키-값 | `key` PK, `value` — 현재 메타 카드는 `insight_overview_v2`, `insight_overview`는 레거시 |

- **`insight` JSON** = `{ text, charts, tables?, blocks? }`. `blocks`가 있으면 텍스트·표·이미지·그래프·HTML·구분선의 순서를 결정합니다. 레거시 필드는 호환용입니다.
- **`tableData` JSON** = `{ title?, widths[], cells[][] }`. 노드 메모(`ref`)와 **같은 층위**(별도 열 아님).
- 노드 본문/메모는 **리치텍스트 마커 문자열**로 직렬화: `[[hl-y|텍스트]]`(하이라이트)·`[[c-r|텍스트]]`(색)·`[[link:slug|텍스트]]`(내부링크), 불릿은 `\t`×레벨 + `• `.

---

## 3. API (`server/cap-collaboration.ts`)

| 메서드 | 경로 | 동작 |
|---|---|---|
| GET | `/api/capitalism/flows` | 일관된 트랜잭션 스냅샷으로 카드·노드·엣지 조립 |
| GET | `/api/capitalism/collab/resource?key=flow:slug` | 카드의 최신 문서와 버전. 메타 카드는 `meta:id` |
| POST | `/api/capitalism/collab/edit` | 변경 경로·이전 값·새 값을 비교하고 원자적 저장. 충돌 409 |
| GET | `/api/capitalism/collab/state` | 변경 버전과 최근 접속자. 화면에서 5초마다 확인 |
| POST | `/api/capitalism/collab/presence` | 표시 이름·현재 카드·접속 시각. 15초 갱신, 45초 만료 |
| GET | `/api/capitalism/collab/history[-resources]` | 카드별 최근 30개 이력 또는 이력이 있는 카드 목록 |
| GET | `/api/capitalism/collab/history/:id` | 변경자, 변경 항목, 이전/이후 값 |
| GET/POST/DELETE | `/api/capitalism/links` | 기존 전역 화살표 API. 전체 스냅샷 Undo에서 제외 |
| GET | `/api/capitalism/settings/:key` | 메타 카드 설정 읽기 |

기존 flows/settings 쓰기 API는 428로 거절해 이전에 열린 브라우저의 전체 덮어쓰기를 차단합니다. CLI에서 직접 호출하는 `server/capitalism.ts`의 기존 관리 함수는 남아 있으므로 공동 편집 중에 별도 일괄 수정 스크립트를 실행하지 않습니다.

`cap_edit_operations`는 요청 ID·원본 요청·실제로 반영된 변경·표시 이름을 저장합니다. 같은 요청 재전송은 재적용하지 않습니다. `cap_editors`는 접속 표시용이며 인증이나 편집 잠금이 아닙니다. 추가 DDL은 `npm run cap:collab:init`으로만 적용합니다.

---

## 4. FRED 거시지표 그래프

전 구간 시계열을 **빌드타임 정적 JSON**(`client/src/data/capitalism-series.json`, ~357KB)으로 안고 들어간다.
외부 FRED 런타임 API 호출 없음; 정적 JSON 에셋을 별도로 fetch — 그래서 `/capitalism` 라우트는 **코드 스플릿**으로 분리(이 JSON이 초기 번들에 안 섞이게).

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
- **라벨 클릭 → 전체범위 팝업** — 슬라이더 ±5년이 아니라 그 지표 전 구간을 크게.
- **호버 툴팁** — 세로 안 넓고 그래프 안 가리게 1줄 압축(`tickFmt`, `position={{y:0}}`).
- **연도 헤더 지도자 병기** — `leadersForYear`의 저장소 설정값을 표시합니다. 현직 정보를 실시간 조회하지 않습니다.

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
- **모아보기 탭**에서 시간순으로 읽고, 리치텍스트의 내부 링크로 사건 카드를 찾아갑니다.
- **메타 카드** — `insight_overview_v2`에 `{ cards: [...] }`로 저장합니다. 사건과 무관한 전체 논증을 여러 카드로 작성합니다. 이전 단일 `insight_overview`는 v2가 없을 때만 읽습니다.
- 노드 본문·메모·표·제목·인사이트·메타 카드는 입력 즉시 기기 초안(IndexedDB)에 기록하고 600ms 후 저장합니다. 날짜·기간은 기존 날짜 패널의 **저장** 버튼으로 확정합니다. 표 너비는 드래그 종료 시 저장합니다.
- 서로 다른 카드·노드·필드는 병합합니다. 같은 본문, 같은 표, 같은 사건 인사이트, 같은 메타 본문 블록 배열은 한 단위로 비교하며 충돌 시 서버/내 내용을 선택합니다. 삭제와 수정도 충돌로 처리합니다.
- 서버는 카드 단위 트랜잭션 잠금 안에서 최신 값 비교 → 필요한 행 변경 → 변경 이력을 함께 기록합니다. 메타 카드는 공유 설정을 잠근 뒤 해당 카드만 반영합니다.
- 다른 창의 변경은 5초 주기로 확인합니다. 내 미저장 필드를 보존하고 충돌을 표시합니다. 포커스가 남은 리치 에디터도 서버 변경을 반영해 blur 시 옛 본문을 다시 제출하지 않게 합니다.
- 새로고침 뒤 남은 초안은 **서버와 비교해 복구**로 확인합니다. 기기 저장소를 지우거나 비공개 창을 종료한 경우에는 로컬 초안이 남지 않을 수 있습니다. 기기 저장 실패는 화면에 표시합니다.
- 구조 Undo와 **변경 이력 → 이 변경만 되돌리기**는 당시 변경한 부분만 역적용합니다. 이후 같은 부분이 바뀌었으면 충돌 선택을 요구합니다. 삭제된 카드도 이력 목록에서 찾을 수 있습니다.
- 마지막 노드를 삭제해도 인사이트가 있으면 사건을 유지합니다. 다른 사람이 작성 중일 수 있는 빈 노드를 일괄 정리하지 않습니다.
- 상세 사용법·배포·검증 범위: [협업 편집](COLLABORATION.md).

---

## 6. 컴포넌트·라이브러리 지도

| 파일 | 역할 |
|---|---|
| `client/src/pages/Capitalism.tsx` | 페이지 셸 — 보드·슬라이더·오른쪽 패널·탭 상태 |
| `client/src/components/CapFlow.tsx` | 사건 카드(노드 열, branch 분기, ★, 인사이트 클릭) |
| `client/src/components/CapInsight.tsx` | `InsightPanel`·`InsightsCollection`·메타 카드 편집; 본문 블록은 `CapBlocks.tsx` |
| `client/src/components/CapChartPanel.tsx` | `PanelChart`(스케일·압축포맷) + 확대 모달·원화 토글 |
| `client/src/components/CapRichEditor.tsx` | contentEditable 리치 에디터(마커 직렬화, `align` 옵션) |
| `client/src/components/CapRichText.tsx` | 읽기 전용 리치텍스트 렌더 |
| `client/src/components/CapTable.tsx` | 노드 표 편집/렌더(flex 가중 열, 헤더 음영) |
| `client/src/components/CapLinkOverlay.tsx` | 전역 화살표 오버레이(SVG) |
| `client/src/lib/capitalism-config.ts` | `PANELS`·`CATEGORIES`·`leadersForYear`·`krwConversion`·불릿 |
| `client/src/lib/capitalism-types.ts` | DTO 타입(Flow·Node·Insight·Table) |
| `client/src/lib/capitalism-flowops.ts` | 노드 키·엣지·내용 유틸 및 기존 링크 저장 큐 |
| `client/src/lib/cap-collab-engine.ts` | 요청 직렬화·초안·충돌·필드 단위 Undo |
| `client/src/lib/cap-collab-client.ts` | 서버 연결·캐시 반영·동기화 주기 |
| `client/src/components/CapCollaboration.tsx` | 저장 상태·충돌 비교·초안 복구·이력 UI |
| `client/src/lib/capitalism-richtext.ts` | 마커 ↔ DOM 직렬화 |
| `client/src/lib/capitalism-undo.ts` | 이전 Undo 유틸·회귀 테스트용. 현재 페이지에서 사용하지 않음 |

---

## 7. 운영 스크립트

운영 데이터를 수정하기 전 `npm run cap:backup`으로 백업합니다. `npm run cap:integrity`는 최신 백업 대비 카드·노드 ID 소멸을 검사하며, 정상은 exit 0, 손실/조회 실패는 exit 1, 백업 부재는 exit 2입니다. 내용의 정확성이나 의도적인 삭제 여부까지 판정하는 검사는 아닙니다. 백업·이력 파일을 보존하세요.


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
> 입력된 사건 데이터는 **손실 금지** — 시드는 전부 비파괴(존재 시 건너뜀).

---

## 8. 성능

- `/capitalism` 라우트는 `React.lazy`로 **코드 스플릿** — 357KB 시계열 JSON + framer-motion + 리치에디터가
  별도 청크로 빠져 다른 페이지 초기 번들에 안 섞입니다. 실제 번들 크기는 현재 빌드 출력을 확인합니다.
- 시계열은 정적 JSON(별도 정적 JSON 에셋 1회 fetch). 진입 시 청크 1회 로드 후 캐시.
