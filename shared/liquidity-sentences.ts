// 미국 유동성(읽기) — 문장 생성. 순수 함수: 입력 = 계산된 지표, 출력 = 문자열/조각. LLM 없음, 조건 분기 + 템플릿만.
// 문장은 '무슨 일이 있었나'와 '어떤 종류인가'까지. 시장 방향 예측은 쓰지 않는다.
// 표기(명세 3.3): 억 정수(천 단위 쉼표) · 조 소수 1자리 · 본문 '1,157억 달러' · 라벨 '+1,157억' · 음수 −(U+2212) · 날짜 '9월 9일', 월간 '7월'.
import type { HowMuch, WhereFrom, WhereTo, WhoBought, Stress, CmpWeeks, Contribution } from "./liquidity-read.js";
import { BIDDER_SUBJECT } from "./liquidity-read.js";

// ── 표기 ──
export const fmt = {
  eok: (musd: number) => Math.round(Math.abs(musd) / 100).toLocaleString("en-US"),                 // 1,048
  jo: (musd: number) => (Math.abs(musd) / 1e6).toFixed(1),                                            // 5.5
  amount: (musd: number) => (Math.abs(musd) >= 1e6 ? `${fmt.jo(musd)}조` : `${fmt.eok(musd)}억`),     // 7.6조 · 5,264억
  signedEok: (musd: number) => { const e = fmt.eok(musd); return e === "0" ? "0억" : `${musd < 0 ? "−" : "+"}${e}억`; }, // +1,157억 · 0 은 부호 없음
  signedAmount: (musd: number) => `${musd < 0 ? "−" : "+"}${fmt.amount(musd)}`,
  pct: (v: number, digits = 1) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(digits)}%`,             // +1.9%
  pctPlain: (v: number, digits = 1) => `${Math.abs(v).toFixed(digits)}%`,
  dateKo: (iso: string) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`,             // 9월 9일
  monthKo: (iso: string) => `${Number(iso.slice(5, 7))}월`,                                            // 7월
  weekTitle: (iso: string) => `${iso.slice(0, 4)}년 ${Number(iso.slice(5, 7))}월 ${Math.ceil(Number(iso.slice(8, 10)) / 7)}주차`,
  bp: (v: number) => `${v < 0 ? "−" : v > 0 ? "+" : ""}${Math.abs(v)}bp`,
  count: (n: number) => ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"][n] ?? String(n),
};

// ── 조사 ── 받침 판별. 한글이 아니면 받침 없음으로 본다(MMF가, SOFR가).
const code = (word: string) => word.charCodeAt(word.length - 1);
const isHangul = (c: number) => c >= 0xac00 && c <= 0xd7a3;
export const hasBatchim = (word: string) => { const c = code(word); return isHangul(c) ? (c - 0xac00) % 28 !== 0 : /[0136780]$/.test(word) ? true : false; };
const endsWithRieul = (word: string) => { const c = code(word); return isHangul(c) && (c - 0xac00) % 28 === 8; };
export function josa(word: string, kind: "이가" | "을를" | "은는" | "으로로" | "과와"): string {
  const b = hasBatchim(word);
  switch (kind) {
    case "과와": return word + (b ? "과" : "와");
    case "이가": return word + (b ? "이" : "가");
    case "을를": return word + (b ? "을" : "를");
    case "은는": return word + (b ? "은" : "는");
    case "으로로": return word + (b && !endsWithRieul(word) ? "으로" : "로");
  }
}

// ── 출력 형태 ── 조각(tone 있는 조각은 방출/흡수 색으로 강조)
export type Tone = "release" | "absorb";
export interface Part { text: string; tone?: Tone; strong?: boolean }
export const plain = (parts: Part[]) => parts.map((p) => p.text).join("");
const toneOf = (v: number): Tone | undefined => (v > 0 ? "release" : v < 0 ? "absorb" : undefined); // 0 은 방출도 흡수도 아니다
const isZero = (musd: number) => Math.round(musd / 100) === 0; // 억 단위로 0

