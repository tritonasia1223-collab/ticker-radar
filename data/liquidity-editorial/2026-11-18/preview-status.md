# 2026-11-18 revision-001 적용·검증

- 실제 수집 ready: 2026-11-20T02:04:44.426Z. 자료 고정: 02:05:05.515Z. 원본 draft 저장: 02:14:20.278Z. 기존 입력·전주 수정본을 덮어쓰지 않았다.
- 65개 계열을 전주 고정 입력과 비교했다. 새 관측·동일 관측·수정·결측·롤링 효과와 6개월·1년 이상 흐름은 comparison.md/json에, 외부 조사와 확인/미확인 구분은 research.md에 기록했다.
- 작성 작업트리: C:/ticker-radar-master/.deploy/credit-monitor. 배포 작업트리: C:/ticker-radar-master/.deploy/liquidity-nov18-release, base 28359f9. 다른 작업의 변경을 옮기지 않았다.
- 저장 문안과 앱 shared/editorials/2026-11-18.json의 SHA-256 일치: 8212a76e0a78cce119964191dfc1db57c54603c521ca805a9388bcefceba2741. 문단 38개.
- TypeScript, 78파일 624테스트, workflow/recovery 12테스트, production build 통과. 기존 Browserslist·번들 크기 경고만 남았다.
- 로컬 읽기 전용 미리보기 http://127.0.0.1:5024/#/liquidity-read 에서 모든 문단이 한 번씩 표시됨을 확인했다. 같은 관측 유지 안내는 12px 빨간색으로 블록 아래 표시됐다. 가로 넘침과 콘솔 오류가 없고, 전주·이번 주 이동 시 같은 그래프 위치가 119.5px로 유지됐다.
- overview/auction/credit 스크린샷을 시각 확인했다(output/playwright/editorial-20261118-*.png). 4주 금리 비교표와 주간 해설은 각각의 기간을 유지했다.
- 필수 표시 수정: 전체 역레포를 MMF 거래로 단정하던 자동 요약을 해외 공식기관 거래 포함 전체 잔액 변화로 교정했다. 연준 자산 요약에 실제 감소를 설명하는 기타 자산을 포함했다. 계산 자체는 바꾸지 않았다.
- 입찰 API는 해당 창에 유효 표본 0건(10/22 결측 행 1건, 이후 행 미제공)이다. 수요 붕괴로 해석하지 않고 생키 대신 자료 없음 안내 및 해설을 표시했다. 수집·원자료 API 후속 확인이 필요하다.
- 배포 확인 전 상태: pending. 실제 운영 반영은 deployment.json으로 별도 기록한다. 배포는 문안의 사용자 승인·피드백을 뜻하지 않는다.
