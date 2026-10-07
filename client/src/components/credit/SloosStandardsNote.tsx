export function SloosStandardsNote() {
  return <div className="space-y-5 text-sm leading-[1.85] text-[#3B3934]" data-testid="sloos-standards-note">
    <p>이 %는 금리가 아니라 <strong className="font-semibold">조였다는 은행 비율에서 풀었다는 은행 비율을 뺀 값</strong>입니다. 예를 들어 100개 은행 중 20곳이 조이고 5곳이 풀고 75곳이 그대로면 +15입니다.</p>
    <section className="space-y-3">
      <h4 className="text-sm font-semibold">부호로 읽습니다</h4>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong className="font-semibold">양수는 강화</strong>: 조이는 은행이 더 많습니다.</li>
        <li><strong className="font-semibold">음수는 완화</strong>: 푸는 은행이 더 많습니다.</li>
        <li><strong className="font-semibold">0은 중립</strong>: 조이는 은행과 푸는 은행 수가 같습니다.</li>
      </ul>
    </section>
    <section className="space-y-3">
      <h4 className="text-sm font-semibold">헷갈리기 쉬운 두 가지</h4>
      <ul className="list-disc pl-5 space-y-3">
        <li><strong className="font-semibold">수준이 아니라 변화를 묻는 설문입니다.</strong> 질문이 “지난 3개월간 기준을 바꿨습니까”이기 때문입니다. 그래서 0은 “대출받기 쉽다”가 아니라 “조인 은행과 푼 은행이 균형을 이룬다”는 뜻입니다. 모든 은행이 기준을 그대로 뒀다는 뜻은 아닙니다.</li>
        <li><strong className="font-semibold">숫자가 내려가도 양수면 여전히 조이는 중입니다.</strong> 33.9에서 8.1로 내려온 것은 완화가 아니라 조이는 속도가 느려진 것입니다. 자동차로 치면 브레이크를 덜 밟는 것이지 가속 페달을 밟은 것이 아닙니다.</li>
      </ul>
    </section>
  </div>;
}