// ── 01 얼마나 ──
export function s1(h: HowMuch): { headline: Part[]; summary: Part[]; band: string; m2note: string } {
  const N = h.cmpWeeks, up = h.dNl >= 0;
  let m2note = "";
  if (h.nlYoy && h.m2Yoy) {
    const a = h.nlYoy.pct, b = h.m2Yoy.pct;
    if (Math.abs(a) < 2 && b >= 3) m2note = `밑돈은 1년 전과 비슷한데 M2는 ${fmt.pctPlain(b)} 늘었습니다. 돈이 연준 바깥에서 만들어지고 있다는 뜻입니다.`;
    else if (Math.sign(a) === Math.sign(b) && Math.abs(a) >= 2 && Math.abs(b) >= 2) m2note = `밑돈과 M2가 함께 ${a >= 0 ? "늘고" : "줄고"} 있습니다.`;
    else m2note = `밑돈은 ${fmt.pct(a)}, M2는 ${fmt.pct(b)} 변했습니다.`;
  }
  // 비교 주 관측이 없으면 변화를 말하지 않고 수준만 말한다(관측 부재 ≠ 변화 없음).
  if (!Number.isFinite(h.dNl)) {
    return {
      headline: [{ text: `시장에 도는 돈은 ${fmt.jo(h.nl)}조 달러입니다.` }],
      summary: [{ text: `유동성은 ${fmt.jo(h.nl)}조 달러입니다. ${N}주 전 관측이 없어 변화는 비교하지 않았습니다.` }],
      band: "", m2note,
    };
  }
  const headline: Part[] = h.flat
    ? [{ text: `시장에 도는 돈은 ${fmt.jo(h.nl)}조 달러, ${N}주 전과 거의 그대로입니다.` }]
    : [{ text: `시장에 도는 돈은 ${fmt.jo(h.nl)}조 달러, ${N}주 전보다 ` }, { text: `${fmt.eok(h.dNl)}억 달러(${fmt.pct(h.dNlPct)})`, tone: toneOf(h.dNl) }, { text: ` ${up ? "늘었습니다" : "줄었습니다"}.` }];
  const summary: Part[] = h.flat
    ? [{ text: `유동성은 ${N}주간 거의 그대로입니다.` }]
    : [{ text: `유동성은 ${N}주간 ` }, { text: `${fmt.eok(h.dNl)}억 달러 ${up ? "늘었습니다" : "줄었습니다"}.`, tone: toneOf(h.dNl), strong: true }];
  const band = h.pctl ? `지난 5년의 ${N}주 변화 가운데 ${h.pctl.side} ${h.pctl.p}%에 해당합니다.` : "";
  return { headline, summary, band, m2note };
}

