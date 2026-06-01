# Ticker Radar — SNS 종목 발견 대시보드

추적하는 X(트위터) 계정들이 **새로 올린 글에서 종목 티커를 역추출**하고,
여러 계정에서 **동시에 급상승하는 종목**을 찾아내는 개인용 대시보드입니다.

미리 정한 종목을 추적하는 게 아니라, 계정들이 "지금 무엇을 말하는가"에서
새 종목을 발굴하는 것이 핵심입니다.

---

## 주요 기능

- **종목 발견** — 여러 계정에서 동시에 언급량이 급증한 종목을 점수순으로 표시. 기간(6시간~7일)·최소 계정수 필터, 행 클릭 시 14일 언급 추이 차트 + 원문 트윗
- **추적 계정** — X 핸들 단건/일괄 추가, 활성 토글, 삭제
- **트윗 피드** — 수집된 최신 트윗 ($티커 강조)
- **설정** — Apify 토큰/actor/계정당 최대 수집량, 더미 데이터 시드, 수집 로그

### 반드시 지키는 동작
- **증분 수집** — 계정별 마지막 트윗 ID(커서)를 저장해, 그 이후 새 트윗만 처리
- **중복 제거** — 트윗 ID 기준 dedup, 이미 본 트윗은 다시 저장/처리하지 않음
- **재시도·에러 로깅** — Apify 호출 실패/빈 결과 시 지수 백오프 재시도(3회) + 수집 로그 기록

---

## 기술 스택

Express + Vite + React + Tailwind CSS + shadcn/ui + Drizzle ORM + PostgreSQL(Supabase)
데이터는 Supabase(Postgres)에 저장됩니다. 연결 문자열은 `.env`의 `DATABASE_URL`로 설정합니다.

---

## 로컬 실행 방법

### 1. 사전 준비
- Node.js 20 이상
- [Apify](https://console.apify.com) 계정 + API 토큰 (유료 플랜에서 actor 실행)

### 2. 설치
```bash
git clone <이 레포 주소>
cd ticker-radar
npm install
```

### 3. Apify 토큰 1회 입력
`.env.example`을 복사해 `.env`를 만들고 토큰을 넣습니다. **한 번만 하면 됩니다.**
```bash
cp .env.example .env
# .env 파일을 열어 APIFY_TOKEN 값을 본인 토큰으로 교체
```
토큰은 [Apify 콘솔 → Integrations](https://console.apify.com/account/integrations)에서 발급합니다.

> 서버는 `.env`의 `APIFY_TOKEN`을 가장 먼저 읽고, 없으면 앱 설정 화면에서 입력한 값(DB 저장)을 사용합니다.

### 4. 개발 서버 실행
```bash
npm run dev
```
브라우저에서 http://localhost:5000 접속.

### 5. 프로덕션 실행 (선택)
```bash
npm run build
npm start
```

---

## 사용 흐름

1. **설정** 화면에서 토큰이 인식됐는지 확인 (`.env`를 썼다면 이미 적용됨)
2. **추적 계정** 화면에서 모니터링할 X 핸들 추가 (예: `alphahunter`)
3. 사이드바 하단 **"지금 수집"** 버튼으로 수집 실행
4. **종목 발견** 화면에서 급상승 종목 확인

> 수집은 **수동**입니다. "지금 수집" 버튼을 누를 때만 Apify actor가 돌고 새 트윗을 가져옵니다.
> 처음 동작을 확인하고 싶으면 설정 화면의 **더미 데이터 시드** 버튼으로 샘플 데이터를 넣어볼 수 있습니다.

---

## 급상승 점수 계산

```
surgeScore = 최근언급수 × 최근언급계정수 × lift
lift = (최근언급수 + 1) / (이전동일기간언급수 + 1)
```
선택한 기간(window)을 "최근"과 그 직전 "이전" 구간으로 나눠 비교합니다.
최소 계정수 필터(기본 2개+)를 통과한 종목만 표시됩니다.

---

## 환경변수

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `APIFY_TOKEN` | ✅ | — | Apify API 토큰 |
| `APIFY_ACTOR` |  | `apidojo~tweet-scraper` | 사용할 Apify actor |
| `PORT` |  | `5000` | 서버 포트 |

---

## 주의

- `.env`와 `data.db`는 `.gitignore` 처리되어 git에 올라가지 않습니다. 토큰과 수집 데이터는 본인 PC에만 남습니다.
- Apify actor 실행은 사용량(비용)이 발생합니다. 계정 수 × 계정당 최대 수집량(설정에서 조정)이 1회 수집 비용을 결정합니다.

---

## 정치인 거래 모듈 (Congress)

미국 의원(상·하원)의 STOCK Act 공시 거래를 추적하는 모듈. 사이드바 **정치인 거래**(`/#/congress`).

- **종목 랭킹** — 종목별 매수/매도 활동량·순매수·거래 의원수, 분기 추이 스파크라인. 행 클릭 시 거래 의원(상원→하원, 소속 위원회 태그)·추이 차트
- **위원회별** — 위원회 선택 시 소속 의원의 종목 매매 랭킹·추이
- **의원 개인 페이지** — 포트폴리오 변동 추이, 종목별 거래, 거래 내역

### 데이터 파이프라인

| 명령 | 설명 |
|---|---|
| `npm run db:push` 대신 `tsx script/db-push-congress.ts` | 정치인 테이블 생성(IF NOT EXISTS). drizzle.config 가 sqlite 라 별도 사용 |
| `npm run seed:congress` | mock 시드(위원회 데모용 가짜 데이터) |
| `npm run collect:congress -- --fresh` | **실데이터** — FMP 최신 공시 수집(무료 티어: 최신 ~25건/원) |
| `npm run enrich:congress` | 정당·소속 위원회 채우기(unitedstates/congress-legislators 매칭) |

권장 실행 순서(실데이터): `collect:congress -- --fresh` → `enrich:congress`

### 환경변수 (.env)

| 변수 | 설명 |
|---|---|
| `FMP_API_KEY` | Financial Modeling Prep — 의원 공시 수집 |

### 한계

- FMP 무료 티어는 페이지네이션 불가(page=0, limit≤25) → 최신 ~50건만. 누적하려면 주기적 `collect:congress` 또는 유료 플랜.
- 정당·위원회는 FMP 미제공 → `enrich:congress` 로 보강(이름 매칭이라 동명이인은 드물게 어긋날 수 있음).
- 공식 원본(하원 XML·상원 EFD) 대조 검증(verification)은 스키마에 자리만 있고 미구현(후속).
