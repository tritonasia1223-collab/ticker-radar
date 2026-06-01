# 배포 상태 및 문제 진단

> 최종 업데이트: 2026-06-01
> 작업: Ticker Radar 를 Vercel + Supabase(Postgres) 로 배포

---

## 0. ✅ 해결됨 (2026-06-01)

API 500(`FUNCTION_INVOCATION_FAILED`)의 **근본 원인 2가지를 로컬에서 Vercel 함수 환경을 재현해 확정**하고 수정 완료. 커밋 `ad42d7d`.

**원인 ① (주범) — 함수 번들에 server/·shared/ 미포함**
`@vercel/node` 가 `.ts` 진입점만 트랜스파일하고 거기서 import 하는 `server/*.ts` 를 함수 패키지에 동봉하지 못해 런타임에 `Cannot find module '/var/task/server/routes'`.
→ **해결:** 빌드 단계에서 esbuild 로 진입점을 자기완결 단일 CJS(`api/index.js`)로 사전 번들 → Vercel 트레이싱 자체를 우회.

**원인 ② (숨은 지뢰) — storage.ts top-level throw/connect**
`server/storage.ts` 가 import 즉시 `DATABASE_URL` 체크 후 `postgres()` 연결을 열어, env 미주입 시 함수가 import 단계에서 사망.
→ **해결:** `db` 를 Proxy 기반 lazy init 으로 변경 → 첫 쿼리 시점에만 연결. DATABASE_URL 없이도 import 성공 검증 완료.

**변경 파일:** `api/_handler.ts`(구 index.ts), `api/package.json`(type:commonjs), `script/build-vercel.mjs`, `vercel.json`, `server/storage.ts`

**로컬 검증:** 번들 함수가 `/api/nonexistent`→404(라우팅 정상), `/api/settings`→실제 DB 쿼리 실행(연결만 가짜라 실패) 확인. `tsc --noEmit` 0 에러. `npm ci --dry-run` 통과.

**남은 작업:** Vercel 대시보드에서 `DATABASE_URL` 환경변수가 Production + Preview 양쪽 scope 에 들어있는지 확인 후 재배포. (코드 측 문제는 모두 해결됨)

---

## 1. 한 줄 요약 (이전 기록)

DB 마이그레이션과 로컬 동작은 **완료·검증됨**. Vercel 배포에서 프론트엔드(정적 화면)는 뜨지만,
**API 서버리스 함수가 `FUNCTION_INVOCATION_FAILED`(500)** 로 죽는 문제 → **위 0번에서 해결됨.**

---

## 2. 완료된 것 (검증됨)

| 항목 | 상태 | 증거 / 비고 |
|---|---|---|
| DB 마이그레이션 (SQLite → Postgres) | ✅ | `shared/schema.ts` pgTable, `server/storage.ts` postgres-js + async |
| raw SQL 번역 (surge/timeline) | ✅ | `string_agg`, `to_timestamp` 로 변환, 로컬에서 결과 정상 |
| Supabase 연결 | ✅ | PostgreSQL 17.6, **Session Pooler** 호스트로 연결 성공 |
| 테이블 생성 (7개) | ✅ | accounts, tweets, tickers, mentions, sync_logs, settings, users |
| 시드 데이터 | ✅ | accounts:5, tweets:16, mentions:16 (NVDA surge=40) |
| 로컬 API 검증 | ✅ | `/api/stats`, `/api/surge`, `/api/accounts` 전부 HTTP 200 |
| 수집 워커 분리 | ✅ | `script/collect.ts`, `npm run collect` |
| 배포 코드 | ✅ | `api/index.ts`, `vercel.json`, 프론트 `API_BASE=""` |
| GitHub 푸시 | ✅ | master 반영 |
| 레포 public 전환 | ✅ | Hobby 플랜의 private 협업 배포 차단 해제 |
| Vercel 프론트엔드 | ✅ | 루트 페이지 HTTP 200 (UI 레이아웃 표시됨) |
| Vercel 환경변수 | ✅ | `DATABASE_URL`(pooler), `DEPLOY_TARGET=vercel` 설정됨 |

---

## 3. 미해결 문제

### 증상
- `https://ticker-radar-five.vercel.app/` → **200 (프론트 정상)**
- `https://ticker-radar-five.vercel.app/api/*` → **500 `FUNCTION_INVOCATION_FAILED`**
- 결과: 모든 데이터 화면(종목 발견/피드/계정)이 비거나 에러

