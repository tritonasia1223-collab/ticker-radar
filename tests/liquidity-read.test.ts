import { describe, expect, it, vi, afterEach } from "vitest";
import {
  howMuch, percentileOfChange, whereFrom, whereTo, whoBought, whoSankey, stress, emergencyLoans, background, pickWeeks,
  type ReadWeek,
} from "../shared/liquidity-read";
import { s1, s2, s3, s4, s5, plain, josa, hasBatchim, fmt, rowDescription } from "../shared/liquidity-sentences";
import { READ_CONFIG, type ReadConfig } from "../shared/liquidity-read-config";
import { netLiquidity, type AuctionAgg, type Obs, type Maturity, type Bidder } from "../shared/liquidity-beta";

afterEach(() => vi.restoreAllMocks());

// 부채 잔차는 항등식으로 만든다(server/fed.ts buildWeekly 와 같은 정의).
const week = (o: Partial<ReadWeek> & { date: string; total: number; tga: number; rrp: number; reserves: number; currency: number }): ReadWeek => ({
  treast: 4_500_000, mbs: 1_900_000, discount: 5_000, btfp: NaN, repo: 10, swap: 100,
  liabResidual: o.total - o.reserves - o.rrp - o.tga - o.currency, ...o,
});
const obs = (pairs: [string, number][]): Obs[] => pairs.map(([date, value]) => ({ date, value }));

// ── (a) 2026-09-09 실제값 — 목업과 같은 문장이 나와야 한다 ──
//   DB 실측: total 6,740,619 · TGA 843,705 · 역레포 349,663 · 지급준비금 3,036,508 · 현금통화 2,434,656 (musd).
//   4주 변화는 목업 숫자(+1,048억·+1,157·+85·−193·+889·+159)를 정확히 재현하는 값으로.
const NOW = week({ date: "2026-09-09", total: 6_740_619, tga: 843_705, rrp: 349_663, reserves: 3_036_508, currency: 2_434_656, treast: 4_552_337, mbs: 1_913_585, discount: 5_838, repo: 6, swap: 101 });
const PREV = week({ date: "2026-08-12", total: 6_759_959, tga: 959_395, rrp: 358_133, reserves: 2_947_628, currency: 2_429_656, treast: 4_538_337, mbs: 1_930_885 });
const YEAR_AGO = week({ date: "2025-09-10", total: 6_600_000, tga: 700_000, rrp: 400_000, reserves: 3_000_000, currency: 2_350_000 });
const WEEKS = [YEAR_AGO, PREV, NOW];
const M2 = obs([["2025-07-01", 22_027_000], ["2026-06-01", 23_100_000], ["2026-07-01", 23_218_000]]);

