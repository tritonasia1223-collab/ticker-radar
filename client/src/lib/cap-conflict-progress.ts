import type { Resolution, ValueConflict } from "../../../shared/cap-text-merge";

export interface ConflictProgress {
  signatures: Record<string, string>;
  choices: Record<string, Resolution>;
  manual: Record<string, string>;
  expanded: Record<string, boolean>;
  cursor: string | null;
}
export const passageSignature = (item: ValueConflict) => JSON.stringify([item.before, item.local, item.remote]);

// Stored choices are valid only for the exact three inputs the user saw.
// Manual writing remains available for an existing passage if its inputs change,
// but the user must explicitly select it again before it can be saved.
export function restoreConflictProgress(items: ValueConflict[], stored?: ConflictProgress): ConflictProgress {
  const signatures = Object.fromEntries(items.map(item => [item.id, passageSignature(item)]));
  const choices = Object.fromEntries(Object.entries(stored?.choices ?? {}).filter(([id]) => signatures[id] && stored?.signatures[id] === signatures[id]));
  // Keep older writing even if a newer comparison splits/joins the passage.
  // Such writing is shown separately and is never automatically selected.
  const manual = { ...stored?.manual };
  const expanded = Object.fromEntries(Object.entries(stored?.expanded ?? {}).filter(([id]) => id in signatures));
  const invalidated = Object.keys(stored?.choices ?? {}).some(id => !(id in choices));
  const cursor = !invalidated && stored?.cursor && stored.cursor in signatures ? stored.cursor
    : items.find(item => !choices[item.id])?.id ?? null;
  return { signatures, choices, manual, expanded, cursor };
}