### 밝혀낸 근본 원인
진단용 JSON 핸들러를 임시로 심어 실제 런타임 에러를 1회 포착:
```
Cannot find module '/var/task/server/routes'
imported from /var/task/api/index.js
```
→ **Vercel 이 `api/index.ts` 를 함수로 번들할 때, 그 함수가 import 하는
`server/` 와 `shared/` 디렉터리를 함수 패키지에 포함시키지 못함.**
로컬에서는 전체 디렉터리가 있으니 동작하지만, Vercel 함수는 자기 범위만
들고 가서 cross-directory import 가 깨진다. 즉 **코드 로직이 아니라
Vercel 의 함수 번들링(파일 트레이싱) 범위 문제.**

---

## 4. 시도한 해결책과 결과

| # | 시도 | 결과 |
|---|---|---|
| 1 | `registerRoutes` async → 동기 변환 | 효과 없음 (원인 아니었음) |
| 2 | `@shared/*` alias → 상대경로(`../shared`) | 부분적 개선, 방향은 맞음 |
| 3 | api 핸들러에 동적 import + JSON 진단 | **진짜 원인 메시지 포착** (위 3번) |
| 4 | `vercel.json` `includeFiles: server/**` | 추측성, 미해결 |
| 5 | `includeFiles` 제거 | 추측성, 미해결 |

> ⚠️ 진행 방식 반성: 위 시도들을 push→재배포 대기 반복으로 빠르게 5회 푸시 →
> 히스토리가 어지러워짐. 이후로는 **로컬에서 완전히 검증 후 1회만 푸시**하는 방식으로 전환.

### 막판에 시도하다 중단한 접근 (미완성, 파일은 삭제함)
- esbuild 로 함수를 단일 파일로 **사전 번들**(`server/*`, `shared/*` 인라인)해서
  Vercel 의 디렉터리 트레이싱 자체를 우회하는 방법.
- 관련 임시 파일(`api/_bundle.js`, `script/build-api.mjs`, `script/test-bundle.mjs`)은
  미완성이라 커밋하지 않고 삭제함.

---

## 5. 남은 과제 (단 하나)

**"Vercel 함수가 `server/` + `shared/` 코드를 포함하도록 만들기."** 이것만 해결하면 배포 완료.

### 후보 해법
1. **esbuild 사전 번들** (유력) — 함수 진입점을 빌드 단계에서 한 파일로 인라인 번들.
   모든 로컬 import 가 inline 되어 Vercel 의 파일 트레이싱이 불필요해짐.
   `vercel.json` 의 `buildCommand` 에 번들 스텝 추가. → 로컬에서 번들+테스트 후 1회 푸시.
2. **함수 자족 구조 재설계** — `api/` 안에 필요한 코드를 두거나, 트레이싱이 잘 되는
   정적 import 구조로 단순화.
3. **Vercel 빌드 로그 직접 확인** — 대시보드 Deployments → 최신 배포 → Functions/Build
   로그를 보고 번들에 무엇이 빠졌는지 1차 확인 후 정확히 대응.

---

## 6. 현재 코드 상태 (참고)

- GitHub master = 로컬 HEAD (커밋 `72cc5a7`), 푸시 누락 없음.
- `api/index.ts`: 정적 import + try/catch JSON 진단 핸들러 형태.
- `vercel.json`: `buildCommand: vite build`, `outputDirectory: dist/public`,
  함수 `api/index.ts` (maxDuration 10), `/api/(.*)` → `/api` rewrite.
- 환경변수는 Vercel(Production)에 설정됨: `DATABASE_URL`(pooler), `DEPLOY_TARGET=vercel`.

---

## 7. 알아둘 환경 메모

- **Supabase Direct 연결(`db.<ref>.supabase.co:5432`)은 이 환경에서 DNS 미해석(ENOTFOUND)** →
  반드시 **Session Pooler**(`aws-1-ap-south-1.pooler.supabase.com:5432`, 유저 `postgres.<ref>`) 사용.
- 서버리스 런타임에서는 pooler + `postgres(url, { prepare:false })` 필요(이미 적용됨).
- 로컬 dev: `reusePort` 는 Linux 전용이라 Windows 에선 비활성화하도록 처리됨.
- `drizzle-kit push` 는 이 환경에서 SQLite 드라이버를 찾는 버그가 있어, 테이블은
  동일 스키마의 직접 SQL(`CREATE TABLE IF NOT EXISTS`)로 생성함.