// ── 02 어디서 ──
const SOURCE: Record<Contribution["key"], (c: Contribution) => string> = {
  tga: () => "TGA에서", rrp: () => "역레포에서", fed: (c) => (c.effect >= 0 ? "자산을 늘려" : "자산을 줄여"),
};
const verb = (v: number) => (v >= 0 ? "시중에 풀었습니다" : "흡수했습니다");
export function rowDescription(c: Contribution, fedDetail: WhereFrom["fedDetail"]): string {
  if (isZero(c.own)) return c.key === "tga" ? "TGA 잔고 변화 없음" : c.key === "rrp" ? "역레포 잔고 변화 없음" : "자산 변화 없음"; // 0 은 방출·흡수 판정 없음(Codex 2차 F3)
  if (c.key === "tga") return c.own < 0 ? "TGA 잔고 감소 = 방출. 거둔 돈보다 쓴 돈이 많았음" : "TGA 잔고 증가 = 흡수. 쓴 돈보다 거둔 돈(세금·국채)이 많았음";
  if (c.key === "rrp") return c.own < 0 ? "역레포 잔고 감소 = 방출. MMF가 연준에 넣어둔 돈을 시중으로 인출" : "역레포 잔고 증가 = 흡수. MMF가 남는 돈을 연준에 예치";
  const head = c.own >= 0 ? "자산 증가 = 방출. " : "자산 감소 = 흡수. ";
  const [a, b] = fedDetail;
  if (!a) return head.trim();
  const gross = fedDetail.reduce((s, d) => s + Math.abs(d.value), 0);
  const most = gross > 0 && Math.abs(a.value) / gross >= 0.5;
  const second = b && !isZero(b.value) ? `, ${b.label} ${fmt.signedEok(b.value)}` : ""; // 0 인 세부 항목은 적지 않는다
  return `${head}${a.label} ${fmt.signedEok(a.value)}${most ? "이 대부분" : ""}${second}`;
}
export function s2(f: WhereFrom, N: CmpWeeks, flat = false): { headline: Part[]; summary: Part[]; verdictTitle: string; verdictBody: string } {
  const [a, b] = f.ranked;
  const headline: Part[] = isZero(a.effect)
    ? [{ text: "이번 기간엔 재무부·역레포·연준 모두 뚜렷한 변화가 없습니다." }]
    : [{ text: `${josa(a.subject, "이가")} ${SOURCE[a.key](a)} ` }, { text: `${fmt.eok(a.effect)}억 달러`, tone: toneOf(a.effect) }, { text: `를 ${verb(a.effect)}.` }];
  if (b && !isZero(a.effect) && !isZero(b.effect)) {
    const same = Math.sign(b.effect) === Math.sign(a.effect);
    headline.push({ text: ` ${josa(b.subject, "은는")} ${same ? "역시" : "반대로"} ` }, { text: `${fmt.eok(b.effect)}억 달러`, tone: toneOf(b.effect) }, { text: `를 ${verb(b.effect)}.` });
  }
  const release = f.dNl >= 0, dirWord = release ? "증가" : "감소";
  const lead = f.contributions.find((c) => c.key === f.dominant);
  let verdictTitle = "", verdictBody = "", summary = "";
  switch (f.verdict) {
    case "oneoff": {
      const tgaOut = lead ? lead.effect >= 0 : release;
      verdictTitle = "일회성일 가능성이 큼";
      verdictBody = (tgaOut ? "재무부가 TGA를 풀어 생긴 유동성은 TGA를 다시 채울 때 도로 흡수됩니다." : "TGA를 채우느라 생긴 흡수는 재무부가 돈을 쓰면 되돌려집니다.")
        + ` 이번 ${dirWord}는 ${f.dominantShare >= 0.8 ? "거의 전부" : "대부분"} 재무부 쪽입니다.`;
      summary = tgaOut ? "재무부가 TGA 잔고를 시중에 푼 결과라 오래가긴 어렵습니다." : "재무부가 TGA 잔고를 채운 결과라 돈을 쓰면 되돌려집니다.";
      break;
    }
    case "persistent": {
      const grew = lead ? lead.effect >= 0 : release;
      verdictTitle = "이어질 가능성이 큼";
      verdictBody = "연준 자산 변화로 생긴 유동성은 정책이 바뀌기 전까지 같은 방향으로 이어집니다.";
      summary = `연준이 자산을 ${grew ? "늘린" : "줄인"} 결과라 정책이 바뀌기 전까지 이어질 가능성이 큽니다.`;
      break;
    }
    case "depends": {
      const out = lead ? lead.effect >= 0 : release;
      verdictTitle = "남은 여력에 달림";
      verdictBody = `역레포 잔고는 ${fmt.amount(f.rrp)} 달러. 바닥에 가까울수록 더 나올 돈이 없습니다.`;
      summary = out ? "MMF가 역레포에서 돈을 뺀 결과라 남은 여력에 달렸습니다." : "MMF가 역레포에 돈을 넣은 결과라 남은 여력에 달렸습니다.";
      break;
    }
    default: {
      verdictTitle = "여러 요인이 섞임";
      verdictBody = `${a.subject} ${fmt.signedEok(a.effect)}${b ? `, ${b.subject} ${fmt.signedEok(b.effect)}` : ""}이 함께 작용했습니다.`;
      summary = b ? `${josa(a.subject, "과와")} ${josa(b.subject, "이가")} 함께 움직여 한 요인으로 설명되지 않습니다.` : `${josa(a.subject, "이가")} 움직였지만 뚜렷한 주도 요인은 없습니다.`;
    }
  }
  if (flat) {
    verdictTitle = "서로 상쇄";
    verdictBody = `${a.subject} ${fmt.signedEok(a.effect)}${b ? `, ${b.subject} ${fmt.signedEok(b.effect)}` : ""}이 서로 상쇄돼 ${N}주간 순변화가 거의 없습니다.`;
    summary = "요인들이 서로 상쇄돼 큰 변화가 없습니다.";
  }
  return { headline, summary: [{ text: summary }], verdictTitle, verdictBody };
}

