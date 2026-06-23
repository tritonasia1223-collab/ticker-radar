// 자본주의 타임라인 인사이트 1차 초안 시드 — 달러 패권 서사를 사건별로 쪼개 채운다.
// 메타 테제(insight_overview) + 사건별 insight{text, charts}. 기존 노드/표/메모는 보존(비파괴).
//   미리보기:  npx tsx script/seed-capitalism-insights.ts        (DB 변경 없음, 내용만 출력)
//   삽입:      npx tsx script/seed-capitalism-insights.ts --write
import "dotenv/config";
import { listFlows, upsertFlow, setSetting, type FlowInput, type CapInsight } from "../server/capitalism.js";

const WRITE = process.argv.includes("--write");

// ── 메타 테제(전체 관통 논증) — 사건에 안 묶이는 큰 그림 ──
const OVERVIEW = `[[c-r|달러 패권의 역사는 '숙주를 갈아타는 바이러스'의 역사다.]]

1944년 브레튼우즈에서 달러는 금(金)이라는 실물에 자신을 묶었다. 포트녹스에 금을 봉인하고 달러를 '금 교환증서'로 만들었다. 하지만 실물(금)과 명목(달러)의 간극은 벌어지기만 했고, 1960년 [[hl-y|트리핀은 이미 그 모순을 경고했다]] — 기축통화국은 적자를 통해 세계에 달러를 공급해야 하지만, 그 적자가 곧 통화의 신뢰를 무너뜨린다. 달러는 태생적으로 다른 가치에 기생해야 했다.

금이라는 숙주가 한계에 다다르자(닉슨쇼크), 달러는 곧바로 [[c-b|석유]]로 갈아탔다(페트로달러). 그다음엔 전 세계 [[c-b|개도국]]을 산업화시켜 달러를 쓰게 만들었다 — 1940년대 마샬플랜이 그랬듯, 상대에게 돈이 있어야 미국이 수출하고 달러가 돈다.

그리고 지금, 그 숙주들이 무너지고 있다. 러-우 전쟁의 SWIFT 차단은 전 세계에 불안을 새겼고, 위안화가 침투하며, 미국 부채는 역대 최고다. 각국은 미국채 대신 금을 쌓는다. 사우디의 최대 고객이 중국이 된 순간 페트로달러는 사실상 의미를 잃었다.

미국이 찾은 새 숙주는 [[c-r|AI와 스테이블코인]] — 달러 패권을 컴퓨팅 파워에 기생시키는 것이다. AI의 관점에서 전 세계는 또 하나의 개도국이고, 미국은 이번에도 데이터센터를 지어주며 AI와 스테이블코인을 쓰게 만들 것이다. 숙주를 찾는 바이러스처럼.`;

