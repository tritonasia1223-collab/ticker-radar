import { describe,it,expect } from 'vitest';
import { bankComparison } from '../shared/credit/bank-comparison';
describe('대형·소형은행 비교 기준',()=>{
  it('공통 시작일을 100으로 맞추고 이후 결측은 비워둔다',()=>{
    const r=bankComparison([{date:'2026-01-01',value:50},{date:'2026-01-08',value:100},{date:'2026-01-15',value:110}],[{date:'2026-01-08',value:200},{date:'2026-01-22',value:180}], '2026-01-22',1,true);
    expect(r.base).toBe('2026-01-08');expect(r.rows[0]).toEqual({date:'2026-01-08',large:100,small:100});
    expect(r.rows[1].large).toBeCloseTo(110);expect(r.rows[1].small).toBeNull();expect(r.rows[2].small).toBe(90);
  });
  it('선택일 이후 자료를 제외하고 실제 잔액은 그대로 표시한다',()=>{
    const r=bankComparison([{date:'2026-01-08',value:100},{date:'2026-02-01',value:900}],[], '2026-01-22',1,false);
    expect(r.rows).toEqual([{date:'2026-01-08',large:100,small:null}]);
    expect(bankComparison([{date:'2026-01-08',value:100}],[], '2026-01-22',1,true).rows).toEqual([]);
  });
});