// ── 03 어디로 ──
export function s3(t: WhereTo): { headline: Part[]; summary: Part[] } {
  const up = t.dNl >= 0, resUp = t.dReserves >= 0;
  // 'X 중 Y' 꼴은 Y ≤ X 일 때만 자연스럽다 — 지급준비금 몫이 순변화를 넘으면(현금통화·기타가 반대로 움직인 경우) 두 항목을 나눠 쓴다.
  if (Number.isFinite(t.resShare) && t.resShare >= 0.7 && t.resShare <= 1) {
    return {
      headline: [{ text: `${up ? "늘어난" : "줄어든"} ${fmt.eok(t.dNl)}억 달러 중 ` }, { text: `${fmt.eok(t.dReserves)}억`, tone: toneOf(t.dReserves) }, { text: `이 은행 지급준비금${resUp ? "으로 들어갔습니다" : "에서 빠졌습니다"}.` }],
      summary: [{ text: `${up ? "늘어난" : "줄어든"} 돈은 대부분 은행 지급준비금${resUp ? "으로 들어갔습니다" : "에서 빠졌습니다"}.` }],
    };
  }
  const text = `지급준비금은 ${fmt.eok(t.dReserves)}억 ${resUp ? "늘고" : "줄고"}, 현금통화·기타는 ${fmt.eok(t.dOther)}억 ${t.dOther >= 0 ? "늘었습니다" : "줄었습니다"}.`;
  return { headline: [{ text }], summary: [{ text }] };
}

// ── 04 누가 샀나 ──
export function s4(w: WhoBought): { headline: string[]; summary: string } {
  if (!w.top) return { headline: ["이 기간에 집계된 입찰이 없습니다."], summary: "이 기간에 집계된 입찰이 없습니다." };
  const subj = BIDDER_SUBJECT[w.top.bidder];
  const first = `${fmt.monthKo(w.start)} 이후 찍은 국채 ${fmt.amount(w.totalReported)} 달러 중 ${w.majority ? "절반 이상인" : "가장 많은"} ${josa(fmt.amount(w.top.value), "을를")} ${josa(subj, "이가")} 가져갔습니다.`;
  const headline = [first];
  if (w.dealerJump && w.dealerSharePrev != null) headline.push(`딜러가 떠안은 몫이 ${Math.round(w.dealerSharePrev * 100)}%에서 ${Math.round(w.dealerShare * 100)}%로 늘었습니다.`);
  return { headline, summary: `새로 찍은 국채는 ${w.majority ? "절반 이상을" : "가장 많은 몫을"} ${josa(subj, "이가")} 받아갔습니다.` };
}

// ── 05 탈은 없나 ──
export function s5(s: Stress): { headline: string[]; summary: string } {
  const n = s.evaluated.length;
  if (n === 0) {
    // 경계는 있는데 값이 없으면 '조회 실패', 경계 자체가 없으면 '설정 없음' — 사유를 구분한다(Codex 2차 F4).
    const msg = s.rows.some((r) => r.threshold != null) ? "자금시장 지표를 불러오지 못해 이번 주는 판정하지 않았습니다." : "경계선이 설정된 지표가 아직 없습니다.";
    return { headline: [msg], summary: msg };
  }
  if (s.breached.length === 0) {
    const first = "자금시장에 긴장 신호는 없습니다.";
    return { headline: [first, `${fmt.count(n)} 지표 모두 경계선 아래입니다.`], summary: first };
  }
  const names = s.breached.map((r) => r.name).join("·");
  const first = `${josa(names, "이가")} 경계선을 넘었습니다.`;
  const rest = n - s.breached.length;
  return { headline: rest > 0 ? [first, `나머지 ${fmt.count(rest)} 지표는 경계선 아래입니다.`] : [first], summary: first };
}
