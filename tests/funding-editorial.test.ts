import { expect, it } from 'vitest';
import { authoredFundingReading } from '../shared/funding-editorial';

it('사용자가 지정한 해설만 해당 관측 조건에서 남긴다', () => {
  const current = authoredFundingReading('2026-09-30', 4, 0, true);
  expect(current).toHaveLength(5);
  expect(current[2].text).toContain('금융여건은 아직 완화적이지만');
  expect(authoredFundingReading('2026-09-23', 4, 2, true)).toEqual([]);
  expect(authoredFundingReading('2026-09-30', 13, 2, true)).toEqual([]);
  expect(authoredFundingReading('2026-09-30', 4, null, false)).toEqual([]);
});