const zero = () => ({ soma: 0, dealer: 0, direct: 0, indirect: 0, noncomp: 0 });
function mkAgg(matrix: Partial<Record<Maturity, Partial<Record<Bidder, number>>>>, reported: Partial<Record<Maturity, number>>, start = "2026-07-01", end = "2026-09-17"): AuctionAgg {
  const mats: Maturity[] = ["bills", "notes", "bonds", "tips", "frn"];
  const m = Object.fromEntries(mats.map((k) => [k, { ...zero(), ...(matrix[k] ?? {}) }])) as AuctionAgg["matrix"];
  const attributed = Object.fromEntries(mats.map((k) => [k, Object.values(m[k]).reduce((s, v) => s + v, 0)])) as AuctionAgg["attributed"];
  const rep = Object.fromEntries(mats.map((k) => [k, reported[k] ?? 0])) as AuctionAgg["reported"];
  const counted = Object.fromEntries(mats.map((k) => [k, attributed[k] > 0 ? 1 : 0])) as AuctionAgg["countedByMaturity"];
  return { start, end, rows: [], matrix: m, attributed, reported: rep, countedByMaturity: counted, counted: Object.values(counted).reduce((s, v) => s + v, 0), skipped: 0, unknownTypes: [] };
}
// 목업: 총 7.6조 · 간접 4.2조(절반 이상)
const AGG_A = mkAgg({
  bills: { indirect: 3_700_000, dealer: 1_800_000, direct: 450_000, soma: 400_000, noncomp: 120_000 },
  notes: { indirect: 380_000, dealer: 240_000, direct: 60_000, soma: 50_000, noncomp: 20_000 },
  bonds: { indirect: 60_000, dealer: 30_000, direct: 10_000, soma: 5_000, noncomp: 3_000 },
  frn: { indirect: 40_000, dealer: 15_000, direct: 5_000, soma: 3_000, noncomp: 1_000 },
  tips: { indirect: 20_000, dealer: 8_000, direct: 3_000, soma: 2_000, noncomp: 1_500 },
}, { bills: 6_600_000, notes: 760_000, bonds: 110_000, frn: 65_000, tips: 35_000 });
const CFG_TEST: ReadConfig = { ...READ_CONFIG, HY_THRESHOLD: 5 }; // 목업의 '세 지표'를 재현하려면 HY 경계가 있어야 한다
const SOFR = obs([["2026-09-12", 3.63], ["2026-09-15", 3.64]]), IORB = obs([["2026-09-12", 3.65], ["2026-09-15", 3.65], ["2026-09-17", 3.90]]);
const NFCI = obs([["2026-09-04", -0.55], ["2026-09-11", -0.56]]), HY = obs([["2026-09-12", 2.80], ["2026-09-15", 2.76]]);

