export function NonbankLendingNote() {
  return <div className="space-y-5 text-sm leading-[1.85] text-[#3B3934]" data-testid="nonbank-lending-note">
    <section className="space-y-3">
      <h4 className="text-sm font-semibold">비은행 금융회사의 예시</h4>
      <p>예금을 받지 않으면서 돈을 빌려주거나 굴리는 금융회사 전부입니다. 은행이 이들에게 빌려준 돈이 이 그래프의 잔액입니다.</p>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong className="font-semibold">사모대출 펀드와 BDC</strong>: 중견기업에 직접 대출하는 펀드입니다.</li>
        <li><strong className="font-semibold">사모펀드(PE)</strong>: 투자자에게 돈을 걷기 전에 은행에서 먼저 당겨 쓰는 한도대출을 씁니다.</li>
        <li><strong className="font-semibold">모기지 회사</strong>: 예금 없이 주택담보대출을 내주는 회사로, 대출을 팔기 전까지 은행 돈으로 버팁니다.</li>
        <li><strong className="font-semibold">소비자금융·자동차금융 회사</strong>: 할부금융, 카드론, 선구매 후결제 업체 등입니다.</li>
        <li><strong className="font-semibold">유동화 기구</strong>: 대출을 묶어 증권으로 만드는 특수목적회사(CLO 등)입니다.</li>
        <li><strong className="font-semibold">증권사, 보험사, 리츠, 헤지펀드</strong> 등도 포함됩니다.</li>
      </ul>
    </section>
    <section className="space-y-3">
      <h4 className="text-sm font-semibold">즉, 이 그래프를 통해 은행 돈이 사모대출 쪽으로 빠져나가는 추세를 확인할 수 있습니다.</h4>
      <p>사모대출 펀드는 투자자 돈만으로 대출하지 않고 은행에서 빌려 규모를 키웁니다. 그래서 겉으로는 은행이 기업 대출에서 빠지고 펀드가 대신한 것처럼 보여도, 실제로는 은행 돈이 펀드를 거쳐 같은 기업에 가는 구조가 많습니다. 단, 이 잔액은 상술한 것처럼 비은행 전체이고, 사모대출 몫만 따로 볼 수는 없습니다.</p>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong className="font-semibold">이 그래프는 스트레스 지표가 아니라 연결 통로의 굵기입니다.</strong> 잔액이 늘어난 것 자체는 부실이 아닙니다. 사모대출에서 손실이 났을 때 은행으로 번질 수 있는 길이 그만큼 넓어졌다는 뜻입니다.</li>
        <li><strong className="font-semibold">은행은 보통 선순위입니다.</strong> 펀드 자산을 담보로 잡고 먼저 돌려받기 때문에, 펀드 손실이 꽤 커져야 은행 손실이 됩니다. 연결돼 있지만 1:1로 전염되지는 않습니다.</li>
      </ul>
    </section>
  </div>;
}
