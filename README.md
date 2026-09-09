# 피스쿠스 · FISCUS

거시경제의 흐름과 역사, 세계 인프라를 함께 살펴보고 해석을 기록하는 **개인용 금융 리서치 웹사이트**입니다. 폴더와 일부 작업 이름에는 초기 이름인 ticker-radar가 남아 있습니다.

## 현재 개발 범위

| 모듈 | 경로 | 상태·기능 |
|---|---|---|
| 자본주의 경제사 | /#/capitalism | **메인** — 사건·원인·결과 편집, 19종 거시지표, 인사이트·표·이미지·HTML 블록 |
| 미국 유동성 | /#/fed | **메인** — 연준 대차대조표, 준비금 변화, 재무부 국채 수급 |
| 세계 현황판 | /#/world | **메인** — 무역·분쟁·AI 데이터센터·전력망·원전·반도체 팹 |
| 종목 발견·추적 계정 | /#/, /#/accounts | 개발 보류. 메뉴와 수집 기능 유지 |
| 정치인·내부자 거래 | /#/congress, /#/insider | 개발 보류. 코드와 기존 정기 수집 설정 유지 |
| 관심종목 | /#/interest | 메뉴 숨김, 라우트 유지 |
| CLO·블록체인 학습 | — | 개발 보류, 메뉴·라우트 비활성, 소스 보존 |

전역 라이트/다크 테마와 발표 모드를 제공합니다. 개발 보류와 정기 수집 중지는 별개입니다. 실제 연결은 client/src/App.tsx와 components/Layout.tsx, 수집 일정은 .github/workflows/가 기준입니다.

## 구조

- **프런트:** React 18, TypeScript, Vite, wouter hash 라우팅, TanStack Query, Tailwind/shadcn UI, Recharts, D3.
- **API:** Express 5. 로컬 진입점 server/index.ts, Vercel 진입점 api/index.ts.
- **저장:** Drizzle + Supabase PostgreSQL. 경제사 cap_* 및 유동성 fed_balance_sheet 테이블.
- **정적 데이터:** client/src/data/. 경제사 시계열은 별도 JSON 에셋을 로드하고, 세계 현황판은 저장소의 지리·조사 데이터를 사용합니다.
- **배포:** Vercel 정적 프런트 + 서버리스 API. 오래 걸리는 수집은 CLI/GitHub Actions에서 실행합니다.

## 로컬 실행

Node.js와 npm을 설치한 뒤 프로젝트 루트에서 `npm install`을 실행하고 .env에 DATABASE_URL을 설정합니다. 메인 화면 조회에는 SNS 수집 키가 필요하지 않습니다.

PowerShell:

```powershell
$env:NODE_ENV = 'development'
$env:PORT = '5000'
npx tsx server/index.ts
```

macOS/Linux: `npm run dev`

접속: http://localhost:5000/#/capitalism. dev/start 스크립트는 bash 환경변수 문법이므로 PowerShell에서는 위처럼 실행합니다. 세계 현황판은 DB 없이 표시되지만 경제사·유동성은 DB 연결이 필요합니다.

## 검증과 유지보수

```sh
npm run check
npm test
npm run build
```

| 명령 | 용도 |
|---|---|
| npm run cap:backup | 경제사 전체 데이터의 로컬 백업. 운영 데이터 변경 전 실행 |
| npm run cap:integrity | 최신 백업 대비 카드·노드 손실 검사. 정상 0 / 손실·실패 1 / 백업 없음 2 |
| npm run cap:collab:init | 협업 이력·접속 표시 테이블 2개만 추가 |
| npm run cap:collab:test-db | 기존 데이터와 분리한 임시 스키마에서 실제 동시 저장 검증 후 정리 |
| npm run cap:versions | 사건별 저장 이력 도구. 인자는 script/cap-versions.ts 참고 |
| npm run cap:series | 경제사 정적 시계열 갱신 |
| npm run fed:backfill -- --only weekly --recent 35 | 연준 주간 관측 수집 |
| npm run fed:backfill -- --only mspd --recent 70 | 재무부 월간 관측 수집 |
| npm run fed:verify | DB에 저장된 유동성 데이터 검증 |
| npm run world:build / us:build / tx:build / rto:build / conflicts:build / nuclear:build | 지도 자료별 재생성. 해당 스크립트의 입력·출처를 먼저 확인 |

`npm test`는 기존 블록체인 수수료 테스트와 경제사 저장·Undo, 유동성 결측·날짜 간격, 무결성 종료 상태 회귀 테스트를 실행합니다.

브라우저 재현은 `npx tsx script/stability-fixture.ts`로 메모리 API 서버를 실행한 뒤 http://127.0.0.1:5178/#/capitalism 에서 합니다. 이 서버는 운영 DB에 연결하지 않고, 미구현 API를 운영 서버로 전달하지 않습니다. 다시 시작하면 합성 데이터가 초기화됩니다. 상세 결과는 [안정화 변경 기록](docs/STABILITY-CHANGES-2026-09-09.md)을 참고하세요.

백업·이력·조사 원본은 임시 파일이 아닙니다. script/cap-backup.*.json, script/cap-history/, script/cap-export/는 로컬 보존 및 gitignore 대상입니다. **공유 Supabase에 drizzle-kit push를 실행하지 않습니다.** 운영 DDL은 기존의 명시적 script/db-push-*.ts 등을 사용합니다.

Fed 워크플로는 목요일 22:30 UTC에 연준 주간·재무부 월간 자료를 수집하고 검증합니다. 경제사 시계열과 지도 자료는 재생성 및 배포 후 갱신됩니다.

## 문서

- [문서 색인](docs/INDEX.md) — 현재 안내와 과거 계획 구분
- [2인 협업 편집](docs/COLLABORATION.md) — 자동 병합·충돌 선택·기기 초안 복구·변경 이력
- [경제사 구조](docs/CAPITALISM.md), [미국 유동성](docs/FED.md), [세계 현황판](docs/WORLD.md)
- [안정성 점검 기록](docs/STABILITY-AUDIT-2026-09-09.md)
- [보류 기능의 과거 안내](docs/LEGACY-TRACKING.md) — SNS·정치인·내부자 거래 및 수집 키

운영 배포는 master 푸시와 연결되어 있습니다. 로컬 수정·검증과 운영 수집·배포를 구분합니다.
