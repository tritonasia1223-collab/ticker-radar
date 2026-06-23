# ticker-radar — 작업 가이드

통합 금융 대시보드: **정치인 거래 / 내부자 거래 / SNS 인플루언서 / 자본주의 경제사** 4개 모듈.
작업 브랜치: `master`(= Vercel Production Branch). **master 에 커밋·푸시하면 곧장 프로덕션 자동 배포**(`ticker-radar-five.vercel.app`) — 별도 머지 단계 없음. 피처 브랜치 푸시는 비공개 Preview만 만들어지니 평소엔 master 에서 바로 작업. 커밋 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## 스택
React 18 + Vite + TS, wouter(#hash 라우트), @tanstack/react-query, shadcn/ui(@radix-ui),
TailwindCSS(darkMode class), Recharts. Express 5, Drizzle ORM → Postgres(Supabase 세션 풀러).
postgres.js: bigint는 **문자열**로 반환됨(`::float8` 캐스트 필요), 클라이언트 `{prepare:false, max:3, idle_timeout:20}`.

## 핵심 경로
- `server/storage.ts` — 서버측 집계 + **내부자 스코어링 엔진**(클러스터/랭킹). 점수 로직의 단일 출처.
- `client/src/pages/Insider.tsx` / `Congress.tsx` — UI. `client/src/lib/format.ts` — 도메인 무관 표시 유틸(공유).
- `script/` — 수집/보강(collect-*, enrich-*) + **검증 하네스**(아래).
- 수집 주기는 **비대칭**(소스 신선도에 맞춤): 내부자 Form4 = **일 1회**(`.github/workflows/insider.yml`, 03:00 UTC — 클러스터 매수 알파가 공시 직후 수일에 가장 강함, T+2라 인트라데이는 무의미) / 정치인 PTR = **주 1회**(`congress.yml` — 최대 45일 지연이라 충분). 둘 다 수집 직후 `npm run healthcheck`(#27) 자동, orphan B(진짜깨짐)>0면 RED. 겹침-증분 멱등은 external_id 유니크(`uniq_itrade_ext`)가 보장.
- 데이터: 정치인·내부자는 완전 분리(DB 테이블·API 라우트·페이지 파일). format.ts 유틸만 공유.
- **자본주의 경제사**(`/capitalism`) — 4번째 모듈, 위 3개와 완전 분리(테이블 `cap_*`·라우트 `/api/capitalism/*`·컴포넌트 `Cap*`). 전후 달러 패권사를 인과 플로우 타임라인 + 전 구간 FRED 거시지표(정적 JSON `client/src/data/capitalism-series.json`, 런타임 fetch 0) + 사건별 인사이트로 편집·열람. 서버 `server/capitalism.ts`(upsert/delete 는 트랜잭션). `/capitalism` 라우트는 `React.lazy` 코드 스플릿(357KB JSON·framer-motion 분리). 입력 사건 데이터(현재 1968~1994) **손실 금지**, 시드는 전부 비파괴. **상세: `docs/CAPITALISM.md`**.

## 내부자 클러스터 점수 (현재 레버)
방향(매수×2) × Σ(티어가중 × 보유대비배율 × 절대규모log) / √n × thin페널티, 클래스캡·post0게이트.
- 티어 가중: T1 전사·재무 1.0 / 대주주 0.9 / T2 운영 0.7 / T3 기능 0.4 / 미확인 0.3 / T4 이사 0.25
- 보유대비 배율: >50% ×1.5 / 10–50% ×1.0 / <10% ×0.5 (분모 = change/pre)
- thin(n=2): **percap 비례** 0.65~0.90 (개수 아닌 1인당 시그널 강도에 연동)
- 클래스캡: 10%Owner의 ≥80% 매도 → 배율 ≤1.0 (PE 블록청산은 컨빅션 아님)
- joint-filer dedup: 엔티티+지배인 동일포지션 중복신고를 대표 1행으로 (가짜 합의 차단)
- cross-ticker dedup(#24): 듀얼클래스 한 Form4가 양쪽 클래스 티커(FOX/FOXA·BABA/BABAF·GOOG/GOOGL)로 이중계상되는 것 제거 — accession(SEC 전역유일)이 ≥2 심볼이면 동일제출 확정, canonical 1벌만 집계에 보존(query-time, 비파괴). canonical = **healthy인사이더 desc → 행수 desc → 심볼길이 asc → 사전순** = 전함수(외부 거래량피드·쌍별 예외 금지, 미래 쌍 자동 커버). ⚠ **FOX(not FOXA)는 이 규칙의 의도된 결과** — healthy 대칭이라 어휘규칙으로 갈릴 뿐 금액·인원·점수 동일한 **표시 전용** 차이. **쌍별 override 추가 금지**(선례 되어 쌍별 하드코딩으로 회귀); 라벨 불만은 표시 레이어 별칭으로. 검증: `script/orphan-classify.ts`(읽기전용, ②축).

---

# 🔧 스코어링 레버 작업 규약 (필수)

점수 로직(`server/storage.ts`)을 건드릴 때 **반드시** 이 순서를 따른다. 이전 세션들에서
이 방법으로 잘못된 처방 두 개(분모 과소·캡 강화)를 걷어내고 진짜 원인(joint-filer 중복)에 도달했다.

### 1. 네거티브 컨트롤이 처방을 증명한다
레버의 정당성은 **"올라가야 할 게 올라갔다"가 아니라 "눌리면 안 되는 게 안 눌렸다"**로 증명한다.
- 예) #21 thin→percap: 고위직 푼돈매도(PHR/MORN, percap<0.5)가 ×0.65 **유지**됨 → percap축이 티어축보다 옳다는 증거.
- 예) #22 dedup: 자연인 임원 7인(ESLT, 동일수량 3인 포함)이 **병합 안 됨** → 실제 합의 파괴 0.
- 레버를 만질 때마다 "이 변경이 건드리면 안 되는 케이스"를 먼저 정하고, diag로 그게 불변임을 확인한 뒤 커밋.

### 2. 인프라 짓기 전에 반증 테스트
큰 작업 후보(데이터 인제스천·EDGAR 파이프라인 등)가 보이면, **빌드 전에 최선 시나리오 시뮬레이션**으로
그게 실제로 증상을 고치는지부터 반증한다.
- 예) #22: 30분짜리 시뮬(분모 m=0.5 best-case)이 EDGAR rptOwnerCik 파이프라인 며칠치를 죽였다 —
  분모 가설 자체가 반증되고 "데이터 보강"이 "레버 하나"로 바뀌었다.
