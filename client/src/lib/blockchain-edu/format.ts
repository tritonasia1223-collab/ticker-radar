// 블록체인 학습 탭 — 표시 포맷터. 수수료는 $1e-10 ~ $2만 까지 폭이 넓어 적응형.
export function fmtUSD(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return "$0";
  if (a < 0.01) return "<$0.01";
  if (a < 1000) return `$${v.toFixed(2)}`;
  if (a < 1_000_000) return `$${Math.round(v).toLocaleString()}`;
  return `$${(v / 1_000_000).toFixed(2)}M`;
}

// 툴팁용 정밀 표기(아주 작은 값도 유효숫자 표시).
export function fmtUSDprecise(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return "$0";
  if (a < 1e-4) return `$${v.toExponential(2)}`;
  if (a < 1) return `$${v.toFixed(4)}`;
  if (a < 1000) return `$${v.toFixed(2)}`;
  return `$${Math.round(v).toLocaleString()}`;
}

export const fmtPct = (frac: number) => `${(frac * 100).toFixed(frac < 0.1 ? 1 : 0)}%`;