describe("읽기 페이지 — (a) 2026-09-09 실제값이 목업 문장을 재현한다", () => {
  const { sel, prev } = pickWeeks(WEEKS, "2026-09-09", 4);
  const how = howMuch(WEEKS, sel!, prev!, 4, M2, READ_CONFIG.FLAT_PCT);
  const from = whereFrom(prev!, sel!, READ_CONFIG.DOMINANT_SHARE);
  const to = whereTo(prev!, sel!, [], [], null);
  const who = whoBought(AGG_A, null, [], []);
  const st = stress(SOFR, IORB, NFCI, HY, { ...emergencyLoans(sel!), date: sel!.date }, CFG_TEST);

  it("요약 다섯 문장", () => {
    expect(plain(s1(how).summary)).toBe("유동성은 4주간 1,048억 달러 늘었습니다.");
    expect(plain(s2(from, 4).summary)).toBe("재무부가 TGA 잔고를 시중에 푼 결과라 오래가긴 어렵습니다.");
    expect(plain(s3(to).summary)).toBe("늘어난 돈은 대부분 은행 지급준비금으로 들어갔습니다.");
    expect(s4(who).summary).toBe("새로 찍은 국채는 절반 이상을 간접 입찰자가 받아갔습니다.");
    expect(s5(st).summary).toBe("자금시장에 긴장 신호는 없습니다.");
  });

  it("01 결론·백분위·M2 문장", () => {
    expect(plain(s1(how).headline)).toBe("시장에 도는 돈은 5.5조 달러, 4주 전보다 1,048억 달러(+1.9%) 늘었습니다.");
    expect(how.dNl).toBe(104_820); expect(how.flat).toBe(false);
    expect(s1(how).m2note).toBe("밑돈은 1년 전과 비슷한데 M2는 5.4% 늘었습니다. 돈이 연준 바깥에서 만들어지고 있다는 뜻입니다.");
    expect(s1(how).band).toBe(""); // 표본 20개 미만이면 백분위 문장은 비운다
  });

  it("02 결론·행 설명·판정", () => {
    const r = s2(from, 4);
    expect(plain(r.headline)).toBe("재무부가 TGA에서 1,157억 달러를 시중에 풀었습니다. 연준은 반대로 193억 달러를 흡수했습니다.");
    expect(from.contributions.map((c) => Math.round(c.effect / 100))).toEqual([1157, 85, -193]);
    expect(from.verdict).toBe("oneoff"); expect(from.dominantShare).toBeGreaterThanOrEqual(0.8);
    expect(r.verdictTitle).toBe("일회성일 가능성이 큼");
    expect(r.verdictBody).toBe("재무부가 TGA를 풀어 생긴 유동성은 TGA를 다시 채울 때 도로 흡수됩니다. 이번 증가는 거의 전부 재무부 쪽입니다.");
    expect(rowDescription(from.contributions[0], from.fedDetail)).toBe("TGA 잔고 감소 = 방출. 거둔 돈보다 쓴 돈이 많았음");
    expect(rowDescription(from.contributions[1], from.fedDetail)).toBe("역레포 잔고 감소 = 방출. MMF가 연준에 넣어둔 돈을 시중으로 인출");
    // 연준 세부는 |Δ| 큰 순서로 생성 — 목업 문구(−173 이 대부분, 국채 +140)는 자체 불일치라 규칙값이 기준
    expect(rowDescription(from.contributions[2], from.fedDetail)).toBe("자산 감소 = 흡수. MBS 상환 −173억, 기타 자산 −160억");
  });

  it("03 결론·항등식", () => {
    expect(plain(s3(to).headline)).toBe("늘어난 1,048억 달러 중 889억이 은행 지급준비금으로 들어갔습니다.");
    expect(Math.round(to.dOther / 100)).toBe(159);
    expect(to.identityError).toBeLessThan(1e-6); expect(from.identityError).toBeLessThan(1e-6);
  });

  it("04 결론", () => {
    expect(s4(who).headline).toEqual(["7월 이후 찍은 국채 7.6조 달러 중 절반 이상인 4.2조를 간접 입찰자가 가져갔습니다."]);
    expect(who.top?.share).toBeCloseTo(4_200_000 / 7_570_000, 6);
  });

  it("05 결론 — 경계가 있는 지표만 센다", () => {
    expect(s5(st).headline).toEqual(["자금시장에 긴장 신호는 없습니다.", "세 지표 모두 경계선 아래입니다."]);
    expect(st.rows[0].value).toBe(-1); expect(st.rows[0].date).toBe("2026-09-15"); // 공통 관측일에서 차감
    expect(st.rows[3].breached).toBeNull(); expect(st.rows[3].note).toContain("BTFP");
    expect(s5(stress(SOFR, IORB, NFCI, HY, null, READ_CONFIG)).headline[1]).toBe("두 지표 모두 경계선 아래입니다."); // 운영 설정(HY 미설정)
  });
});

