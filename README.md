# Ticker Radar — SNS 종목 발견 대시보드

추적하는 **X(트위터)·Threads** 계정들이 **새로 올린 글에서 종목 티커를 역추출**하고,
여러 계정에서 **동시에 급상승하는 종목**을 찾아내는 개인용 대시보드입니다.

미리 정한 종목을 추적하는 게 아니라, 계정들이 "지금 무엇을 말하는가"에서
새 종목을 발굴하는 것이 핵심입니다. **미장(US)·국장(KR)** 둘 다 지원합니다.

---

## 주요 기능

- **종목 발견** (`/`) — 발굴 대시보드
  - **미장/국장 토글** — 한 화면에서 시장 전환 (기본 미장)
  - **섹터 지형(트리맵)** — 타일 크기=언급량, 색=급상승도(미장 초록/빨강, 국장 빨강/파랑). 타일 클릭 시 그 섹터에서 **새로 뜨는 종목** 드릴다운
  - **랭킹** — **명**(서로 다른 계정 수, 도배 제외) 순으로 정렬 + **언급**(중복 포함) 병기. 한글 종목명 우선 표시, 기간(6시간~7일)·최소 계정수 필터. 행 클릭 시 14일 추이 + 원문 글
- **추적 계정** (`/accounts`) — X·Threads 핸들 단건/일괄 추가, 플랫폼 지정, 활성 토글, 삭제
- **정치인 거래** (`/congress`) — 미 의원 STOCK Act 공시 거래 (아래 별도 섹션)
- **내부자 거래** (`/insider`) — Form 4 내부자 매매 랭킹
- **관심종목** (`/interest`, *현재 비활성*) — 한국투자증권 관심종목등록 상위. KIS 앱키 발급 후 [Layout.tsx](client/src/components/Layout.tsx)의 nav 한 줄 주석 해제하면 활성화 (아래 별도 섹션)

### 동작 원칙

- **증분 수집** — 계정별 마지막 글 커서(`lastSyncedAt`)를 저장해, 그 이후 새 글만 가져옴
- **중복 제거** — 글 ID 기준 dedup, 이미 본 글은 다시 저장/처리하지 않음
- **본문 영구 저장 → 무료 재추출** — 받아온 본문을 `tweets`에 저장. 종목 사전(별칭·스톱워드)을 수정하면 `npm run reextract`로 **저장된 본문에서 mentions만 다시 생성**(Apify 호출 0). 튜닝할 때 재수집 불필요
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
| 섹터 보강(선택) | **Finnhub** profile2 | 정치인·내부자 종목용 |

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
cp .env.example .env   # DATABASE_URL, APIFY_TOKEN 등 채우기
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
2. 수집 실행 (**CLI**, 비용은 Apify 사용량):
   - X: `npm run collect`
   - Threads: `npm run collect:threads`
3. (최초 1회) 종목 사전 시드 — 아래 데이터 파이프라인 참고
4. **종목 발견** 화면에서 섹터 지형·급상승 종목 확인

> 수집은 서버리스(Vercel)가 아니라 **로컬/워커에서 CLI로** 돕니다(장시간 실행이라 함수 타임아웃 회피).

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

## 관심종목 모듈 (KIS, 현재 비활성)

한국투자증권 Open API의 **국내주식 관심종목등록 상위**(개인 투자자 워치리스트 등록 상위)를
매일 스냅샷으로 쌓아, 등록 건수 추이로 인기 상승/하락을 본다. SNS 발굴과 **별개의 retail 관심 신호**.

현재 **사이드바에서 숨김** 상태(앱키 발급 보류). 활성화하려면:

1. [KIS Developers](https://apiportal.koreainvestment.com)에서 **실전투자** 앱키/시크릿 발급
2. `.env`에 `KIS_APP_KEY` / `KIS_APP_SECRET` 추가
3. `npm run collect:interest` (매일 1회 권장 — 추이는 2일+ 쌓이면 표시)
4. [Layout.tsx](client/src/components/Layout.tsx)에서 `관심종목` nav 줄 주석 해제

> API: `[국내주식] 순위분석 > 국내주식 관심종목등록 상위` (tr_id `FHPST01800000`). 실전 도메인에서 동작.
