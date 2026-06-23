# Ticker Radar — SNS 종목 발견 대시보드

추적하는 **X(트위터)·Threads** 계정들이 **새로 올린 글에서 종목 티커를 역추출**하고,
여러 계정에서 **동시에 급상승하는 종목**을 찾아내는 개인용 대시보드입니다.

미리 정한 종목을 추적하는 게 아니라, 계정들이 "지금 무엇을 말하는가"에서
새 종목을 발굴하는 것이 핵심입니다. **미장(US)·국장(KR)** 둘 다 지원합니다.

---

## 주요 기능

- **종목 발견** (`/`) — 발굴 대시보드
  - **미장/국장 토글** · 우상단 **데이터 최신화 배지**(오래되면 '갱신 필요') · **[↻ 갱신] 버튼**(GitHub Actions 수집 트리거 — [setup](docs/COLLECT-BUTTON-SETUP.md))
  - **섹터 지형(트리맵)** — 타일 크기=언급량, 색=급상승도(미장 초록/빨강·국장 빨강/파랑) + 이모지 상태(🔥급증·🆕신규·📈증가·➖유지·🔻감소). 타일 클릭 시 그 섹터의 **새로 뜨는 종목** 드릴다운
  - **🆕 신규 급부상** — 직전 기간엔 없다가 이번에 새로 언급된 종목 모음 (발굴 핵심)
  - **랭킹** — **명**(서로 다른 계정 수, 도배 제외) 순 정렬 + **언급**(중복 포함)·**추세**(비율% 대신 상태) 병기. 한글 종목명 우선, 기간(6시간~7일)·최소 계정수 필터
  - **종목 상세** — 14일 추이 + 원문 글 + **✨ 왜 뜨나** 최신 뉴스 레포트(Claude/Gemini 웹검색 그라운딩, 호재/악재+출처). 대상은 **신규 급부상** 중심
- **추적 계정** (`/accounts`) — X·Threads 핸들 단건/일괄 추가, 플랫폼 지정, 활성 토글, 삭제
- **정치인 거래** (`/congress`) — 미 의원 STOCK Act 공시 거래 (아래 별도 섹션)
- **내부자 거래** (`/insider`) — Form 4 내부자 매매 랭킹
- **자본주의 경제사** (`/capitalism`) — 전후 달러 패권사를 인과 플로우 타임라인 + 전 구간 FRED 거시지표 그래프 + 사건별 인사이트로 직접 편집·열람 (아래 별도 섹션 · [아키텍처](docs/CAPITALISM.md))
- **관심종목** (`/interest`, *현재 비활성*) — 한국투자증권 관심종목등록 상위. KIS 앱키 발급 후 [Layout.tsx](client/src/components/Layout.tsx)의 nav 한 줄 주석 해제하면 활성화 (아래 별도 섹션)

### 동작 원칙

- **증분 수집** — 계정별 마지막 글 커서(`lastSyncedAt`)를 저장해, 그 이후 새 글만 가져옴
- **중복 제거** — 글 ID 기준 dedup, 이미 본 글은 다시 저장/처리하지 않음
- **본문 영구 저장 → 무료 재추출** — 받아온 본문을 `tweets`에 저장. 종목 사전(별칭·스톱워드)을 수정하면 `npm run reextract`로 **저장된 본문에서 mentions만 다시 생성**(Apify 호출 0). 튜닝할 때 재수집 불필요
- **데이터 기준 = 마지막 수집 시점** — 급상승·신규·섹터맵의 시간 창은 '지금'이 아니라 **마지막 수집 시각**에 앵커. 재수집 전까지 마지막 수집분을 그대로 유지(우상단 배지로 안내)
- **재시도·에러 로깅** — Apify 호출 실패/빈 결과 시 지수 백오프 재시도(3회) + 수집 로그 기록

---

## 데이터 소스