describe("읽기 페이지 — 다른 국면", () => {
  const base = (date: string) => ({ date, reserves: 3_000_000, currency: 2_400_000 });
  const pair = (p: Partial<ReadWeek>, n: Partial<ReadWeek>) => {
    const prev = week({ ...base("2026-08-12"), total: 6_700_000, tga: 800_000, rrp: 350_000, ...p });
    const now = week({ ...base("2026-09-09"), total: 6_700_000, tga: 800_000, rrp: 350_000, ...n });
    return { prev, now, from: whereFrom(prev, now, 0.5), how: howMuch([prev, now], now, prev, 4, [], 0.3), to: whereTo(prev, now, [], [], null) };
  };

  it("(b) TGA 증가 주도 흡수", () => {
    const { from, how, to } = pair({ tga: 700_000, treast: 4_500_000 }, { tga: 850_000, total: 6_690_000, rrp: 345_000, reserves: 2_860_000, treast: 4_490_000 });
    expect(from.verdict).toBe("oneoff"); expect(how.dNl).toBe(-155_000);
    expect(plain(s1(how).summary)).toBe("유동성은 4주간 1,550억 달러 줄었습니다.");
    expect(plain(s2(from, 4).headline)).toBe("재무부가 TGA에서 1,500억 달러를 흡수했습니다. 연준은 역시 100억 달러를 흡수했습니다.");
    expect(plain(s2(from, 4).summary)).toBe("재무부가 TGA 잔고를 채운 결과라 돈을 쓰면 되돌려집니다.");
    expect(rowDescription(from.contributions[0], from.fedDetail)).toBe("TGA 잔고 증가 = 흡수. 쓴 돈보다 거둔 돈(세금·국채)이 많았음");
    expect(plain(s3(to).headline)).toBe("줄어든 1,550억 달러 중 1,400억이 은행 지급준비금에서 빠졌습니다.");
  });

  it("(c) 연준 주도 방출", () => {
    const { from } = pair({}, { total: 6_800_000, tga: 790_000, rrp: 355_000, treast: 4_600_000 });
    expect(from.verdict).toBe("persistent");
    expect(plain(s2(from, 4).headline)).toBe("연준이 자산을 늘려 1,000억 달러를 시중에 풀었습니다. 재무부는 역시 100억 달러를 시중에 풀었습니다.");
    expect(plain(s2(from, 4).summary)).toBe("연준이 자산을 늘린 결과라 정책이 바뀌기 전까지 이어질 가능성이 큽니다.");
    expect(rowDescription(from.contributions[2], from.fedDetail)).toBe("자산 증가 = 방출. 국채 매입 +1,000억이 대부분"); // 0 인 MBS 는 적지 않는다
  });

  it("(d) 역레포 주도", () => {
    const { from } = pair({}, { rrp: 270_000, tga: 810_000, total: 6_705_000 });
    expect(from.verdict).toBe("depends");
    expect(plain(s2(from, 4).headline)).toBe("MMF가 역레포에서 800억 달러를 시중에 풀었습니다. 재무부는 반대로 100억 달러를 흡수했습니다.");
    expect(s2(from, 4).verdictBody).toBe("역레포 잔고는 2,700억 달러. 바닥에 가까울수록 더 나올 돈이 없습니다.");
  });

  it("(e) 혼합 — 주도 요인 없음", () => {
    const { from } = pair({}, { tga: 762_000, total: 6_737_000, rrp: 355_000 });
    expect(from.verdict).toBe("mixed"); expect(from.dominantShare).toBeLessThan(0.5);
    expect(s2(from, 4).verdictTitle).toBe("여러 요인이 섞임");
    expect(plain(s2(from, 4).summary)).toBe("재무부와 연준이 함께 움직여 한 요인으로 설명되지 않습니다.");
  });

  it("(f) ΔNL ≈ 0 — 거의 그대로", () => {
    const { from, how } = pair({}, { tga: 790_000, total: 6_689_900 });
    expect(how.flat).toBe(true);
    expect(plain(s1(how).headline)).toBe("시장에 도는 돈은 5.5조 달러, 4주 전과 거의 그대로입니다.");
    expect(plain(s1(how).summary)).toBe("유동성은 4주간 거의 그대로입니다.");
    expect(plain(s2(from, 4, true).summary)).toBe("요인들이 서로 상쇄돼 큰 변화가 없습니다.");
    expect(s2(from, 4, true).verdictTitle).toBe("서로 상쇄");
  });

  it("지급준비금 몫이 순변화를 넘으면 'X 중 Y' 대신 두 항목을 나눠 쓴다", () => {
    const { to } = pair({}, { tga: 843_000, total: 6_690_000, reserves: 2_925_000, currency: 2_415_000 }); // ΔNL −530억, 준비금 −750억, 기타 +220억 (준비금 몫 141%)
    expect(to.resShare).toBeGreaterThan(1);
    expect(plain(s3(to).headline)).toBe("지급준비금은 750억 줄고, 현금통화·기타는 220억 늘었습니다.");
  });

  it("(h) 비교 주 관측이 없으면 수준만 말하고 변화는 비교하지 않는다", () => {
    const how = howMuch([NOW], NOW, null, 4, M2, 0.3);
    expect(Number.isNaN(how.dNl)).toBe(true); expect(how.pctl).toBeNull(); expect(how.nl).toBe(5_547_251);
    expect(plain(s1(how).headline)).toBe("시장에 도는 돈은 5.5조 달러입니다.");
    expect(plain(s1(how).summary)).toBe("유동성은 5.5조 달러입니다. 4주 전 관측이 없어 변화는 비교하지 않았습니다.");
  });

  it("변화가 0 이면 방출·흡수로 판정하지 않고 부호도 없다", () => {
    const { from } = pair({}, {});
    expect(rowDescription(from.contributions[0], from.fedDetail)).toBe("TGA 잔고 변화 없음");
    expect(rowDescription(from.contributions[1], from.fedDetail)).toBe("역레포 잔고 변화 없음");
    expect(rowDescription(from.contributions[2], from.fedDetail)).toBe("자산 변화 없음");
    expect(fmt.signedEok(0)).toBe("0억"); expect(fmt.signedEok(30)).toBe("0억"); expect(fmt.signedEok(-30)).toBe("0억");
    expect(plain(s2(from, 4, true).headline)).toBe("이번 기간엔 재무부·역레포·연준 모두 뚜렷한 변화가 없습니다.");
    expect(s2(from, 4, true).headline.every((p) => !p.tone)).toBe(true);
  });

  it("혼합 국면에서 첫 요인이 연준이면 '연준과 재무부가'", () => {
    const { from } = pair({}, { total: 6_738_000, tga: 763_000, rrp: 355_000 }); // 연준 +380억, 재무부 +370억, 역레포 −50억
    expect(from.verdict).toBe("mixed"); expect(from.ranked[0].key).toBe("fed");
    expect(plain(s2(from, 4).summary)).toBe("연준과 재무부가 함께 움직여 한 요인으로 설명되지 않습니다.");
  });

  it("맥락 자료가 비면 '판정하지 않았다'고 말한다 — 경계는 있으므로 '설정 없음'이 아니다", () => {
    const st = stress([], [], [], [], null, READ_CONFIG);
    expect(st.evaluated).toHaveLength(0);
    expect(s5(st).summary).toBe("자금시장 지표를 불러오지 못해 이번 주는 판정하지 않았습니다.");
  });

  it("(g) 스트레스 지표 1개 초과", () => {
    const st = stress(obs([["2026-09-15", 3.80]]), IORB, NFCI, HY, null, CFG_TEST);
    expect(st.rows[0].value).toBe(15); expect(st.breached.map((r) => r.key)).toEqual(["spread"]);
    expect(s5(st).headline).toEqual(["초단기 금리 압력이 경계선을 넘었습니다.", "나머지 두 지표는 경계선 아래입니다."]);
    expect(s5(st).summary).toBe("초단기 금리 압력이 경계선을 넘었습니다.");
  });

  it("13주 기준이면 문장의 기간과 비교일이 함께 바뀐다", () => {
    const w13 = week({ ...base("2026-06-10"), total: 6_600_000, tga: 900_000, rrp: 400_000 });
    const weeks = [w13, PREV, NOW];
    const { sel, prev } = pickWeeks(weeks, "2026-09-09", 13);
    expect(prev?.date).toBe("2026-06-10");
    const how = howMuch(weeks, sel!, prev!, 13, [], 0.3);
    expect(plain(s1(how).summary)).toMatch(/^유동성은 13주간 /);
    expect(pickWeeks([PREV, NOW], "2026-09-09", 13).prev).toBeNull(); // 정확한 날짜가 없으면 인접 행으로 대체하지 않는다
  });
});

