import type { ChapterParagraph, ChapterReading } from "./chapter-reading.js";
import type { IndicatorAnalysis, LineAnalysis } from "./signals.js";
import { DAY } from "./signals.js";
import type { CreditOutcome } from "./reading.js";
import { creditGap } from "./observations.js";

export const usable = (l?: LineAnalysis): l is LineAnalysis => !!l?.latest && Number.isFinite(l.latest.value) && !l.stale && !l.errors.length;
export const delta = (l: LineAnalysis | undefined, weeks: number) => {
  const c = usable(l) ? l.changes[weeks] : null;
  return c && !c.unchangedRelease && Number.isFinite(c.value) ? c : null;
};
export const para = (text: string, kind: ChapterParagraph["kind"] = "analysis", indicatorId?: string): ChapterParagraph => ({ text, kind, ...(indicatorId ? { indicatorId } : {}) });
const pp = (v: number) => `${Math.abs(v).toFixed(2)}%p`;
const direction = (v: number) => v > 0 ? "늘었습니다" : v < 0 ? "줄었습니다" : "변하지 않았습니다";
const comparable = (a: ReturnType<typeof delta>, b: ReturnType<typeof delta>) => !!a && !!b && a.from === b.from && a.to === b.to;
export const BOND_DEFINITION = "OAS(옵션 조정 스프레드)는 콜옵션(조기상환권) 등이 내재된 회사채에서 수학 모델로 옵션 효과를 제거한 스프레드입니다. 즉, OAS를 통해 순수하게 신용 위험과 유동성 프리미엄만 살펴볼 수 있습니다.";