| 용도 | 소스 | 비고 |
|---|---|---|
| SNS 글 | **Apify** — X: `apidojo/tweet-scraper`, Threads: `automation-lab/threads-scraper` | 토큰 필요 |
| 미장 종목명 | **SEC** `company_tickers.json` | 무료 |
| 국장 종목/코드 | **KRX KIND** 상장사 목록 | 무료 |
| 섹터(국장) | **네이버 증권 업종**(WICS) 79개 스크래핑 | 키 불필요 |
| 섹터(미장) | **Nasdaq 스크리너**(산업 단위) | 키 불필요 |
| 관심종목(국장) | **한국투자증권 Open API** 관심종목등록 상위 | 앱키 필요 |
| "왜 뜨나" 뉴스 레포트 | **Anthropic**(Claude `web_search`) 또는 **Gemini**(Google Search) | 키 있는 쪽 자동 선택 |
| 섹터 보강(선택) | **Finnhub** profile2 | 정치인·내부자 종목용 |
| 거시지표 시계열(자본주의) | **FRED** 공개 CSV(키 불필요) · S&P500=OECD · 금값=datahub.io | 빌드타임 정적 JSON으로 저장 |

---

## 기술 스택

Express + Vite + React + Tailwind CSS + shadcn/ui + Drizzle ORM + PostgreSQL(**Supabase**)
데이터는 Supabase(Postgres)에 저장됩니다. 연결 문자열은 `.env`의 `DATABASE_URL`로 설정합니다.

---

## 로컬 실행

### 1. 설치
```bash
git clone <레포 주소>
cd ticker-radar
npm install
# .env 생성 후 채우기 (아래 '환경변수' 표 참고): DATABASE_URL, APIFY_TOKEN 등
```

### 2. 개발 서버
```bash
npm run dev
```
http://localhost:5000 접속.

> **Windows 주의**: `npm run dev` 스크립트가 `NODE_ENV=...` (bash 구문)이라 PowerShell/cmd에서 깨집니다.
> PowerShell에서는: `$env:NODE_ENV='development'; $env:PORT='5000'; npx tsx server/index.ts`

### 3. 프로덕션 빌드 (선택)
```bash
npm run build && npm start
```

---

## 사용 흐름

1. **추적 계정** 화면에서 모니터링할 X·Threads 핸들 추가 (플랫폼 선택)
2. 수집 실행 (비용은 Apify 사용량):
   - 배포 앱: 종목 발견 우상단 **[↻ 갱신] 버튼** (GitHub Actions 트리거 — [setup](docs/COLLECT-BUTTON-SETUP.md))
   - 또는 CLI: `npm run collect` (X) · `npm run collect:threads` (Threads)
3. (최초 1회) 종목 사전 시드 — 아래 데이터 파이프라인 참고
4. **종목 발견** 화면에서 섹터 지형·급상승 종목 확인

> 수집은 Vercel 함수(10초 제한) 안이 아니라 **CLI 또는 GitHub Actions 러너**에서 돕니다(장시간 실행이라 함수 타임아웃 회피).

---

## 데이터 파이프라인 / 스크립트

| 명령 | 설명 |
|---|---|
| `npm run collect` | X 글 증분 수집 → 본문 저장 + mentions 추출 |
| `npm run collect:threads` | Threads 글 증분 수집 |
| `npm run reextract` | **저장된 본문에서 mentions 재생성**(사전 수정 후, Apify 호출 0) |
| `npm run seed:tickers` | SEC 전체 티커·회사명 임포트(미장) |
| `npm run seed:ko` | 미장 주요 종목 **한글명** 보강 |
| `npm run seed:kr` | KRX 전체 상장사 임포트(국장, 6자리 코드+한글명) |
| `npm run seed:kr-aliases` | 국장 인기종목 **축약 별칭**(삼전·현차·두에빌…) 큐레이션 |
| `npm run seed:kr-sectors` | 네이버 업종 → 국장 섹터 |
| `npm run seed:us-sectors` | Nasdaq 스크리너 → 미장 섹터(산업 단위) |
| `npm run collect:interest` | 한국투자증권 관심종목등록 상위 일별 스냅샷(KIS 앱키 필요) |
| `npm run reports` | **신규 급부상** 종목의 "왜 뜨나" 뉴스 레포트 생성(웹검색 그라운딩). `ANTHROPIC_API_KEY`(Claude) 우선, 없으면 `GEMINI_TOKEN`(Gemini) |
| `npm run backfill:names` | 계정 표시 이름 일괄 채우기(X author.name / Threads fullName) |
| `npm run enrich:tickers` | Finnhub로 섹터 보강(정치인·내부자·SNS 언급 종목) |