describe("읽기 페이지 — 계산 계층", () => {
  it("5년 N주 변화 분포에서 백분위와 띠 위치를 만든다", () => {
    const weeks: ReadWeek[] = [];
    for (let i = 0; i < 320; i++) { // 약 6년 주간
      const date = new Date(Date.UTC(2020, 8, 9) + i * 7 * 86_400_000).toISOString().slice(0, 10);
      weeks.push(week({ date, total: 6_000_000 + Math.sin(i / 7) * 200_000 + i * 500, tga: 700_000, rrp: 300_000, reserves: 3_000_000, currency: 2_300_000 }));
    }
    const sel = weeks[weeks.length - 1], prev = weeks[weeks.length - 5];
    const p = percentileOfChange(weeks, sel, 4, netLiquidity(sel) - netLiquidity(prev));
    expect(p).not.toBeNull(); expect(p!.n).toBeGreaterThan(200);
    expect(p!.pos).toBeGreaterThanOrEqual(0); expect(p!.pos).toBeLessThanOrEqual(1);
    const big = percentileOfChange(weeks, sel, 4, p!.max); expect(big?.side).toBe("상위"); expect(big?.p).toBe(1); expect(big?.pos).toBe(1);
    const small = percentileOfChange(weeks, sel, 4, p!.min); expect(small?.side).toBe("하위"); expect(small?.pos).toBe(0);
    expect(percentileOfChange(weeks.slice(-10), sel, 4, 1000)).toBeNull();
  });

  it("항등식이 어긋나면 console.warn 을 낸다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = { ...NOW, liabResidual: NOW.liabResidual + 5_000 }; // 잔차를 손대 항등식을 깬다
    const t = whereTo(PREV, broken, [], [], null);
    expect(t.identityError).toBe(5_000); expect(warn).toHaveBeenCalledTimes(1);
  });

  it("어디로: 예금·단기채는 띠와 같은 두 시점, 구간 밖이면 결측", () => {
    const dep = obs([["2026-08-12", 19_000_000], ["2026-09-02", 19_030_200], ["2026-09-09", 19_040_000]]);
    const bills = obs([["2026-07-31", 6_800_000], ["2026-08-31", 7_059_200]]);
    const t = whereTo(PREV, NOW, dep, bills, null);
    expect(Math.round(t.deposits!.delta / 100)).toBe(400); expect(t.bills!.from.date).toBe("2026-07-31"); expect(Math.round(t.bills!.delta / 100)).toBe(2592);
    expect(whereTo(PREV, NOW, dep.slice(0, 1), [], null).deposits).toBeNull();
  });

  it("지급준비금 구간: 설정이 없으면 null, 있으면 위치와 구간", () => {
    expect(whereTo(PREV, NOW, [], [], null).zone).toBeNull();
    const z = whereTo(PREV, NOW, [], [], { unit: "musd", tight: 2_500_000, ample: 3_200_000 }).zone!;
    expect(z.zone).toBe("middle"); expect(z.pos).toBeGreaterThan(0.3); expect(z.pos).toBeLessThan(0.55);
  });

  it("누가 샀나: 단기채 빼고 보면 축척·최대 수령처·점유율을 다시 계산한다", () => {
    const all = whoBought(AGG_A, null, [], []);
    const nb = whoBought(AGG_A, null, [], [], true);
    expect(all.totalReported).toBe(7_570_000); expect(nb.totalReported).toBe(970_000);
    expect(nb.byBucket.bills).toBe(0); expect(nb.top?.bidder).toBe("indirect");
    expect(nb.top!.share).toBeCloseTo(500_000 / 970_000, 6);
    expect(s4(nb).headline[0]).toBe("7월 이후 찍은 국채 9,700억 달러 중 절반 이상인 5,000억을 간접 입찰자가 가져갔습니다."); // 억 뒤는 '을'(Codex F7)
    const sk = whoSankey(nb);
    expect(sk.nodes.filter((n) => n.side === "bucket").map((n) => n.key)).toEqual(["nb", "tips"]);
    expect(sk.links.every((l) => l.value > 0)).toBe(true);
    for (const n of sk.nodes.filter((n) => n.side === "bucket")) {
      const i = sk.nodes.indexOf(n);
      expect(sk.links.filter((l) => l.source === i).reduce((s, l) => s + l.value, 0)).toBeCloseTo(n.value, 9);
    }
  });

  it("딜러 점유율이 직전 창보다 5%p 이상 오르면 둘째 문장", () => {
    const prevAgg = mkAgg({ bills: { indirect: 5_000_000, dealer: 1_000_000, direct: 500_000, soma: 400_000, noncomp: 100_000 } }, { bills: 7_000_000 }, "2026-04-01", "2026-06-30");
    const w = whoBought(AGG_A, prevAgg, [], []);
    expect(w.dealerSharePrev).toBeCloseTo(1 / 7, 6); expect(w.dealerJump).toBe(true);
    expect(s4(w).headline[1]).toBe("딜러가 떠안은 몫이 14%에서 28%로 늘었습니다.");
  });

  it("긴급대출: 종료된 BTFP 는 제외하고 관측되면 포함", () => {
    expect(emergencyLoans(NOW)).toEqual({ value: 5_945, btfpEnded: true });
    expect(emergencyLoans({ ...NOW, btfp: 1_000 })).toEqual({ value: 6_945, btfpEnded: false });
  });

  it("배경: 값과 기준일만", () => {
    const bg = background({ dfii10: obs([["2026-09-15", 2.62]]), unrate: obs([["2026-08-01", 4.1]]), indpro: obs([["2025-07-01", 101.9], ["2026-07-01", 103.0]]) });
    expect(bg.find((b) => b.key === "dfii10")).toMatchObject({ value: 2.62, date: "2026-09-15" });
    expect(bg.find((b) => b.key === "indpro")!.value).toBeCloseTo(1.08, 1);
    expect(bg.find((b) => b.key === "dxy")!.value).toBeNull();
  });
});

