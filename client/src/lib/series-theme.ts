// View-only adapter: never mutate the financial datasets' IDs or payloads.
export const seriesColors: Record<string, string> = {
  foreign: 'var(--tone-blue-700)', fed: 'var(--tone-blue-400)',
  mmf: 'var(--tone-violet-500)', households: 'var(--tone-amber-300)',
  funds: 'var(--tone-blue-200)', banks: 'var(--tone-indigo-600)',
  pensions: 'var(--tone-orange-200)', other: 'var(--line-soft)',
  ig_oas: 'var(--tone-teal-600)', hy_oas: 'var(--tone-amber-600)', ccc_oas: 'var(--tone-blue-600)',
  discount: 'var(--tone-blue-700)', repo: 'var(--tone-teal-500)',
  swap: 'var(--tone-amber-500)', btfp: 'var(--tone-violet-500)',
};
