# 2026-10-21 주차 미리보기 검증

- 상태: 완료 (사용자 피드백 대기, 자동 재작성 금지)
- 앱: C:/ticker-radar-master/.deploy/credit-monitor
- 적용 문안: revision-002.json = shared/editorials/2026-10-21.json
- 미리보기: http://127.0.0.1:5014/#/liquidity-read
- tsc 통과, Vitest 60개 파일·470개 검사 통과, 프로덕션 빌드 통과.
- 실제 브라우저: 10월 3주차 렌더링, 2주차 원문 유지 및 왕복 탐색, 해설별 배치 확인. 브라우저 오류 0건. 1600px/900px 가로 넘침 없음.
- 2026-10-23 사용자의 이번 주 배포 지시에 따라 배포 진행. 피드백 승인과는 별개이며 state는 awaiting_feedback 유지.
- 외부 최신 master의 독일 마르크 계열 추가에 맞춰 기존 검사 2개의 계열 개수/현대 공통 기준일 기대값만 보정. 앱 계산 변경 없음.
- 최초 초안은 draft-original.*, 검산 수정은 revision-002.*, 수정 이유는 verification-001.json에 보존. 사용자 피드백으로 기록하지 않음.
