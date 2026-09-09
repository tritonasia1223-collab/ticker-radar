// 달력 간격으로 비교한다. 결측을 건너뛴 배열의 n행 전은 n주/개월 전과 다르다.
export const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
export const consecutiveMonths = (before: string, after: string) => monthIndex(after) - monthIndex(before) === 1;
export function weeksBefore<T extends { date: string }>(points: T[], date: string, count: number): T | undefined {
  const target = new Date(Date.parse(date) - count * 7 * 86400000).toISOString().slice(0, 10);
  return points.find((p) => p.date === target);
}
export function completeYear<T extends { date: string }>(points: T[], endDate: string): T[] | undefined {
  const end = monthIndex(endDate);
  const window = points.filter((p) => monthIndex(p.date) > end - 12 && monthIndex(p.date) <= end);
  return window.length === 12 && new Set(window.map((p) => monthIndex(p.date))).size === 12 ? window : undefined;
}

// JSON은 NaN을 null로 전송한다. 숫자 필드의 null은 연산 전에 NaN으로 복원하여 null-숫자=음수 오류를 막는다.
export function restoreMissingNumbers<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload), (_key, value) => value === null ? NaN : value) as T;
}
