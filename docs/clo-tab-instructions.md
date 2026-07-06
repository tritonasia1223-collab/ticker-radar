# Ticker Radar — CLO 모니터 탭 구현 지시문

## 0. 프로젝트 컨텍스트

ticker-radar에 세 번째 도메인 탭 "CLO"를 추가한다. 기존 두 탭(내부자 Form 4, 의회 거래)이 "거래 이벤트 스트림 + 스코어링" 모델인 것과 달리, CLO 탭은 **"상태 스냅샷 시계열"** 모델이다. 목적은 트러스티 리포트(투자자 전용, 접근 불가) 없이 공개 파편 데이터 — CLO ETF 일간 보유내역, EDGAR N-PORT, 평가사 서베일런스 수치 — 를 모아 CLO 시장의 딜 유니버스와 담보 건전성 추세를 재구성하는 것이다.

**Non-goals (구현 금지):**
- 스코어링 엔진 없음. 순수 기술(descriptive) 대시보드다.
- 트러스티 리포트·Intex 등 유료/제한 데이터 접근 시도 금지.
- 평가사 사이트 로그인 세션 자동 스크래핑 금지 (이용약관 리스크). 해당 데이터는 수동 입력 레이어로 처리한다.

## 1. 규약 준수 (CLAUDE.md 스코어링 레버 작업 규약 준용)

이 작업 전체에 기존 규약을 적용한다:

