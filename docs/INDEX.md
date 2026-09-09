# 문서 색인

2026-09-09 기준 주력 개발은 자본주의 경제사·미국 유동성·세계 현황판입니다.

| 현재 안내 | 내용 |
|---|---|
| [프로젝트 README](../README.md) | 기능 상태, 실행·검증·운영 원칙 |
| [CAPITALISM](CAPITALISM.md) | 경제사 데이터·편집·차트 구조 |
| [FED](FED.md) | 미국 유동성 구현과 수집 |
| [WORLD](WORLD.md) | 지도 코드·데이터·개발 범위 |
| [DATACENTERS](DATACENTERS.md) | 데이터센터 지도 표현·계산 |
| [안정성 점검](STABILITY-AUDIT-2026-09-09.md) | 수정 전 발견 사항과 재현 근거 |
| [LEGACY-TRACKING](LEGACY-TRACKING.md) | 보류 기능의 초기 README 보존본 |

## 계획·운영 이력

fed-balance-sheet-tab-plan.md, 세계현황판-탭-기획서.md, clo-tab-instructions.md, blockchain-learn-tab-plan.md는 설계 당시 계획입니다. 일정·API·완료 범위는 현재 코드와 다를 수 있습니다. fed-treasury-data-inventory.md는 출처·단위 조사 기록, MIGRATION-vercel-supabase.md와 DEPLOY-STATUS.md는 배포 이전·장애 해결 기록, COLLECT-BUTTON-SETUP.md는 보류된 SNS 수집 버튼 설정 자료입니다.

## 조사 자료와 보존 기준

README_ai_datacenters.md, 데이터센터·원전 CSV/JSON, 달러 패권 분석 Word 문서는 조사 원본입니다. 실행 중 읽는 데이터는 client/src/data/이며, 원본과 실행 데이터를 중복으로 보고 삭제하지 않습니다. 연결되지 않은 문서라도 사용자 기록·출처·백업이면 보존합니다.

참조가 없는 UI 기본 파일과 재생성 가능한 임시 빌드 산출물은 제거할 수 있습니다. 보류 기능의 코드·테이블·수집 설정을 제거하거나 중지하는 것은 별도 기능 변경입니다.


- [안정화 변경 기록](STABILITY-CHANGES-2026-09-09.md) — 문서 정리, 수정 범위, 검증 결과와 남은 과제