describe("읽기 페이지 — 표기·조사", () => {
  it("금액·날짜 표기", () => {
    expect(fmt.eok(104_820)).toBe("1,048"); expect(fmt.jo(5_547_251)).toBe("5.5"); expect(fmt.amount(526_400)).toBe("5,264억"); expect(fmt.amount(7_570_000)).toBe("7.6조");
    expect(fmt.signedEok(-19_340)).toBe("−193억"); expect(fmt.pct(1.926)).toBe("+1.9%"); expect(fmt.pct(-0.04, 1)).toBe("−0.0%");
    expect(fmt.dateKo("2026-09-09")).toBe("9월 9일"); expect(fmt.monthKo("2026-07-01")).toBe("7월"); expect(fmt.weekTitle("2026-09-09")).toBe("2026년 9월 2주차");
    expect(fmt.bp(-1)).toBe("−1bp"); expect(fmt.bp(0)).toBe("0bp"); expect(fmt.count(3)).toBe("세");
  });
  it("조사는 받침으로 고른다", () => {
    expect(josa("재무부", "이가")).toBe("재무부가"); expect(josa("연준", "이가")).toBe("연준이"); expect(josa("연준", "은는")).toBe("연준은");
    expect(josa("간접 입찰자", "이가")).toBe("간접 입찰자가"); expect(josa("프라이머리 딜러", "이가")).toBe("프라이머리 딜러가");
    expect(josa("초단기 금리 압력", "이가")).toBe("초단기 금리 압력이"); expect(josa("MMF", "이가")).toBe("MMF가");
    expect(josa("서울", "으로로")).toBe("서울로"); expect(josa("지급준비금", "으로로")).toBe("지급준비금으로"); expect(josa("역레포", "을를")).toBe("역레포를");
    expect(josa("연준", "과와")).toBe("연준과"); expect(josa("재무부", "과와")).toBe("재무부와"); expect(josa("5,000억", "을를")).toBe("5,000억을");
    expect(hasBatchim("압력")).toBe(true); expect(hasBatchim("딜러")).toBe(false);
  });
});
