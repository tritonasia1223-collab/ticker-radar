# 세계 현황판 — 현재 구현

메인 경로는 /#/world. DB API 없이 저장소의 정적 자료를 시각화합니다.

- **세계·무역:** 국가·수도 검색, 항로·항만·해협, 항로 비교와 화물 표현.
- **미국 데이터센터:** AI 사이트, 전력시장, 목표 AI 부하 비중, 발전소 연결, 송전선, 원전, 반도체 팹.
- **분쟁:** 무력분쟁·영토분쟁 상세 자료. 과거 전쟁 에피소드에는 준비 중인 콘텐츠가 포함됩니다.

화면은 client/src/pages/World.tsx, 시각화는 D3 geo/zoom과 SVG, 데이터는 client/src/data/입니다. 재생성은 script/build-world-topo.ts, build-us-states.ts, build-us-transmission.ts, build-us-rto.ts, build-conflicts.ts, build-nuclear.ts가 담당합니다.

데이터센터·팹·원전 계약의 조사 원본은 docs/에도 있습니다. 원본과 실행용 JSON은 역할이 다르므로 함께 보존합니다. 실시간 현황을 직접 조회하지 않으며 자료 기준 시점은 각 파일 메타데이터를 확인합니다.

전력·부하 계산과 예외·레이어 설명은 [DATACENTERS](DATACENTERS.md)를 참고하세요. UI 작업 시 세 모드, 확대·이동, 좁은 창과 발표 모드를 함께 확인합니다. 모드별 파일 분리는 데이터 정의와 화면 표현 변경을 섞지 않고 점진적으로 진행합니다.
