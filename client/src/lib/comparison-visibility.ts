import { COMPARE_SERIES } from "./comparison-series";

export const TOGGLE_CATEGORIES = ["dollar", "economy"] as const;
export type ToggleCategory = typeof TOGGLE_CATEGORIES[number];
export const isToggleCategory = (value: string): value is ToggleCategory =>
  TOGGLE_CATEGORIES.some(key => key === value);

export function readHiddenCategories(value: unknown): ToggleCategory[] {
  return Array.isArray(value) ? TOGGLE_CATEGORIES.filter(key => value.includes(key)) : [];
}

// Visibility is separate from selection so hiding a category preserves its subset.
export function visibleIndicatorIds(ids: string[], hidden: ToggleCategory[]): string[] {
  return ids.filter(id => !hidden.some(category =>
    COMPARE_SERIES.some(s => s.id === id && s.category === category)));
}