1. **반증 테스트가 인프라 구축에 선행한다.** 아래 Phase 0의 프로브가 실패하면 이후 Phase로 진행하지 않고 결과를 보고한 뒤 대기한다.
2. **커밋 단위는 1레버(1기능).** Phase 하나가 커밋 하나일 필요는 없지만, 하나의 커밋에 프로브와 구현을 섞지 않는다.
3. **네거티브 컨트롤.** 파서·조인 검증 시 "맞는 게 붙는가"만이 아니라 "다른 딜이 잘못 붙지 않는가"를 함께 확인한다.
4. **공유 Supabase DB에 `drizzle-kit push` 절대 금지** (#26 확정 사항). 테이블 생성은 기존 관행대로 수기 `CREATE TABLE IF NOT EXISTS` 스크립트로 한다.
5. 모든 프로브 스크립트는 삭제하지 않고 `script/` 하위에 회귀 하네스로 보존한다.

브랜치: `feat/clo-monitor`. 이슈 번호는 레포의 현재 트래커 순번에 이어서 등록한다 (아래에서는 C-0 ~ C-6으로 지칭).

## 2. 데이터 소스 명세

### 자동 수집 대상 (Phase 0~5)

**(A) CLO ETF 일간 보유내역 CSV — 1차 데이터 소스**

| 티커 | 운용사 | 성격 |
|---|---|---|
| JAAA | Janus Henderson | AAA 트랜치, 최대 규모 |
| JBBB | Janus Henderson | BBB/메자닌 |
| PAAA | PGIM | AAA |
| CLOZ | Panagram | BB/메자닌 |

각 운용사 상품 페이지에서 일간 full holdings CSV/Excel 다운로드 링크를 제공한다. **URL 패턴을 하드코딩하지 말고 Phase 0에서 실측으로 확인·기록할 것.** 링크가 JS 렌더링 뒤에 있거나 일자 파라미터가 붙는 경우가 있으므로, curl로 직접 받아지는 안정 URL을 찾는 것이 프로브의 일부다.

**(B) SEC EDGAR — N-PORT (분기 포트폴리오 정본)**

- 파일 인덱스: `https://data.sec.gov/submissions/CIK##########.json` (10자리 zero-padded CIK)
- 전문 검색: `https://efts.sec.gov/LATEST/search-index?q=...` (form type NPORT-P)
- 각 ETF의 CIK는 EDGAR company search로 확인 후 상수로 기록한다 (시리즈/클래스 구조에 유의 — ETF는 트러스트 산하 시리즈로 등록된 경우가 많다).
- **필수 준수사항: 모든 요청에 `User-Agent: ticker-radar admin@<사용자이메일>` 헤더. 초당 10요청 이하. 위반 시 IP 차단됨.**
- N-PORT XML에서 추출할 필드: 종목명(title), CUSIP, ISIN, LEI, balance(액면), valUSD(평가액), 자산 카테고리.

**(C) FRED API — 시장 맥락 시계열**

- 엔드포인트: `https://api.stlouisfed.org/fred/series/observations`
- API 키 필요 → GitHub Secrets에 `FRED_API_KEY`로 등록 (사용자 작업, 아래 §7 참조)
- 최소 시리즈: `BAMLH0A0HYM2` (US HY OAS). 추가 후보는 UI 단계에서 결정.

### 수동 입력 대상 (Phase 6)

**(D) 평가사 서베일런스 수치·펀드 월간 자료**: 딜별 OC 쿠션, CCC 비중, 디폴트 자산 비율. 출처는 S&P/Moody's/Fitch/KBRA 등급조치 코멘터리, ECC 월간 업데이트, 운용사 코멘터리. 사람이 주 1회 수집해 입력하는 구조로 설계한다.

## 3. Phase 0 — 프로브 (게이트, 구현 선행 조건)

### C-0a: ETF CSV 안정성 프로브

`script/probe-clo-etf-csv.ts` 작성:
1. 4개 ETF의 보유내역 파일을 받는 안정 URL을 찾아 기록한다 (수동 브라우저 확인이 필요하면 필요한 URL 후보를 보고하고 사용자 확인을 받는다).
2. 받은 파일의 스키마를 덤프한다: 컬럼명, 행 수, CUSIP 컬럼 존재 여부, 딜명 표기 형식 샘플 10행.
3. **3영업일 이상 간격을 두고 2회 이상 수집**하여 (a) URL 불변성 (b) 스키마 불변성 (c) 일자 간 diff가 유의미하게 나오는지 확인한다. 하루 안에 끝내지 말 것 — 이 프로브의 목적이 시간 축 안정성 검증이다.

### C-0b: CUSIP 조인 프로브 — 전체 설계의 성립 조건

`script/probe-clo-cusip-join.ts` 작성:
1. JAAA의 최신 N-PORT를 EDGAR에서 받아 CUSIP 목록을 추출한다.
2. 같은 ETF의 일간 CSV에서 CUSIP(있다면)을 추출해 조인율을 측정한다.
3. **네거티브 컨트롤**: JBBB의 CUSIP 목록과 교차시켜, 다른 펀드의 트랜치가 오조인되지 않는지 확인한다 (같은 딜의 다른 트랜치는 CUSIP이 달라야 정상).

### 게이트 조건

- **Gate A (C-0a):** URL·스키마가 관측 기간 동안 불변 AND CSV 파싱 성공률 100% → Phase 1 진행. 실패 시: 실패 양상을 보고하고 대안(N-PORT 단독 분기 모델로 축소할지)을 사용자와 논의.
- **Gate B (C-0b):** CSV에 CUSIP이 존재하고 N-PORT와 조인율 ≥ 90% → 예정 스키마로 진행. CUSIP이 CSV에 없으면: 딜명 정규화 조인의 정확도를 샘플 30건 수동 검증으로 측정해 보고하고, 90% 미만이면 **진행 중단 후 사용자 결정 대기.** 딜명 퍼지매칭을 임의로 구현하지 말 것.

## 4. Phase 1 — DB 스키마 (Gate A·B 통과 후)

수기 CREATE TABLE 스크립트(`script/create-clo-tables.ts` 또는 기존 관행 위치)로 생성. `IF NOT EXISTS` 필수, 기존 테이블 무접촉.

```sql
-- 딜 마스터
clo_deals (
  id serial PK,
  deal_name text NOT NULL,        -- 정규화된 딜명 (예: "MADISON PARK FUNDING XLVIII")
  manager text,                    -- 매니저명 (딜명에서 파생, nullable)
  first_seen date NOT NULL,
  UNIQUE(deal_name)
)

-- 트랜치 (CUSIP 단위)
clo_tranches (
  id serial PK,
  deal_id int FK -> clo_deals,
  cusip text UNIQUE,
  tranche_label text,              -- "A", "B", "SUB" 등 파싱 가능하면
  isin text
)

-- ETF 일간 보유 스냅샷
clo_holdings_snapshots (
  id serial PK,
  etf text NOT NULL,               -- 'JAAA' | 'JBBB' | 'PAAA' | 'CLOZ'
  tranche_id int FK -> clo_tranches,
  as_of date NOT NULL,
  par_value numeric,               -- 액면 (소스에 있을 때)
  market_value numeric,
  weight_pct numeric,
  UNIQUE(etf, tranche_id, as_of)
)

-- 딜 건전성 스냅샷 (Phase 6 수동 입력 + 향후 확장)
clo_deal_metrics (
  id serial PK,
  deal_id int FK -> clo_deals,
  as_of date NOT NULL,
  metric text NOT NULL,            -- 'oc_cushion_pct' | 'ccc_pct' | 'default_pct'
  value numeric NOT NULL,
  source text NOT NULL,            -- 'sp_surveillance' | 'ecc_monthly' | ...
  source_url text,
  entered_by text DEFAULT 'manual',
  UNIQUE(deal_id, as_of, metric, source)
)

-- 시장 맥락
clo_market_context (
  id serial PK,
  series text NOT NULL,            -- 'HY_OAS' 등
  as_of date NOT NULL,
  value numeric NOT NULL,
  UNIQUE(series, as_of)
)
```

FK는 #26 결정에 따라 `NOT VALID`로 추가 후 별도 VALIDATE. 원시 데이터 비파괴 원칙 유지 — 소스 파싱 실패 행은 버리지 말고 `clo_ingest_errors` 테이블(raw_line, reason, as_of)에 적재한다.

## 5. Phase 2~3 — 어댑터 · 수집기 · cron

- `server/adapters/cloEtf.ts`: ETF별 CSV → 정규화 레코드. 운용사별 포맷 차이는 어댑터 내부에서 흡수하고 출력 스키마는 단일화.
- `server/adapters/fred.ts`: FRED observations → clo_market_context.
- 수집 커맨드: `collect:clo` (ETF 4종 + FRED). 멱등성 필수 — 같은 날 재실행 시 UNIQUE 제약으로 무해해야 한다 (upsert).
- **인제스트 직후 헬스체크** (#27 패턴 준용): (a) ETF별 행 수가 전일 대비 ±30% 이상 변하면 경고 (b) 신규 CUSIP 유입 수 로깅 (c) 파싱 실패율 > 5%면 경고. 결과는 기존 헬스체크 리포트 경로에 통합.
- GitHub Actions: 기존 congress cron 워크플로우를 템플릿으로 `collect-clo.yml` 작성. 평일 1회 (미 동부 기준 장 마감 후 — UTC 23:00경 권장). Secrets: `DATABASE_URL`(기존), `FRED_API_KEY`(신규).

## 6. Phase 4~5 — UI 탭 · N-PORT 파서

### C-4: CLO 탭 UI (MVP)

기존 탭 라우팅 구조에 `/clo` 추가. MVP 화면 3개 패널:

1. **딜 유니버스 테이블**: 딜명, 매니저, 추적 ETF 수, 최근 관측일, ETF 합산 보유액. 정렬·검색.
2. **보유 변화 피드**: 최근 N일간 ETF 보유 스냅샷 diff — 신규 편입 딜, 이탈 딜, 보유액 급변(±20%↑) 상위. 이 패널이 이 탭의 "시그널"에 해당한다 (ETF의 매매가 곧 시장의 선호 변화).
3. **시장 맥락 미니 차트**: HY OAS 시계열.

디자인은 기존 두 탭의 컴포넌트·스타일 관행을 그대로 따른다. 새 디자인 시스템 도입 금지.

### C-5: N-PORT 파서

- `server/adapters/nport.ts`: 분기 NPORT-P XML → 트랜치별 액면·평가액.
- 용도: (1) CUSIP 마스터 보강 (2) 일간 CSV에 없는 필드(액면) 보충 (3) CSV 데이터 교차 검증.
- 분기 1회 수동 트리거로 시작 (`collect:clo:nport`). cron 자동화는 2분기 안정 운영 후 별도 이슈로.
- 파서 검증: JAAA 최신 N-PORT 1건에 대해 보유 건수·합산 평가액이 공시 요약치와 일치하는지 확인하는 테스트를 남긴다.

## 7. Phase 6 — 수동 입력 레이어

- 입력 경로는 UI 폼이 아니라 **CSV 업로드 스크립트로 시작한다**: `script/import-clo-metrics.ts <file.csv>`. 컬럼: deal_name, as_of, metric, value, source, source_url.
- 스크립트는 deal_name을 clo_deals에 정확 일치로만 조인하고, 미일치 행은 에러 목록으로 출력한다 (자동 생성·퍼지매칭 금지 — 오염 방지).
- 입력된 수치는 딜 상세 뷰에 시계열로 표시.
- UI 입력 폼은 CSV 워크플로우가 월 2회 이상 실사용된 뒤에만 별도 이슈로 검토한다.

## 8. 사용자(트리톤) 액션 아이템

Claude Code가 진행 중 아래를 요청하면 사용자가 처리한다:

1. FRED API 키 발급 (fred.stlouisfed.org, 무료) → GitHub repo Secrets에 `FRED_API_KEY` 등록.
2. EDGAR User-Agent에 넣을 연락 이메일 1개 지정.
3. Phase 0에서 운용사 사이트의 CSV 다운로드 링크 확인이 브라우저로 필요할 경우 URL 복사 협조.
4. Gate B 실패 시 딜명 매칭 정확도 샘플 30건 수동 검증 결과 확인 및 진행 여부 결정.

## 9. 진행 순서 요약

```
C-0a CSV 프로브 (3영업일+) ──┐
C-0b CUSIP 조인 프로브 ──────┤→ Gate A·B → C-1 스키마 → C-2 어댑터/수집기
                                            → C-3 cron → C-4 UI → C-5 N-PORT → C-6 수동 레이어
```

각 이슈 완료 시 커밋 메시지에 이슈 번호와 게이트 통과 근거(측정 수치)를 남긴다. Phase 0 결과 보고 전에는 어떤 테이블도 생성하지 않는다.
