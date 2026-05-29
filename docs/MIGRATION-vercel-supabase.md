# 마이그레이션 계획서 — Vercel 배포 + Supabase(Postgres)

> 작성일: 2026-05-29
> 목표: SQLite(로컬 파일) → Supabase(Postgres) DB 전환, Vercel 배포.
> **운영 방침(확정):** Vercel은 **조회 전용(읽기 API + 프론트엔드)**. 수집(`/api/collect`)은
> Vercel에서 돌리지 않고 **로컬/별도 워커**에서 실행해 Supabase에 직접 write 한다.

---

## 0. 배경 — 왜 이렇게 가는가

- 앱의 핵심 가치(급상승 탐지 surge, 타임라인, mentions⨝tweets)가 전부 **SQL 집계 쿼리**에 있다.
  Firestore는 `GROUP BY`/`JOIN`/`COUNT(DISTINCT)`/`CASE WHEN`이 없어 전부 JS로 재작성해야 하고
  데이터가 쌓일수록 전체 문서 읽기 비용/지연이 커진다 → **부적합**.
- Postgres는 기존 SQL을 거의 그대로 살릴 수 있고, Drizzle ORM을 쓰고 있어 전환이 기계적이다.
  (`package.json`에 이미 `@supabase/supabase-js` 존재.)
- 현재 `better-sqlite3` + 로컬 `data.db` 파일은 Vercel 서버리스(휘발성 디스크)에서 **사용 불가** →
  외부 호스팅 DB 전환은 어차피 필수.
- `/api/collect`의 `collectAll()`은 Apify를 `run-sync`로 **수십 초~수 분** 대기 →
  Vercel 함수 타임아웃(Hobby 10s)에 걸린다. 그래서 **수집은 Vercel 밖으로 분리**한다.

---

## 1. 최종 아키텍처

```
┌──────────────────────────────┐        ┌─────────────────────────┐
│ Vercel                       │        │ 로컬 PC / 별도 워커      │
│  - 프론트엔드(정적 SPA)      │        │  npm run collect        │
│  - 읽기 API (서버리스 함수)  │        │  (Apify run-sync 호출)  │
│    surge/timeline/tweets/... │        │        │                │
└───────────┬──────────────────┘        └────────┼────────────────┘
            │  읽기                               │  쓰기
            ▼                                     ▼
        ┌───────────────────────────────────────────┐
        │            Supabase (Postgres)            │
        └───────────────────────────────────────────┘
```

- **읽기 경로(Vercel):** GET 위주 — `/api/surge`, `/api/symbols/:s/timeline`,
  `/api/symbols/:s/tweets`, `/api/tweets`, `/api/accounts`, `/api/sync-logs`,
  `/api/stats`, `/api/settings`(GET), `/api/tickers`(GET).
- **쓰기 경로(분리):** `collectAll()` = Apify 호출 + tweets/mentions insert + 커서 갱신.
  로컬 스크립트로 실행. accounts/tickers/settings 같은 가벼운 관리성 쓰기는
  선택적으로 Vercel에 둘 수도 있으나(아래 §6 참고), 기본은 "조회 전용"이 안전.

---

## 2. 작업 덩어리 요약

| # | 덩어리 | 난이도 | 핵심 |
|---|---|---|---|
| A | DB: SQLite → Postgres (Drizzle) | 中 | 타입 치환 + **동기→비동기 전환** + raw SQL 2곳 번역 |
| B | 수집 분리: CLI 워커화 | 小 | `collectAll()`을 `npm run collect`로 실행 가능하게 |
| C | Vercel 서버리스: 읽기 API | 中 | Express app → `api/index.ts` 핸들러로 export |
| D | 프론트엔드 API_BASE 처리 | 小 | `__PORT_5000__` 치환 → 동일 오리진(상대경로)로 단순화 |
| E | 빌드/설정/배포 | 小 | `vercel.json`, env, drizzle push |

