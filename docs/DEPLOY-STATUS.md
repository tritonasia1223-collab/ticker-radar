# 배포 상태 및 문제 진단

> 최종 업데이트: 2026-06-01
> 작업: Ticker Radar 를 Vercel + Supabase(Postgres) 로 배포
> 상태: **✅ 완전 해결 — 프론트 + API + DB 전부 정상 동작**

---

## 0. 최종 결론

`https://ticker-radar-five.vercel.app` 에서 프론트엔드, `/api/*` 서버리스 함수, Supabase
DB 연결까지 **모두 정상**. 계정 추가/삭제(쓰기)·종목 발견(읽기) 실제 동작 확인.

핵심 교훈: **문제는 처음부터 "코드 로직"이 아니라 "Vercel 서버리스 함수가 우리 코드를
어떻게 빌드/로드하느냐"였다.** 에러가 한 겹씩 벗겨지며 3단계로 드러났고, 모두 해결됨.

---

## 1. 실제 해결 과정 (에러 3겹)

> ⚠️ 아래는 이 문서의 **이전 버전이 제안했던 "esbuild 사전 번들" 접근을 폐기**하고
> 도달한 최종 해법이다. esbuild 번들은 Vercel 의 함수 "탐지"를 깨뜨려 오히려 막혔다.

### ① 빌드 실패 — `functions` 패턴이 매칭 안 됨
```
The pattern "api/index.js" defined in `functions` doesn't match any Serverless Functions
```
- 원인: 빌드에서 esbuild 로 `api/index.js` 를 생성했지만 그 파일은 **`.gitignore` 처리**되어
  소스에 없었고, 핸들러 `api/_handler.ts` 는 **밑줄 접두사라 Vercel 이 함수로 무시**.
  → Vercel 이 인식하는 함수가 0개인데 설정은 없는 파일을 가리킴.
- **해결 (커밋 `5849404`)**: esbuild 사전 번들을 **걷어내고 Vercel 네이티브 방식으로**.
  - `api/_handler.ts` → `api/index.ts` (밑줄 제거 → 자동 함수 탐지)
  - `vercel.json`: `buildCommand: "vite build"`, `functions` 블록 제거
  - `script/build-vercel.mjs`·`.gitignore`의 `api/index.js` 정리

### ② 런타임 크래시 — ESM/CJS 형식 충돌
```
SyntaxError: Cannot use import statement outside a module  (/var/task/api/index.js)
```
- 원인: `api/package.json` 이 `type: commonjs`(구 esbuild CJS 잔재)인데, 루트는
  `type: module` 이고 `@vercel/node` 출력은 ESM → Node 가 ESM 을 CJS 로 로드하려다 즉사.
- **해결 (커밋 `ec45189`)**: `api/package.json` → `{ "type": "module" }`.

### ③ 런타임 크래시 — ESM 확장자 누락
```
ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/server/routes'
```
- 원인: 네이티브 ESM 런타임은 상대경로 import 에 **확장자 필수**. 코드의
  `import ... from "../server/routes"` (확장자 없음)를 Node 가 못 찾음.
- **해결 (커밋 `0e1f377`)**: `api/`·`server/`·`shared/` 의 모든 상대 import 에 `.js` 추가.
  (`moduleResolution: bundler` 라 tsc 통과, `tsx`/esbuild 는 `.js`→`.ts` 로 해석 → dev/build 무탈)

### (선행 수정) storage 즉시 연결 제거
- `server/storage.ts` 가 import 즉시 `DATABASE_URL` 체크 + `postgres()` 연결을 열어
  env 미주입 시 import 단계에서 사망 → **Proxy 기반 lazy init** 으로 변경(첫 쿼리 때만 연결).

---

## 2. 어떻게 검증했나 (추측 push 금지)

초반엔 push→재배포 대기를 반복(5회)하며 히스토리만 어지럽혔다. 이후로는
**로컬에서 Vercel 런타임을 재현**해 고치기 전/후를 확인하고 1회만 push 하는 방식으로 전환:

```bash
# @vercel/node 처럼 api+server+shared 를 번들 없이 ESM 으로 transpile 후 Node 로 로드
npx esbuild $(find api server shared -name '*.ts') --outdir=.fnsim \
  --format=esm --platform=node --target=node20
node --input-type=module -e "import('./.fnsim/api/index.js')"
```
이게 `ERR_MODULE_NOT_FOUND` 를 그대로 재현했고, `.js` 추가 후 `LOADED OK` 로 통과하는 걸
확인한 뒤 push 했다. `tsc --noEmit` + `vite build` 도 매번 통과 확인.

---

## 3. 완료된 것 (검증됨)

| 항목 | 상태 | 비고 |
|---|---|---|
| DB 마이그레이션 (SQLite → Postgres) | ✅ | `shared/schema.ts` pgTable, postgres-js |
| Supabase 연결 | ✅ | **Session Pooler** + `postgres(url, { prepare:false })` |
| Vercel 함수 빌드/로드 | ✅ | 네이티브 `@vercel/node`, ESM, `.js` 확장자 |
| `/api/*` 런타임 | ✅ | 계정 CRUD·surge·stats 실제 200 |
| Vercel 환경변수 | ✅ | `DATABASE_URL`(pooler) Production+Preview, `DEPLOY_TARGET=vercel` |
| 수집 워커 분리 | ✅ | `npm run collect` (Vercel 함수에선 비활성) |
| 수집: 날짜창 + 증분 | ✅ | 검색모드 `from:h since:날짜 -filter:replies` (커밋 `a01c8db`) |

---

## 4. 현재 배포 구성 (참고)

- `vercel.json`: `buildCommand: "vite build"`, `outputDirectory: "dist/public"`,
  `framework: null`, rewrite `"/api/(.*)" → "/api"`. (`functions` 블록 없음 — Hobby 기본 10s)
- `api/index.ts`: Express 앱을 만들어 단일 함수로 서빙 (`export default handler`).
- `api/package.json`: `{ "type": "module" }`.
- 환경변수(Vercel Production): `DATABASE_URL`(pooler), `DEPLOY_TARGET=vercel`.
- 수집은 **로컬에서만** (`npm run collect`) — Apify 는 서버리스 10s 안에 못 끝내므로
  함수에선 `DEPLOY_TARGET=vercel` 로 막고, 같은 Supabase 에 로컬이 써넣는 구조.

---

## 5. 알아둘 환경 메모

- **Supabase Direct 연결(`db.<ref>.supabase.co:5432`)은 DNS 미해석(ENOTFOUND)/hang** →
  반드시 **Session Pooler**(`aws-1-ap-south-1.pooler.supabase.com:5432`, 유저 `postgres.<ref>`).
- 서버리스 런타임에서는 pooler + `prepare:false` 필수(적용됨).
- 로컬 dev: `reusePort` 는 Linux 전용 → Windows 에선 비활성화 처리.
- `drizzle-kit push` 가 이 환경에서 SQLite 드라이버를 찾는 버그 → 테이블은 직접 SQL 로 생성.
- **수집 actor(`apidojo/tweet-scraper`) 주의**: `start`/`end` 날짜 필터는 `twitterHandles`(프로필)
  모드에서 **무시**되고 전체 타임라인을 긁는다. 날짜 필터는 **검색 모드**(`searchTerms:
  ["from:핸들 since:날짜"]`)에서만 작동 → 그래서 수집을 검색 모드로 구현함.