> **재추출 주의**: `reextract`는 **추가(insert-only)**. 별칭을 *추가*하면 바로 반영되지만,
> 스톱워드로 *제거*한 노이즈는 기존 mention이 남습니다 → 완전 정제는 mentions 비우고 재구축 필요.

---

## 추출 품질 (국장)

국장은 축약·흔한 단어·도배 때문에 정확도 이슈가 있어 3단으로 처리합니다:

1. **축약** — [seed-kr-aliases.ts](script/seed-kr-aliases.ts)의 `EXTRA`에 종목별 별칭 큐레이션 (두산에너빌리티 = 두에빌·두산에너빌)
2. **흔한 단어 오탐** — [server/extract.ts](server/extract.ts)
   - `KR_STOPWORDS`: 대상·태양·진영 등 이름매칭에서 차단(6자리 코드/$티커로는 잡힘)
   - **조사 경계 규칙**: `테스`(잡음) vs `테스트`(안 잡음), `레이` vs `레이저`
3. **도배** — 한 계정의 반복 게시는 **명**(서로 다른 계정 수)에 영향 없음. 랭킹 정렬 기준이 명이라 도배로 순위를 못 올림

---

## 급상승·랭킹

- 선택한 기간(window)을 "최근" / 직전 "이전" 구간으로 나눠 비교
- **랭킹 정렬** = `recentAccounts`(명, 도배 제외) → `recentMentions`(언급) 순
- **증가율** = `(최근언급 + 1) / (이전언급 + 1) − 1` (행·타일에 표시)
- 최소 계정수 필터(기본 **1개+**) 통과 + 시장(미장/국장) 일치 종목만 표시

---

## 환경변수

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | Supabase(Postgres) 연결 문자열 |
| `APIFY_TOKEN` | 수집 시 | — | Apify API 토큰 (X·Threads 수집) |
| `APIFY_ACTOR` |  | `apidojo~tweet-scraper` | X 수집 actor |
| `PORT` |  | `5000` | 서버 포트 |
| `FINNHUB_API_KEY` |  | — | `enrich:tickers`(섹터 보강) |
| `FMP_API_KEY` |  | — | 정치인 거래 수집 |
| `KIS_APP_KEY` / `KIS_APP_SECRET` |  | — | 관심종목(KIS) 수집 |
| `ANTHROPIC_API_KEY` |  | — | "왜 뜨나" 레포트(Claude `web_search`) — 우선 사용 · 선택 `ANTHROPIC_MODEL`(기본 claude-sonnet-4-6) |
| `GEMINI_TOKEN` |  | — | "왜 뜨나" 레포트(Gemini) — Anthropic 키 없을 때 대체 |
| `GH_DISPATCH_TOKEN` |  | — | 배포 앱 [↻ 갱신] 버튼용 — GitHub Actions 트리거 (Vercel 환경변수, [setup](docs/COLLECT-BUTTON-SETUP.md)) |

> `.env`는 `.gitignore` 처리. 토큰·키는 본인 PC에만 남습니다.

---

## 정치인 거래 모듈 (Congress)

미국 의원(상·하원)의 STOCK Act 공시 거래를 추적. 사이드바 **정치인 거래**(`/#/congress`).

- **종목 랭킹** — 종목별 매수/매도 활동량·순매수·거래 의원수, 분기 추이. 행 클릭 시 거래 의원·추이
- **위원회별** — 위원회 소속 의원의 종목 매매 랭킹
- **의원 개인 페이지** — 포트폴리오 변동, 종목별 거래 내역

| 명령 | 설명 |
|---|---|
| `tsx script/db-push-congress.ts` | 정치인 테이블 생성(IF NOT EXISTS) |
| `npm run seed:congress` | mock 시드(데모용) |
| `npm run collect:congress -- --fresh` | **실데이터** — FMP 최신 공시(무료 티어: 최신 ~25건) |
| `npm run enrich:congress` | 정당·소속 위원회 채우기 |