// ── 사건별 인사이트(slug → {text, charts}) ──
// 그래프 범위는 기본적으로 '그 사건 시점' 전후(맥락 창)로, 과거↔현재 연결이 핵심인 곳만 현재까지 넓게.
const INSIGHTS: Record<string, CapInsight> = {
  // 닉슨 당선(1968)
  "flow-mqj3cqwd": {
    text: `닉슨이 어떤 인물인가는 이후 벌어질 모든 일을 설명한다. [[hl-y|권력을 위해서라면 무슨 짓이든(워터게이트)]] 했던 그가, '금 태환 폐지'라는 전 세계가 경악할 초강수를 두는 데 망설일 이유는 없었다.

그 앞에는 전쟁(베트남)과 복지를 동시에 밀어붙인 '총과 버터'의 존슨이 있었고, 더 거슬러 올라가면 연준의 권한을 축소하는 행정명령에 서명한 직후 암살당한 케네디가 있다. 통화 권력을 건드린 자리마다 격변이 일어났다. 우연의 연속일까?`,
    charts: [{ series: "inflation", from: 1962, to: 1982 }],
  },
  // 닉슨 쇼크(1971)
  "nixon": {
    text: `1971년 8월 15일, 닉슨은 달러의 금 태환을 일방적으로 정지시켰다. 브레튼우즈가 사실상 무너진 날이자, 달러가 [[c-r|금이라는 첫 숙주를 잃은 순간]]이다.

명분은 있었다. 베트남전과 복지 지출로 적자가 쌓였고, 해외에 풀린 달러는 미국의 금 보유고를 넘어선 지 오래였다 — 1960년 트리핀이 경고한 모순 그대로다. 금이라는 닻을 푼 대가는 1970년대 내내 이어진 만성 인플레였고, 풀려난 금값은 그 뒤로 수십 년간 폭주한다(오른쪽 그래프).`,
    charts: [{ series: "gold", from: 1968, to: 2026 }, { series: "dollar", from: 1969, to: 1985 }],
  },
  // 4차 중동전쟁(1973)
  "yomkippur": {
    text: `1차 오일쇼크의 방아쇠를 당긴 건 두 가지였고, [[c-r|공교롭게도 둘 다 미국이 촉발한 문제였다.]]

하나, 닉슨쇼크로 달러 가치가 급락하면서 달러로 석유를 팔던 산유국들의 실질 수입이 쪼그라들었다. 둘, 미국은 이 전쟁에서 이스라엘에 대규모 무기를 지원했다. 분노와 손실이 겹친 중동국들은 석유 수출 자체를 끊어버린다. 결국 미국이 만든 위기가, 미국이 갈아탈 다음 숙주(석유)의 무대를 깔아준 셈이다.`,
    charts: [{ series: "oil", from: 1969, to: 1982 }],
  },
  // 1차 오일쇼크(1973)
  "oilshock": {
    text: `유가가 몇 달 만에 네 배로 뛰었다. 세계 경제는 인플레와 침체가 동시에 오는 스태그플레이션에 빠졌지만, 미국에겐 전혀 다른 그림이 보였을 것이다.

[[hl-y|석유 — 전 세계가, 매일, 반드시 사야 하는 단 하나의 상품.]] 금이라는 숙주를 막 잃은 달러를, 만약 이 석유에 묶을 수만 있다면? 위기는 그렇게 기회의 설계도가 된다.`,
    charts: [{ series: "oil", from: 1969, to: 1985 }, { series: "inflation", from: 1969, to: 1985 }],
  },
  // 페트로달러(1974)
  "petrodollar": {
    text: `금 태환을 폐지한 지 [[c-r|겨우 3년 뒤]], 미국은 사우디와 손을 잡는다. 석유를 오직 달러로만 거래한다는 페트로달러 협약 — 이제 전 세계는 석유를 사기 위해 반드시 달러를 쥐어야 한다.

금이라는 숙주를 잃은 달러가, 곧바로 [[c-b|석유라는 새 숙주]]에 올라탄 것이다. 닉슨쇼크 → 오일쇼크 → 페트로달러로 이어진 단 3년의 흐름이, 정말 우연의 연속이었을까? 이때 만들어진 달러-석유 체제는 이후 반세기를 지배한다(오른쪽 그래프).`,
    charts: [{ series: "oil", from: 1970, to: 2026 }, { series: "dollar", from: 1971, to: 1988 }],
  },
  // 유로달러 시장 폭발 ~ 개도국들의 부상(1975)
  "flow-mqiv5ye1": {
    text: `페트로달러가 자리잡자, 미국에겐 새 과제가 생겼다. 패권은 달러를 쓰는 사람이 많아야 유지되니, 달러를 [[hl-y|전 세계에 퍼뜨려야]] 했다. 그렇게 선택된 무대가 개도국이다 — 1975년부터 중남미와 아시아로 저금리 대출과 투자가 폭증한다.

이 나라들이 산업화될수록 달러 수요는 커진다. 2차 대전 직후 초토화된 유럽에 마샬플랜으로 달러를 쏟아부은 것과 정확히 같은 논리다 — [[c-b|상대에게 돈이 있어야 미국이 수출하고, 그 돈이 달러여야 패권이 돈다.]]`,
    charts: [{ series: "dollar", from: 1972, to: 1990 }],
  },
  // 멕시코의 모라토리엄(1982)
  "flow-mqj251qu": {
    text: `빚으로 쌓아 올린 성장은 빚이 비싸지는 순간 무너진다. 볼커가 인플레를 잡으려 정책금리를 20%까지 끌어올리자, 달러 빚을 잔뜩 진 개도국들이 이자를 감당하지 못하고 줄줄이 쓰러졌다.

1982년 멕시코의 모라토리엄(채무불이행)이 그 신호탄이었다. [[c-r|달러를 퍼뜨려 패권을 키우려던 전략이, 부메랑이 되어 돌아온 첫 장면]]이다. 숙주를 키우는 일은 언제나 그 숙주가 병드는 위험을 함께 키운다.`,
    charts: [{ series: "fedfunds", from: 1975, to: 1990 }],
  },
};

function toInput(f: Awaited<ReturnType<typeof listFlows>>[number], insight: CapInsight): FlowInput {
  return {
    slug: f.slug, date: f.date, endDate: f.endDate, year: f.year, title: f.title,
    category: f.category, layout: f.layout, sortOrder: f.sortOrder, insight,
    nodes: f.nodes.map((n) => ({ nodeKey: n.id, kind: n.kind, inLabel: n.inLabel, text: n.text, ref: n.ref, col: n.col, table: n.table })),
    edges: f.edges,
  };
}

async function main() {
  const flows = await listFlows();
  const bySlug = new Map(flows.map((f) => [f.slug, f]));
  console.log(`모드: ${WRITE ? "삽입(--write)" : "미리보기(변경 없음)"}\n`);

  console.log("── 메타 테제(overview) ──");
  console.log(OVERVIEW.replace(/\[\[[a-z-]+\|([^\]]*)\]\]/g, "$1").slice(0, 200) + "…\n");
  if (WRITE) await setSetting("insight_overview", OVERVIEW);

  for (const [slug, insight] of Object.entries(INSIGHTS)) {
    const f = bySlug.get(slug);
    if (!f) { console.log(`⚠ 사건 없음: ${slug} (건너뜀)`); continue; }
    if (f.insight) { console.log(`⏭ 이미 인사이트 있음, 건너뜀: ${f.title}`); continue; } // 기존 인사이트 덮어쓰지 않음
    const plain = insight.text.replace(/\[\[[a-z-]+\|([^\]]*)\]\]/g, "$1").replace(/\n+/g, " ").slice(0, 70);
    console.log(`${WRITE ? "✍" : "·"} [${f.date}] ${f.title}\n    "${plain}…"  | 그래프: ${insight.charts.map((c) => `${c.series}(${c.from}~${c.to})`).join(", ")}`);
    if (WRITE) await upsertFlow(toInput(f, insight));
  }
  console.log(`\n${WRITE ? "✅ 삽입 완료" : "미리보기 끝 — 삽입하려면 --write"}`);
  process.exit(0);
}
main().catch((e) => { console.error("실패:", e); process.exit(1); });