---

## 3. 덩어리 A — DB 계층 전환 (가장 큰 작업)

### A-1. `shared/schema.ts` — Postgres 타입으로 치환
- `sqliteTable` → `pgTable` (`drizzle-orm/pg-core`)
- `integer(...).primaryKey({autoIncrement:true})` → `serial("id").primaryKey()`
- `integer(name,{mode:"boolean"})` → `boolean(name)`
- unix ms 저장 컬럼(`tweetedAt`, `collectedAt`, `createdAt`, `lastSyncedAt`,
  `startedAt`, `finishedAt`) → **`bigint(name,{mode:"number"})`** (ms 값이 2^31 초과 → `integer` 불가)
- `text` 기본/`unique`/`index`/`uniqueIndex`는 pg-core 동등 API로 그대로
- `aliases text default "[]"` 유지(JSON 문자열). 원하면 `jsonb`로 개선 가능(선택)
- `drizzle-zod`의 `createInsertSchema`는 pg 테이블에도 동일하게 동작

### A-2. `server/storage.ts` — 드라이버 교체 + **비동기화**
- 드라이버: `drizzle-orm/better-sqlite3` + `better-sqlite3`
  → `drizzle-orm/postgres-js` + `postgres` (Supabase 커넥션 문자열 사용)
  - 서버리스에서는 connection pooling 주의: Supabase의 **pooler(pgbouncer, 6543포트)** 사용,
    `postgres(url, { prepare: false })` 권장.
- **동기 API 전부 제거** — 이게 잡일의 핵심:
  - `.get()` → `await ...; rows[0]`
  - `.all()` → `await ...`
  - `.run()` → `await ...`
  - `.returning().get()` → `await ...returning(); [0]`
- raw `sqlite.prepare(...).all(...)` 2곳을 Drizzle `db.execute(sql\`...\`)`로 교체(아래 A-3).
- 부트 시 `migrate()`의 `sqlite.exec(CREATE TABLE...)` 제거 → **drizzle-kit push로 대체**(§7).
- `counts()`의 raw count도 Drizzle `count()`로 교체.

### A-3. raw SQL 2곳 — SQLite → Postgres 문법 번역
**surge() (storage.ts:171 부근)**
- `GROUP_CONCAT(DISTINCT m.handle)` → `string_agg(DISTINCT m.handle, ',')`
- `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` → Postgres도 동일 동작(그대로 가능)
- `COUNT(DISTINCT CASE WHEN ... THEN m.account_id END)` → 그대로 가능
- 파라미터 바인딩: `?` → drizzle `sql` 템플릿의 `${recentStart}` 형태로
- 반환 컬럼 숫자 캐스팅 주의: pg는 `COUNT`가 `bigint`(문자열로 옴) → 기존 `Number(...)` 래핑 유지로 흡수됨

**symbolTimeline() (storage.ts:220 부근)**
- `date(m.tweeted_at/1000,'unixepoch')`
  → `to_char(to_timestamp(m.tweeted_at/1000), 'YYYY-MM-DD')`
- 나머지 `GROUP BY day ORDER BY day` 동일

### A-4. `onConflict` 절
- `onConflictDoNothing({target})`, `onConflictDoUpdate({target,set})`는
  drizzle pg-core에서도 지원 → 거의 그대로. `.run()`만 제거.
- "삽입됐는지 여부"(`r.changes>0`) 판정은 pg에선 `.returning()` 길이로 대체:
  `const r = await db.insert(...).onConflictDoNothing().returning(); return r.length>0;`

### A-5. `drizzle.config.ts`
- `dialect: "sqlite"` → `"postgresql"`
- `dbCredentials.url` → `process.env.DATABASE_URL` (Supabase, **직결 5432포트** 사용; push/migrate용)

---

## 4. 덩어리 B — 수집 워커 분리

