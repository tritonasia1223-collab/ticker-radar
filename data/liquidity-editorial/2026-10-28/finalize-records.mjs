import fs from 'node:fs';
const dir = new URL('./', import.meta.url);
const a = JSON.parse(fs.readFileSync(new URL('comparison.json',dir)));
const f = n => n == null ? '없음' : Number(n).toLocaleString('en-US',{maximumFractionDigits:4});
const point = p => p ? `${p.date}: ${f(p.value)}` : '없음';
let out = `# 2026-10-28 / 전주 2026-10-21 비교\n\n전주 revision-004는 사용자 요청에 따른 거시 관점 수정 초안이며 문장별 승인·배포본이 아니다. 배포된 revision-003과 함께 참고했다. 사용자 피드백으로 새로 기록하지 않는다.\n\n## 분석 범위와 해석\n\n- 주간·4주·13주에 더해 26·52·104주 수준과 중간 경로를 확인했다. 월초 방출과 월말 재축적이 반복되는 지표여서 끝점 하나로 추세를 판단하지 않았다.\n- 순유동성은 월초 2주 +1,459억 뒤 최근 2주 −1,389억 달러로 대부분 되돌림. 1년 범위 5.236~5.652조 안에 있다. 52주 증가만으로 지속 상승이라 하지 않는다.\n- 준비금은 현재 2.895조로 9월 말 2.882조와 가까우며 2년 전 3.216조보다 낮다. SOFR 스프레드 양수 전환은 전주의 안정 판단을 갱신할 새 관측이다.\n- M2·H.8은 1년 증가 경로, 회사채는 올해 CCC 위험 프리미엄 누적 상승, ETF는 9월 고점 대비 낙폭, CP는 봄 이후 경로, BDC는 수개월 가격 하락과 새 분기 공시를 함께 확인했다.\n- live API로 전주를 다시 조회하면 새 월간·분기 자료와 수정치가 소급 반영된다. 아래 '전주 고정본'과 비교해야 새 관측을 구분할 수 있다.\n\n## 연준 대차대조표\n\n변화 단위: 억 달러. TGA 증가는 유동성 흡수, RRP 감소는 방출 방향.\n\n|기간|순유동성 변화|준비금 변화|TGA 변화|연준 자산 변화|RRP 변화|\n|---|---:|---:|---:|---:|---:|\n`;
for(const r of a.fed) out+=`|${r.weeks}주|${f(r.net)}|${f(r.delta.reserves)}|${f(r.delta.tga)}|${f(r.delta.total)}|${f(r.delta.rrp)}|\n`;
out+='\n### 롤링 창 이동\n\n';
for(const r of a.roll) out+=`- ${r.weeks}주: 빠진 ${r.removedWeek.from}→${r.removedWeek.to} 순유동성 ${f(r.removedWeek.net)}억 / 들어온 주간 ${f(r.addedWeek.net)}억. 합계 개선을 현재 주간 회복으로 읽지 않는다.\n`;
out+='\n## 전체 맥락·신용 계열\n\n원자료 단위 그대로. H.8은 십억 달러, 금리는 %, P/NAV는 배. 변화는 현재 재조회한 전주 대비이며 고정본과의 차이도 보존했다. 전체 장기 비교값·결측 위치는 comparison.json.\n\n|계열|이번 최신|전주 고정본|재조회 전주|변화|관측 구분/결측|\n|---|---|---|---|---:|---|\n';
for(const r of [...a.context,...a.credit.flatMap(c=>c.lines.map(l=>({...l,key:`${c.id} / ${l.key}`,status:c.status})))]) {
out+=`|${r.key}|${point(r.current)}|${point(r.previousFrozen)}|${point(r.previous)}|${f(r.delta)}|${r.newObservation?'새 관측':'같은 관측'}; 결측 ${(r.missingValues??[]).length}; ${r.status??''}|\n`;
}
out+='\n## 국채 발행·상환·순증감\n\n단위: 억 달러. 재무부 현금 조달액과 시장성 국채 잔액 변화는 별도 집계다.\n\n|구간|발행|상환|물가조정|순증감|단기채 순증감|\n|---|---:|---:|---:|---:|---:|\n';
for(const [k,r] of Object.entries(a.debt))out+=`|${k} ${r.start}~${r.end}|${f(r.issues/100)}|${f(r.redemptions/100)}|${f(r.inflation/100)}|${f(r.net/100)}|${f(r.billsNet/100)}|\n`;
out+=`\n## 개별 자료 상태\n\n- 입찰: 합산 ${a.auctions.count}건, 제외 ${a.auctions.skipped}건. 최신 합산 입찰 ${a.auctions.lastIncludedAuction}. 직접 FiscalData API도 10/19 이후 낙찰액 결측·후반 입찰 누락. 수요 유지로 해석하지 않고 판단 보류 및 빨간 안내. 원자료 갱신 후 재확인 필요.\n- 보유 주체: 앱 정적 자료 2분기말 그대로. 기존 해설 유지+새 분기 없음 안내. 스테이블코인 자료도 새 공시로 해석하지 않음.\n- SLOOS: 7/1 관측 그대로, 두 해설 생략. 회사채 발행: 9월 전체 발행 그대로, IG/HY 세부 결측, 해설 생략.\n- CP: 실제 30일물 두 금리와 4주 국채 비교. 기준 주간 영업일 5일 관측 존재. 기존 90일 대리지표는 화면 판단에 사용하지 않음.\n- ARCC: 새 3분기 NAV/부실/PIK. 부실 값이 같아도 새 공시임. 나머지 두 회사는 2분기. P/NAV 전주 재조회는 ARCC 새 NAV가 소급 적용되므로 전주 고정본을 우선 대조.\n- M2: 9월 신규, 8월 수정치 존재. H.8도 전주 값 소폭 수정. 변경이 작아도 관측이 없다고 표시하지 않음.\n\n## 외부 조사와 블록 결정\n\nresearch.md에 질문·원자료·공개일·사건일·가설을 기록했다. draft-working.json의 각 블록 decision/reason에 작성·유지·생략 사유가 있다. 준비 검사 ready는 개별 입찰 자료 최신성을 보장하지 않으므로 이 예외를 별도 보존한다.\n`;
fs.writeFileSync(new URL('comparison.md',dir),out);
const p=new URL('draft-working.json',dir);const d=JSON.parse(fs.readFileSync(p));
d.blocks.find(b=>b.id==='cp-dashboard').paragraphs[0]=d.blocks.find(b=>b.id==='cp-dashboard').paragraphs[0].replace('지난주 말과 같고','지난주 수요일과 같고');
fs.writeFileSync(p,JSON.stringify(d,null,2)+'\n');