// 서로 다른 시점·정의의 계열을 억지로 인과 관계로 묶지 않는다.
export function enrichCreditReport(id: string, base: ChapterReading, data: IndicatorAnalysis[], outcome: CreditOutcome, weeks: 4 | 13): ChapterReading {
  const item = (id: string) => data.find(i => i.id === id);
  const line = (id: string) => item(id)?.lines[0];
  const paragraphs: ChapterParagraph[] = [];
  const report = () => ({ text: paragraphs.filter(p => p.kind !== "explanation").map(p => p.text).join("\n\n"), details: paragraphs.filter(p => p.kind === "explanation").map(p => p.text), paragraphs });
  if (id === "credit-bank") {
    const original = base.paragraphs ?? [];
    const loans = line("h8_ci_loans"), c = delta(loans, weeks), medium = delta(loans, 13);
    paragraphs.push(...original.slice(0, 2));
    if (c && medium && weeks === 4 && Math.sign(c.value) !== Math.sign(medium.value)) paragraphs.push(para(
      `최근 비교 구간과 중기 흐름은 다릅니다. 기업대출 잔액은 ${medium.from}~${medium.to}에는 ${direction(medium.value)}. 최근의 ${c.value < 0 ? "감소" : "증가"}를 이보다 긴 추세와 구분해서 읽어야 합니다.`, "analysis", "h8_ci_loans"));
    paragraphs.push(...original.slice(2, 3));
    paragraphs.push(...original.slice(3, 5));
    const sizes = item("h8_large_vs_small_banks")?.lines ?? [];
    const changes = sizes.map(l => delta(l, weeks));
    if (sizes.length === 4 && changes.every(Boolean)) {
      paragraphs.push(para(changes.every(c => c!.value > 0)
        ? "대형은행과 소형은행 모두 예금과 대출·리스 잔액이 늘었습니다. 소형은행에만 자금 유출과 대출 감소가 집중되는 모습은 아닙니다."
        : "대형·소형은행의 예금과 대출은 방향이 모두 같지 않습니다. 전체 기업대출의 흐름과 개별 은행군의 자금 여건을 구분해야 합니다.", "analysis", "h8_large_vs_small_banks"));
    }
    const ndfi = delta(line("h8_loans_to_nondepository"), weeks);
    if (ndfi) paragraphs.push(para(ndfi.value > 0
      ? "은행이 비은행 금융회사에 빌려준 잔액도 늘었습니다. 증가 자체가 부실은 아니지만, 비은행의 대출자산이 나빠질 때 은행으로 부담이 전달될 수 있는 연결 규모가 커졌다는 뜻입니다."
      : "은행의 비은행 금융회사 대출 잔액은 줄거나 정체됐습니다. 잔액 감소만으로 비은행의 위험이나 은행의 관련 손실이 줄었다고 볼 수는 없습니다.", "analysis", "h8_loans_to_nondepository"));
    paragraphs.push(...original.slice(5));
    return report();
  }
  if (id === "credit-bonds") {
    const issuance = line("corporate_bond_issuance");
    paragraphs.push(para(usable(issuance) && issuance.latest!.value > 0
      ? `최근 확인된 ${issuance.latest!.date.slice(0, 7)} 회사채 발행은 이어졌습니다.${issuance.metrics.yoy != null ? ` 전체 발행액은 전년 같은 달보다 ${Math.abs(issuance.metrics.yoy).toFixed(1)}% ${issuance.metrics.yoy >= 0 ? "늘었습니다" : "줄었습니다"}.` : ""} 다만 발행이 이어졌다는 사실만으로 기업의 조달 부담까지 낮다고 볼 수는 없습니다.`
      : "최근 회사채 발행을 확인할 자료가 부족합니다. 가격 지표만으로 실제 자금 조달이 이어졌다고 판단하지 않습니다."));
    const observations = ["ig_oas", "hy_oas"].map(key => {
      const spread = line(key), rate = item(key)?.comparisonLines?.[0];
      return { key, spread, rate, s: delta(spread, weeks), r: delta(rate, weeks) };
    });
    for (const {key, s, r, rate} of observations) {
      const name = key === "ig_oas" ? "우량 기업(IG)" : "저신용 기업(HY)";
      if (!comparable(s, r)) { paragraphs.push(para(`${name}의 시장금리와 프리미엄을 같은 구간으로 비교할 자료가 부족합니다.`, "explanation")); continue; }
      paragraphs.push(para(`${name}의 시장금리는 ${weeks}주간 ${pp(r!.value)} ${r!.value > 0 ? "상승" : r!.value < 0 ? "하락" : "변화 없음"}, 위험 프리미엄은 ${pp(s!.value)} ${s!.value > 0 ? "확대" : s!.value < 0 ? "축소" : "변화 없음"}입니다 (${r!.from} → ${r!.to}).`));
      paragraphs.push(para(r!.value > 0
        ? s!.value > 0 ? `${name}의 시장금리와 위험 프리미엄이 함께 올랐습니다. 금리 상승과 함께 투자자가 추가 보상을 요구하고 있어, 신규 차입과 차환 부담이 커졌습니다.`
          : s!.value < 0 ? `${name}의 위험 프리미엄은 줄었지만 시장금리는 올랐습니다. 신용에 대한 평가가 개선돼도 기업이 새로 돈을 빌리는 비용은 높아질 수 있습니다.` : `${name}의 위험 프리미엄은 그대로인데 시장금리는 올랐습니다. 프리미엄이 같아도 새 차입·차환 비용은 높아질 수 있습니다.`
        : r!.value < 0 ? s!.value > 0 ? `${name}의 시장금리는 내렸지만 위험 프리미엄은 올랐습니다. 금리 하락이 조달 비용을 낮추는 동안에도 신용에 대한 우려는 커진 조합입니다.`
          : `${name}의 시장금리와 위험 프리미엄이 함께 낮아지거나 안정됐습니다. 가격 측면에서는 신규 차입과 차환 여건이 개선되는 방향입니다.`
        : `${name}의 시장금리는 비교한 두 관측에서 같습니다. 위험 프리미엄은 ${s!.value > 0 ? "올랐습니다" : s!.value < 0 ? "내렸습니다" : "변하지 않았습니다"}.`));
      if (usable(rate) && rate.metrics.percentile != null && rate.sampleCount >= 100 && rate.sampleStart && rate.sampleEnd) paragraphs.push(para(
        `${name}의 현재 시장금리는 확보한 ${rate.sampleStart}~${rate.sampleEnd} 표본에서 현재 값의 백분위가 ${rate.metrics.percentile.toFixed(0)}%입니다 (${rate.sampleCount}개 관측).`, "analysis"));
    }
    const [ig, hy] = observations;
    if (comparable(ig.r, hy.r)) paragraphs.push(para(ig.r!.value > 0 && hy.r!.value > ig.r!.value
      ? "두 등급의 조달 비용이 함께 올랐고, 저신용 기업의 상승 폭이 더 컸습니다. 시장 전체의 조달 중단과 신용등급별 비용 부담을 나눠서 볼 필요가 있습니다."
      : "등급별 시장금리의 방향과 실제 발행을 함께 봐야 합니다. 한 등급의 가격만으로 회사채 시장 전체의 접근성을 판단하기 어렵습니다.", "conclusion"));
    if (usable(issuance)) paragraphs.push(para(`발행 자료는 ${issuance.latest!.date} 기준입니다. 그 이후 금리 변화가 발행 감소로 이어졌는지는 다음 월간 자료에서 확인해야 합니다. 전체 발행액으로 IG·HY 각각의 발행 상황을 확정하지 않습니다.`, "explanation"));
    paragraphs.push(para("시장금리는 신규 발행·차환 여건의 참고치입니다. 기업이 기존 부채 전체에 지급하는 평균 이자율과는 다르며, 시장금리에서 OAS를 빼 국채 금리 기여분을 정확히 분해하지 않습니다.", "explanation"));
    return report();
  }
  if (id === "credit-short") {
    const amount = line("cp_outstanding"), spread = line("cp_spread"), a = delta(amount,weeks), s = delta(spread,weeks);
    paragraphs.push(para("기업어음(CP)은 기업이 단기 운영자금을 빌리는 수단입니다. 잔액 감소가 조달 경색인지 확인하려면 추가 금리 부담과 은행 차입을 함께 봐야 합니다.", "explanation"));
    paragraphs.push(para(!a || !s ? "CP 잔액과 금리차를 함께 비교할 자료가 부족합니다. 어느 한쪽만으로 단기 조달 상태를 정상이라고 판단하지 않습니다."
      : a.value < 0 && s.value <= 0 ? "CP 잔액은 줄었지만 국채 대비 추가 금리는 확대되지 않았습니다. 자금 조달량 감소와 가격 급등이 겹치는 모습은 나타나지 않았습니다."
      : a.value < 0 && s.value > 0 ? "CP 잔액이 줄어드는 동안 국채 대비 추가 금리는 올랐습니다. 조달 규모와 가격이 모두 불리한 방향이어서, 기업의 단기 자금 사정을 더 살펴야 합니다."
      : a.value > 0 && s.value > 0 ? "CP 잔액과 국채 대비 추가 금리가 함께 늘었습니다. 조달은 이어지지만 기업이 부담하는 프리미엄은 높아졌습니다."
      : "CP 잔액은 유지되거나 늘었고, 추가 금리는 확대되지 않았습니다. 수량과 가격을 함께 보면 단기 조달이 위축됐다는 근거는 제한적입니다."));
    const loans = delta(line("h8_ci_loans"), weeks);
    paragraphs.push(para(loans && a && s ? `은행 기업대출 잔액은 같은 선택 기간에 ${direction(loans.value)}. ${loans.value <= 0 ? "CP 조달 감소를 메우기 위한 은행 대출 급증은 이 비교에서는 나타나지 않았습니다." : "은행 차입 증가는 확인되지만, 잔액만으로 비상 한도 인출인지 평소의 대출 수요인지 구분할 수는 없습니다."}`
      : "은행 기업대출의 동반 변화를 확인할 자료가 부족해, 비상 차입 여부까지 평가하지 않았습니다.", "conclusion"));
    // 분기말 효과는 같은 과거 분기말의 같은 일수 변화와 비교한다. 표본이 부족하면 추정하지 않는다.
    if (usable(amount) && a && /-(03|06|09|12)-/.test(amount.latest!.date) && Number(amount.latest!.date.slice(8)) >= 25) {
      const span = Math.round((Date.parse(a.to)-Date.parse(a.from))/DAY);
      const ends = new Map<string, {date:string;value:number}>();
      for (const p of amount.points) if (p.date < a.to && /-(03|06|09|12)-/.test(p.date) && Number(p.date.slice(8))>=25) ends.set(p.date.slice(0,7),p);
      const sample=[...ends.values()].flatMap(p=>{const target=Date.parse(p.date)-span*DAY;const old=amount.points.findLast(q=>Date.parse(q.date)<=target);return old&&target-Date.parse(old.date)<=7*DAY&&old.value>0?[(p.value/old.value-1)*100]:[];});
      if(sample.length>=4 && a.pct!=null) paragraphs.push(para(`과거 분기말 ${sample.length}회의 같은 ${span}일 변화율과 비교하면 이번 변화는 ${a.pct>=Math.min(...sample)&&a.pct<=Math.max(...sample)?"과거 관측 범위 안":"과거 관측 범위 밖"}입니다. 분기말 비교는 보조 근거이며 계절 요인으로 원인을 확정하는 것은 아닙니다.`));
    }
    paragraphs.push(para(`CP 잔액은 전체 시장, 금리차는 A2/P2 비금융 90일물 기준입니다.${a&&s?` 잔액 ${a.from}~${a.to}, 금리차 ${s.from}~${s.to}.`:""} 대상과 관측일이 다를 수 있습니다.`,"explanation"));
    return report();
  }
  if(id === "credit-fragile") {
    const c=delta(line("ccc_oas"),weeks), h=delta(line("hy_oas"),weeks);
    paragraphs.push(para("CCC 이하는 신용등급이 매우 낮은 기업의 회사채입니다. HY 전체와 비교하면 저신용 기업 전반의 부담인지, 가장 취약한 기업에 집중된 부담인지 구분하는 데 도움이 됩니다.","explanation"));
    if (c) paragraphs.push(para(`CCC 자체의 위험 프리미엄은 ${c.from}~${c.to} ${pp(c.value)} ${c.value > 0 ? "올랐습니다" : c.value < 0 ? "내렸습니다" : "변화가 없습니다"}.`));
    paragraphs.push(para(comparable(c,h)
      ? c!.value-h!.value>0 ? `CCC와 HY의 프리미엄 격차는 ${pp(c!.value-h!.value)} 확대됐습니다. ${c!.value>0?"CCC 자체의 프리미엄도 올라, 가장 취약한 기업의 부담이 상대적으로 더 커졌습니다.":"다만 CCC 자체의 프리미엄은 오르지 않아, 격차 확대만으로 비용 악화를 뜻하지는 않습니다."}`
      : "CCC와 HY의 프리미엄 격차는 축소되거나 유지됐습니다. 격차 변화만으로 취약 기업의 절대적인 조달 부담이 낮다고 판단하지는 않습니다."
      : "CCC와 HY의 프리미엄을 같은 구간으로 비교할 자료가 부족합니다."));
    const cl=line('ccc_oas'),hl=line('hy_oas');
    if(usable(cl)&&usable(hl)&&cl.latest!.date===hl.latest!.date){
      const target=Date.parse(cl.latest!.date)-365*DAY;
      const byDate=new Map(hl.points.map(p=>[p.date,p.value]));
      const old=cl.points.findLast(p=>Date.parse(p.date)<=target&&byDate.has(p.date));
      if(old&&target-Date.parse(old.date)<=7*DAY){
        const before=old.value-byDate.get(old.date)!,now=cl.latest!.value-hl.latest!.value;
        paragraphs.push(para(`두 등급의 격차를 1년 전과 비교하면 ${before.toFixed(2)}%p에서 ${now.toFixed(2)}%p로 ${now>before?'확대됐습니다':now<before?'축소됐습니다':'유지됐습니다'}. 단기 변화뿐 아니라 오래 누적된 신용등급별 차이도 확인할 수 있습니다.`));
      }
    }
    const gap = creditGap(data, weeks);
    if (gap?.previous && gap.change != null) paragraphs.push(para(`같은 날의 CCC·HY 관측을 맞추면 최근 ${weeks}주 격차는 ${gap.previous.value.toFixed(2)}%p에서 ${gap.current.value.toFixed(2)}%p로 변했습니다 (${gap.previous.date} → ${gap.current.date}).`));
    paragraphs.push(para("BDC는 기업에 직접 대출하는 상장 투자회사입니다. P/NAV는 주가를 주당 순자산가치로 나눈 값으로, 시장의 평가와 공시 장부가 사이의 차이를 보여줍니다.","explanation"));
    const prices=item('bdc_price_to_nav')?.lines.filter(l=>delta(l,weeks))??[];
    if(prices.length) {
      const falling=prices.filter(l=>delta(l,weeks)!.value<0).map(l=>l.label);
      paragraphs.push(para(falling.length?`${falling.join('·')}의 P/NAV가 낮아졌습니다. 대출투자회사에 대한 시장 평가가 약해진 방향이지만, 할인에는 자산 우려뿐 아니라 금리·배당·회사별 차이도 영향을 줍니다.`:"비교 가능한 BDC의 P/NAV는 낮아지지 않았습니다. 가격이 안정적이어도 아직 공시되지 않은 대출자산의 변화까지 확인된 것은 아닙니다."));
    } else paragraphs.push(para("BDC 가격과 장부가의 변화를 확인할 자료가 부족합니다.","explanation"));
    const quality=item('bdc_credit_quality')?.lines.filter(l=>usable(l)&&l.metrics.previousDelta!=null)??[];
    for (const [label,group] of [["원가 기준 부실 비중",quality.filter(l=>/원가/.test(l.label))],["PIK 비중",quality.filter(l=>/PIK/.test(l.label))]] as const) {
      const up=group.filter(l=>l.metrics.previousDelta!>0).map(l=>l.label.split(' ')[0]), down=group.filter(l=>l.metrics.previousDelta!<0).map(l=>l.label.split(' ')[0]);
      if(group.length) paragraphs.push(para(`${label}은 직전 공시 대비 ${[up.length?`${up.join('·')}에서 상승`:null,down.length?`${down.join('·')}에서 하락`:null].filter(Boolean).join(', ')||'유지'}했습니다. ${up.length&&down.length?'회사별 방향이 달라 이 항목이 BDC 전반에서 일제히 악화됐다고 보기는 어렵습니다.':up.length?'가격의 우려와 실제 공시의 변화를 함께 추적해야 합니다.':'현재 공시 범위에서는 동반 상승이 확인되지 않았습니다.'}`));
    }
    if(!quality.length)paragraphs.push(para("부실·PIK 공시의 비교 자료가 부족해 가격의 우려가 실제 대출자산에도 나타났는지 확인하지 못했습니다.","explanation"));
    const etfs=item('leveraged_loans')?.lines.filter(l=>delta(l,weeks))??[];
    if(etfs.length)paragraphs.push(para(`대출 ETF의 분배금 반영 성과는 ${etfs.every(l=>delta(l,weeks)!.value>=0)?'유지되거나 올랐습니다':'일부 또는 모두 내렸습니다'}. 변동금리 대출과 분배금 누적의 영향을 받으므로, CCC·BDC와 다른 방향이라고 해서 신용 우려를 지우는 근거로 쓰지는 않습니다.`));
    paragraphs.push(para("PIK는 이자를 현금 대신 원금 등에 더해 받는 방식입니다. 부실·PIK는 분기 공시, 가격은 일간 자료이며 BDC와 대출 ETF가 사모대출 전체를 대표하지는 않습니다.","explanation"));
    paragraphs.push(para(c&&h&&comparable(c,h)&&c.value>h.value&&c.value>0&&prices.some(l=>delta(l,weeks)!.value<0)?"취약 기업의 프리미엄과 BDC 시장 평가가 함께 나빠지는 조합입니다. 다음 분기 공시에서도 악화가 이어지는지, HY 전체로 부담이 번지는지가 중요합니다.":"취약 기업의 가격, BDC 시장 평가, 실제 부실 공시의 방향을 구분해 봐야 합니다. 일부 지표만으로 사모대출 전체의 위기를 확정하지 않습니다.","conclusion"));
    return report();
  }
  if(id==='credit-watchpoints') {
    paragraphs.push(para("다음에는 준비금 감소와 단기 금리 압박이 함께 나타나는지, 회사채 발행이 가격 악화 뒤에도 이어지는지, 취약 기업의 우려가 실제 부실 공시로 이어지는지 확인합니다."));
    return report();
  }
  return base;
}