- 새 엔트리 `script/collect.ts`:
  ```ts
  import "dotenv/config";
  import { collectAll } from "../server/apify";
  collectAll().then(r => { console.log(r); process.exit(r.ok?0:1); });
  ```
- `package.json` 스크립트 추가: `"collect": "tsx script/collect.ts"`
- 로컬 `.env`에 `APIFY_TOKEN` + `DATABASE_URL`(Supabase) 둘 다 필요.
- 실행: `npm run collect` (cron/작업스케줄러로 주기 실행 가능).
- `collectAll()` 자체 로직은 **변경 없음** — storage가 async가 되며 이미 `await` 호출 중이라 그대로 동작.
- (선택) 나중에 자동화하려면: GitHub Actions cron, 또는 로컬 OS 스케줄러.

---

## 5. 덩어리 C — Vercel 읽기 API

### C-1. Express를 서버리스 핸들러로
- 신규 `api/index.ts`:
  ```ts
  import express from "express";
  import { registerRoutes } from "../server/routes";
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  await registerRoutes(/* httpServer 불필요하게 */ app);
  export default app;   // @vercel/node가 (req,res)로 호출
  ```
  - `registerRoutes(httpServer, app)` 시그니처에서 httpServer 인자는 미사용에 가까움
    (WebSocket 미사용) → API용으로 app만 받는 경량 버전으로 정리 권장.
- `server/index.ts`(상시 listen 서버)는 **로컬 dev 전용**으로 남김. Vercel은 `api/`를 진입점으로 씀.
- `server/vite.ts`, `server/static.ts`는 Vercel 경로에서 사용 안 함(정적 파일은 Vercel이 직접 서빙).

### C-2. 쓰기 라우트 처리(조회 전용 정책)
- `POST /api/collect`: Vercel에서 **비활성/501 반환** 또는 라우트 미등록.
  (실수로 호출돼 타임아웃 나는 것 방지. UI의 "지금 수집" 버튼도 §6에서 처리)
- `POST /api/seed`: 로컬 전용으로 두는 게 안전(프로덕션 노출 비권장).
- 관리성 쓰기(accounts/tickers/settings POST·PATCH·DELETE): 기본은 로컬에서.
  Vercel에도 두고 싶으면 가능하나 인증이 없으므로(아래 §8 보안) 주의.

### C-3. `vercel.json`
```jsonc
{
  "buildCommand": "vite build",        // 클라이언트만 빌드 (server esbuild 불필요)
  "outputDirectory": "dist/public",
  "functions": { "api/index.ts": { "maxDuration": 10 } },
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api" }]
}
```
- 정적 SPA fallback은 Vercel이 자동 처리(또는 rewrites로 `/(.*)` → index.html).

---

## 6. 덩어리 D — 프론트엔드 API_BASE

- 현재 [client/src/lib/queryClient.ts](../client/src/lib/queryClient.ts) 3번째 줄:
  `const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";`
  (빌드 타임 문자열 치환 트릭)
- Vercel은 프론트와 API가 **같은 오리진**(둘 다 같은 vercel.app)이므로
  → `const API_BASE = "";` (상대경로)로 단순화하면 충분.
- 만약 프론트/API를 다른 도메인으로 분리한다면 `import.meta.env.VITE_API_BASE` 사용 + CORS 설정.
  (기본 계획에선 같은 오리진이라 불필요.)
- **UI "지금 수집" 버튼(Settings/Layout):** 조회 전용 배포에선 동작 안 하므로
  - 버튼 숨김 또는 "수집은 로컬 워커에서 실행됩니다" 안내로 변경 권장.
  - `client/src/pages/Settings.tsx`, `client/src/components/Layout.tsx` 확인 필요.

---

## 7. 덩어리 E — DB 스키마 적용 & 배포 순서

1. **Supabase 프로젝트 생성** → `DATABASE_URL` 2종 확보
   - 직결(5432): drizzle push/migrate용
   - 풀러(6543, pgbouncer): 서버리스 런타임용 (`?pgbouncer=true`)
