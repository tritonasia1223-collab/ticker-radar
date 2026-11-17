# 표 셀 리치텍스트 검증 (2026-11-17)

요구사항: 경제사 인사이트 모아보기의 표에도 본문과 동일한 글자색·하이라이트 등 편집을 적용하고 배포.

구현: 공용 TableCard의 textarea를 CapRichEditor로 교체하고 읽기 화면에는 CapRichText 적용. 기존 문자열 저장 및 API는 그대로 사용한다. 부모 표가 언마운트될 때 편집기의 최신 직렬화 값을 읽어 마지막 입력을 보존한다. 명시적 표 삭제는 이탈 저장 대상에서 제외한다.

검증 결과:

- `npm.cmd run check`: 통과.
- `npm.cmd test`: 69개 파일, 538개 테스트 통과.
- `npm.cmd run build`: 통과. 기존 대형 번들·Browserslist 경고 있음.
- 격리된 로컬 InsightsCollection fixture에서 노랑 하이라이트, 빨강 글자, 굵게 적용 확인.
- 저장한 셀 문자열에 서식 마커와 줄바꿈이 보존되고, 새로고침 후 읽기 화면에서 원시 마커 대신 올바른 색상·배경으로 표시됨.
- 행/열 추가와 첫 행/열 삭제 뒤 남은 셀 내용·서식 보존.
- 포커스를 유지한 채 화면 전환 시 마지막 입력 저장 확인. 부모의 passive cleanup 완료 후 값을 비교함.
- 편집 중 표 삭제 후 저장·새로고침해도 삭제한 표가 복원되지 않음.

실제 사용자 자료에 테스트 쓰기를 하지 않았다. DB/API 구현 변경은 없다. 로컬 브라우저 fixture와 실행 기록은 `output/cap-table-rich-preview.*`, `output/playwright/cap-table-rich-*.js`에 보존한다.