export function creditWatchpoints(data: IndicatorAnalysis[], outcome: CreditOutcome, weeks: 4 | 13 = 4) {
  const points: {title:string;text:string;detail?:string}[]=[];
  const gap = creditGap(data, weeks);
  points.push({title: '취약 기업과 HY 전체의 차이', text: 'CCC와 HY 프리미엄의 격차가 확대되는지, CCC 자체의 금리도 오르는지 함께 봅니다.', detail: gap?.previous && gap.change != null ? `${gap.previous.date} → ${gap.current.date}: 격차 ${gap.previous.value.toFixed(2)}%p → ${gap.current.value.toFixed(2)}%p.` : '같은 날짜의 비교 관측이 부족합니다.'});
  points.push({title: '기업의 단기 조달', text: 'CP 잔액·금리차와 은행 기업대출 잔액의 방향을 함께 봅니다. 은행 대출 증가만으로 비상 차입을 단정할 수는 없습니다.'});
  const issue=data.find(i=>i.id==='corporate_bond_issuance')?.lines.find(usable);
  points.push({title:'다음 회사채 발행',text:`가격 변화 뒤에도 실제 발행이 이어지는지 확인합니다.${issue?` 현재 발행 자료는 ${issue.latest!.date}까지입니다.`:' 현재 발행 자료가 부족합니다.'}`});
  points.push({title:'다음 은행 조사와 BDC 공시',text:'SLOOS의 심사 태도·차입 수요가 최근 잔액 변화와 일치하는지, BDC의 부실·PIK 변화가 가격에 나타난 우려를 뒷받침하는지 확인합니다.'});
  return points;
}
