import { pathLabel, type Conflict, type Json } from "../../../shared/cap-collaboration";
import { type ValueConflict } from "../../../shared/cap-text-merge";
import { plainText } from "./capitalism-richtext";

function at(value: Json, path: string[]): Json {
  for (const key of path) {
    if (!value || typeof value !== "object") return null;
    value = (value as Record<string, Json>)[key] ?? null;
  }
  return value;
}
export function conflictContext(field: Conflict, part: ValueConflict): string {
  const relative = part.location.slice(field.path.length), cells = relative.indexOf("cells");
  const axis = relative.findIndex(key => key === "rows" || key === "columns");
  if (axis >= 0) {
    const table = at(field.before, relative.slice(0, axis)) as { title?: string; cells?: string[][] } | null;
    const index = Number(relative[axis + 1]), isRow = relative[axis] === "rows";
    const label = isRow ? table?.cells?.[index]?.[0] : table?.cells?.[0]?.[index];
    return [table?.title || pathLabel(field.path), label ? plainText(label) : `${index + 1}${isRow ? "행" : "열"}`, `${isRow ? "행" : "열"} 삭제와 수정`].join(" · ");
  }
  if (cells >= 0) {
    const table = at(field.before, relative.slice(0, cells)) as { title?: string; cells?: string[][] } | null;
    const row = Number(relative[cells + 1]), col = Number(relative[cells + 2]);
    const rowLabel = row > 0 ? table?.cells?.[row]?.[0] : "표 머리글", colLabel = table?.cells?.[0]?.[col];
    return [table?.title || pathLabel(field.path), rowLabel ? plainText(rowLabel) : `${row + 1}행`, colLabel ? plainText(colLabel) : `${col + 1}열`].join(" · ");
  }
  return part.location.map((p, i) => /^\d+$/.test(p) ? `${Number(p) + 1}번째` : pathLabel([p])).join(" · ") || pathLabel([]);
}