권장 순서(실데이터): `collect:congress -- --fresh` → `enrich:congress`

### 한계
- FMP 무료 티어는 페이지네이션 불가 → 최신 ~50건만. 누적하려면 주기적 수집 또는 유료 플랜.
- 정당·위원회는 이름 매칭이라 동명이인은 드물게 어긋날 수 있음.

---

## 내부자 거래 모듈 (Insider)

SEC Form 4 기반 내부자 매매 랭킹. 사이드바 **내부자 거래**(`/#/insider`).

| 명령 | 설명 |
|---|---|
| `npm run collect:insider` | Form 4 수집 |
| `npm run enrich:insider-roles` | 내부자 직책 보강 |

---

## 자본주의 경제사 모듈 (Capitalism)

전후(1944~) 달러 패권사를 **인과 플로우(마인드맵형) 타임라인**으로 직접 편집·열람. 사이드바 **자본주의 경제사**(`/#/capitalism`).
정치인·내부자·SNS 와 **완전 분리된 모듈**(테이블 `cap_*`·라우트 `/api/capitalism/*`·컴포넌트 `Cap*`).

- **타임라인 보드** — 사건을 카드로 쌓고(연도순), 카드 안 노드(원인·사건·영향·결과)와 카드 사이를 화살표로 연결. `stack`/`branch`(분기) 레이아웃.
- **거시지표 그래프** — 전 구간 FRED 시계열 19종(GDP·인플레·금리·달러·유가·금값·시총·연준 유동성…). 기본 ON 6개. Y축 "시점 맞춤", 단위 라벨 클릭 시 **달러→원화** 환산, 라벨 클릭 시 전체범위 팝업.
- **인사이트** — 카드 헤더 ★ 클릭 시 그 사건을 현재와 연결짓는 해설(리치텍스트 + 그 시점 그래프). 전체를 **모아보기 탭**에서 시간순으로 + **메타 테제** 공간.

| 명령 | 설명 |
|---|---|
| `tsx script/db-push-capitalism.ts` | 핵심 테이블 생성(IF NOT EXISTS) |
| `tsx script/db-push-capitalism-{table,insight,settings}.ts` | 표·인사이트 컬럼 / 설정 테이블 증분 추가 |
| `npx tsx script/fetch-capitalism-series.ts` | FRED 시계열 → `client/src/data/capitalism-series.json` 재생성(키 불필요) |
| `npx tsx script/seed-capitalism.ts` | 사건 카드 시드 |
| `npx tsx script/seed-capitalism-insights.ts --write` | 인사이트·메타테제 시드(비파괴) |

> **상세 아키텍처: [docs/CAPITALISM.md](docs/CAPITALISM.md)** (데이터 모델·API·그래프·인사이트·컴포넌트 지도).
> ⚠️ DDL 은 raw 스크립트로만, 입력된 사건 데이터(현재 1968~1994)는 손실 금지 — 시드는 전부 비파괴.

---

## 관심종목 모듈 (KIS, 현재 비활성)

한국투자증권 Open API의 **국내주식 관심종목등록 상위**(개인 투자자 워치리스트 등록 상위)를
매일 스냅샷으로 쌓아, 등록 건수 추이로 인기 상승/하락을 본다. SNS 발굴과 **별개의 retail 관심 신호**.

현재 **사이드바에서 숨김** 상태(앱키 발급 보류). 활성화하려면:

1. [KIS Developers](https://apiportal.koreainvestment.com)에서 **실전투자** 앱키/시크릿 발급
2. `.env`에 `KIS_APP_KEY` / `KIS_APP_SECRET` 추가
3. `npm run collect:interest` (매일 1회 권장 — 추이는 2일+ 쌓이면 표시)
4. [Layout.tsx](client/src/components/Layout.tsx)에서 `관심종목` nav 줄 주석 해제

> API: `[국내주식] 순위분석 > 국내주식 관심종목등록 상위` (tr_id `FHPST01800000`). 실전 도메인에서 동작.