2. 로컬에서 `drizzle.config.ts` 전환 후 **`npm run db:push`** → Supabase에 테이블 생성
   - 부트 시 raw `CREATE TABLE`(storage.ts migrate) 제거했으므로 push가 스키마 소스
3. (선택) 기존 `data.db` 데이터 이전이 필요하면 별도 이행 스크립트 작성
   (개인용/더미면 생략하고 `npm run collect`로 새로 채워도 됨)
4. 로컬 검증: `npm run dev` + `npm run collect`로 read/write 동작 확인
5. **Vercel 환경변수 설정:** 런타임용 `DATABASE_URL`(풀러), 필요시 `APIFY_TOKEN`(읽기엔 불필요)
6. Vercel 배포 → 프론트 + 읽기 API 확인
7. 수집은 로컬/워커에서 `npm run collect` 주기 실행

---

## 8. 리스크 / 체크리스트

- [ ] **bigint 정밀도:** unix ms는 안전(2^53 미만). tweetId는 이미 `text`라 OK.
- [ ] **pg COUNT가 string으로 반환** → 기존 `Number()` 래핑 유지로 흡수 확인.
- [ ] **서버리스 커넥션 폭증:** 반드시 Supabase 풀러(pgbouncer) + `prepare:false` 사용.
- [ ] **보안:** 현재 API에 인증이 없음(passport 템플릿만 잔존, 미사용).
      Vercel에 공개되면 누구나 accounts/tickers 조작 가능 →
      쓰기 라우트는 로컬 전용으로 두거나, 최소한의 토큰 헤더 보호 권장.
- [ ] **`server/index.ts`의 reusePort/host 옵션**은 Vercel에서 무의미 → api 핸들러엔 불포함.
- [ ] **build.ts**는 자체 호스팅(VM)용 번들러. Vercel 경로에선 사용 안 함(클라이언트는 vite build).
- [ ] **CORS:** 같은 오리진이면 불필요. 도메인 분리 시에만 추가.

---

## 9. 변경 파일 목록(예상)

**수정**
- `shared/schema.ts` — pg 타입 치환
- `server/storage.ts` — postgres-js 드라이버 + 전면 async + raw SQL 2곳 번역
- `drizzle.config.ts` — postgresql dialect + DATABASE_URL
- `server/routes.ts` — (경량) app만 받도록 시그니처 정리, collect/seed 라우트 게이팅
- `client/src/lib/queryClient.ts` — API_BASE 단순화
- `client/src/pages/Settings.tsx`, `client/src/components/Layout.tsx` — "지금 수집" UI 처리
- `package.json` — `postgres` 의존성 추가, `collect` 스크립트 추가, (선택) better-sqlite3 제거

**신규**
- `api/index.ts` — Vercel 서버리스 진입점
- `script/collect.ts` — 수집 워커 CLI
- `vercel.json` — 빌드/함수/rewrite 설정
- `.env.example` 갱신 — `DATABASE_URL` 추가

**그대로(로직 변경 없음)**
- `server/apify.ts`, `server/extract.ts`, `server/seed.ts` (storage async화에 자동 적응)
- 클라이언트 페이지/컴포넌트 대부분

---

## 10. 권장 진행 순서(작게 쪼개 검증)

1. **A 먼저, 로컬에서 끝까지 검증** — Postgres로 `dev`+`collect` 둘 다 정상 동작 확인
   (여기까지가 위험의 80%. 배포는 그다음.)
2. **B (collect 워커 분리)** 확정
3. **C+D+E (Vercel)** — 읽기 API/프론트 배포
4. 보안(§8) 최소 조치

> 1번(DB 전환)만 끝나도 "원복 vs 진행" 판단이 명확해진다. 로컬에서 Postgres로 잘 돌면
> 나머지는 배포 설정 작업이라 리스크가 낮다.
