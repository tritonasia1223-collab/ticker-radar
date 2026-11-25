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
  const addedAxis = relative.findIndex(key => key === "addedRows" || key === "addedColumns");
  if (addedAxis >= 0) {
    const table = at(field.before, relative.slice(0, addedAxis)) as { title?: string } | null;
    return [table?.title || pathLabel(field.path), `${Number(relative[addedAxis + 1]) + 1}${relative[addedAxis] === "addedRows" ? "행" : "열"}`, "이름 없는 새 항목"].join(" · ");
  }
  const axis = relative.findIndex(key => key === "rows" || key === "columns");
  if (axis >= 0) {
    const table = at(field.before, relative.slice(0, axis)) as { title?: string; cells?: string[][] } | null;
    const index = Number(relative[axis + 1]), isRow = relative[axis] === "rows";
    const label = isRow ? table?.cells?.[index]?.[0] : table?.cells?.[0]?.[index];
    return [table?.title || pathLabel(field.path), label ? plainText(label) : `${index + 1}${isRow ? "행" : "열"}`, `${isRow ? "행" : "열"} 삭제와 수정`].join(" · ");
  }
  if (cells >= 0) {
    const table = at(field.before, relative.slice(0, cells)) as { title?: string; cells?: string[][] } | null;
    const rowId = relative[cells + 1], colId = relative[cells + 2], addedRow = rowId.startsWith("added-r"), addedCol = colId.startsWith("added-r");
    const row = Number(addedRow ? rowId.slice(7) : rowId), col = Number(addedCol ? colId.slice(7) : colId);
    const latest = at(field.remote, relative.slice(0, cells)) as { cells?: string[][] } | null;
    const rowLabel = row > 0 ? (addedRow ? latest : table)?.cells?.[row]?.[0] : "표 머리글", colLabel = (addedCol ? latest : table)?.cells?.[0]?.[col];
    return [table?.title || pathLabel(field.path), rowLabel ? plainText(rowLabel) : `${row + 1}행${addedRow ? " (추가)" : ""}`, colLabel ? plainText(colLabel) : `${col + 1}열${addedCol ? " (추가)" : ""}`].join(" · ");
  }
  return part.location.map((p, i) => /^\d+$/.test(p) ? `${Number(p) + 1}번째` : pathLabel([p])).join(" · ") || pathLabel([]);
}