- 순서: 최선 시나리오 시뮬 → (효과 확인되면) 빌드. 반대 순서 금지.

### 3. 검증은 하네스로만 — 일회성 점수 복제 스크립트 금지
점수 로직을 복제하는 일회성 sim/probe 스크립트를 **새로 만들지 말 것**(TS·SQL 두 곳에 로직이 살면 drift).
검증은 아래 영구 하네스만 사용/확장한다:
- `script/diag-clusters.ts` — 레버 before/after 줄세움. 고티어 n=2 순위, 하단30 불변, percap 분포, 지목종목 추적.
- `script/dedup-report.ts` — 전 테이블 joint-filer 충돌 그룹(이름·accession·수량). drift 0(raw 쿼리, 점수 복제 없음).
- 새 검증이 필요하면 이 둘을 확장. 자기만의 검증 스크립트를 짜지 말 것.

### 4. 레버는 하나씩, 검증 후 커밋
한 커밋에 검증면 하나. 여러 레버를 섞지 말고, 각 레버를 diag로 검증한 직후 커밋.
알려진 잔여 이슈는 **커밋 메시지에 명시**하고 후속 태스크로 등록(침묵 출하 금지).

### 제약
- 공유 Supabase에 **대량 파괴적 UPDATE 금지**(분류기가 차단). 비파괴 query-time 가드로 처리.
- **공유 Supabase에 `drizzle-kit push` 절대 금지**(#26). 전-DB diff 라 미선언 테이블을 `DROP ... CASCADE` 로 날린다(=insiders orphan #23~#26 근본원인). 운영 DDL 은 raw 스크립트로만: `script/db-push-*.ts`(CREATE TABLE IF NOT EXISTS) · `script/db-fk-insider.ts`(ADD CONSTRAINT). `npm run db:push` 는 가드(db-push-guard)로 차단. FK 는 부분 보호일 뿐(평 DROP만 차단, CASCADE 못 막음) — 진짜 방어는 이 도구운용 규약 + FK + orphan 헬스체크(#27).
- 시크릿/.env 는 gitignore 유지. 절대 커밋 안 함.
- bash cwd가 가끔 리셋됨 → `cd /c/Users/1/Desktop/ticker-radar &&` 프리픽스로 실행.
