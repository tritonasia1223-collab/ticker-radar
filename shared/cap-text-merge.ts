import type { Json } from "./cap-collaboration.js";

export type Resolution = "local" | "remote" | { text: string };
export interface Passage { text: string; ranges: [number, number][] }
export interface ValueConflict {
  id: string;
  location: string[];
  before: Json;
  local: Json;
  remote: Json;
  passage?: { before: Passage; local: Passage; remote: Passage };
}
export interface ValueMerge { value: Json; conflicts: ValueConflict[] }
const eq = (a: Json, b: Json): boolean => JSON.stringify(a) === JSON.stringify(b);
const obj = (v: Json): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v);
const prose = new Set(["text", "body", "title", "caption", "ref", "refBlue", "inLabel", "alt"]);
export function blockMirrors(value: Json): Record<string, Json> | null {
  if (!obj(value) || !Array.isArray(value.blocks)) return null;
  const blocks = value.blocks.filter(obj);
  return { text: blocks.filter(b => b.type === "text").map(b => b.text).join("\n"), tables: blocks.filter(b => b.type === "table").map(b => b.table), images: blocks.filter(b => b.type === "image").map(b => b.image), charts: blocks.filter(b => b.type === "chart").map(b => b.chart) };
}
export function syncBlockMirrors(value: Json, source: Json): Json {
  if (!obj(value) || !obj(source)) return value;
  const before = blockMirrors(source), after = blockMirrors(value);
  if (before && after) for (const key of Object.keys(before)) if (key in source && eq(source[key], before[key])) value[key] = after[key];
  return value;
}
// Words and numbers are indivisible: 20→25 and 20→30 must not silently become 35.
const tokenise = (s: string) => s.match(/\[\[[^|\[\]\n]+\||\]\]|[+-]?\p{N}+(?:[.,:/~-]\p{N}+)*[\p{L}\p{M}]*|[\p{L}\p{M}\p{N}]+|[^]/gu) ?? [];
interface Edit { start: number; end: number; text: string; side: "local" | "remote" }

// A bounded LCS keeps work proportional to the changed passage, rather than the whole card.
// Large, completely rewritten passages fall back to one explicit choice, never a guessed merge.
function edits(base: string[], next: string[], side: Edit["side"]): Edit[] {
  let prefix = 0, end = base.length, stop = next.length;
  while (prefix < end && prefix < stop && base[prefix] === next[prefix]) prefix++;
  while (end > prefix && stop > prefix && base[end - 1] === next[stop - 1]) { end--; stop--; }
  const a = base.slice(prefix, end), b = next.slice(prefix, stop);
  if (!a.length && !b.length) return [];
  if (a.length * b.length > 2_000_000) return [{ start: prefix, end, text: b.join(""), side }];
  const width = b.length + 1, dp = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    dp[i * width + j] = a[i] === b[j] ? dp[(i + 1) * width + j + 1] + 1 : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
  const result: Edit[] = [];
  let i = 0, j = 0, active: Edit | undefined;
  const finish = () => { if (active) result.push(active); active = undefined; };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { finish(); i++; j++; }
    else {
      active ??= { start: prefix + i, end: prefix + i, text: "", side };
      if (j < b.length && (i === a.length || dp[i * width + j + 1] > dp[(i + 1) * width + j])) active.text += b[j++];
      else { i++; active.end = prefix + i; }
    }
  }
  finish(); return result;
}
const touches = (a: Edit, b: Edit) => a.start === a.end && b.start === b.end ? a.start === b.start
  : a.start === a.end ? a.start > b.start && a.start < b.end
  : b.start === b.end ? b.start > a.start && b.start < a.end : a.start < b.end && b.start < a.end;
const identical = (a: Edit, b: Edit) => a.start === b.start && a.end === b.end && a.text === b.text;
function apply(tokens: string[], from: number, to: number, changes: Edit[], marked: Set<Edit>): Passage {
  let text = "", at = from; const ranges: [number, number][] = [];
  for (const e of [...changes].sort((a, b) => a.start - b.start || a.end - b.end)) {
    text += tokens.slice(at, e.start).join("");
    const start = text.length; text += e.text;
    if (marked.has(e)) ranges.push([start, text.length]);
    at = e.end;
  }
  text += tokens.slice(at, to).join(""); return { text, ranges };
}
// Both source and composed markup must have balanced tokens. This also protects links/scene markers.
export function validMarkup(s: string): boolean {
  let depth = 0;
  for (const t of tokenise(s)) { if (t.startsWith("[[")) { if (depth) return false; depth++; } else if (t === "]]" && --depth < 0) return false; }
  return depth === 0;
}
function chosen(c: ValueConflict, choices: Record<string, Resolution>): ValueMerge {
  const choice = choices[c.id];
  if (choice === "local" || choice === "remote") return { value: c[choice], conflicts: [] };
  if (choice && typeof choice === "object" && c.passage) {
    if (!validMarkup(choice.text)) throw new Error("글자 색·강조 표시가 완성되지 않았습니다. 표시를 확인해 주세요.");
    return { value: choice.text, conflicts: [] };
  }
  return { value: c.remote, conflicts: [c] };
}
function atomic(base: Json, local: Json, remote: Json, location: string[], choices: Record<string, Resolution>): ValueMerge {
  return chosen({ id: JSON.stringify(location), location, before: base, local, remote }, choices);
}
export function mergeText(base: string, local: string, remote: string, location: string[] = [], choices: Record<string, Resolution> = {}): ValueMerge {
  if (local === remote || base === remote) return { value: local, conflicts: [] };
  if (base === local) return { value: remote, conflicts: [] };
  const tokens = tokenise(base), ours = edits(tokens, tokenise(local), "local"), theirs = edits(tokens, tokenise(remote), "remote");
  const all = [...ours, ...theirs.filter(e => !ours.some(a => identical(a, e)))];
  const clashes = new Set<Edit>();
  for (const a of ours) for (const b of theirs) if (!identical(a, b) && touches(a, b)) { clashes.add(a); clashes.add(b); }
  // Resolve each affected sentence/paragraph as a unit, including all independent changes in it.
  // Sentence boundaries inside markup would split tags; expand to the matching markup boundary.
  const spans: { start: number; end: number }[] = [];
  const boundary = (i: number) => /^[.!?。！？\n]$/u.test(tokens[i] ?? "") && (i + 1 === tokens.length || /\s/u.test(tokens[i + 1]));
  for (const e of clashes) {
    let start = e.start, end = e.end;
    while (start > 0 && !boundary(start - 1)) start--;
    while (end < tokens.length && !boundary(end - 1)) end++;
    while (start > 0 && !validMarkup(tokens.slice(start, end).join(""))) start--;
    while (end < tokens.length && !validMarkup(tokens.slice(start, end).join(""))) end++;
    const previous = spans.find(s => start < s.end && end > s.start);
    if (previous) { previous.start = Math.min(start, previous.start); previous.end = Math.max(end, previous.end); }
    else spans.push({ start, end });
  }
  // A safe edit may straddle a sentence boundary. Include it in the same context so applying
  // a sentence choice cannot overlap that edit a second time or drop part of its replacement.
  for (const s of spans) {
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const e of all) if (e.start < s.end && e.end > s.start && (e.start < s.start || e.end > s.end)) {
        s.start = Math.min(s.start, e.start); s.end = Math.max(s.end, e.end); expanded = true;
      }
      while (s.start > 0 && !boundary(s.start - 1)) { s.start--; expanded = true; }
      while (s.end < tokens.length && !boundary(s.end - 1)) { s.end++; expanded = true; }
    }
  }
  spans.sort((a, b) => a.start - b.start);
  // Transitive overlaps can arise when a single replacement spans several sentences.
  for (let i = 1; i < spans.length;) {
    if (spans[i].start < spans[i - 1].end) { spans[i - 1].end = Math.max(spans[i - 1].end, spans[i].end); spans.splice(i, 1); }
    else i++;
  }
  const conflicts: ValueConflict[] = [], replacements: Edit[] = [];
  const covered = (e: Edit, s: { start: number; end: number }) => e.start >= s.start && e.end <= s.end && (e.start < s.end || s.end === tokens.length);
  for (const s of spans) {
    const inside = all.filter(e => covered(e, s));
    const safe = inside.filter(e => !clashes.has(e));
    const localEdits = [...safe, ...inside.filter(e => clashes.has(e) && e.side === "local")];
    const remoteEdits = [...safe, ...inside.filter(e => clashes.has(e) && e.side === "remote")];
    const beforeText = tokens.slice(s.start, s.end).join("");
    const range: [number, number][] = inside.filter(e => clashes.has(e)).map(e => [tokens.slice(s.start, e.start).join("").length, tokens.slice(s.start, e.end).join("").length]);
    const passage = { before: { text: beforeText, ranges: range }, local: apply(tokens, s.start, s.end, localEdits, clashes), remote: apply(tokens, s.start, s.end, remoteEdits, clashes) };
    const c: ValueConflict = { id: `${JSON.stringify(location)}@${s.start}:${s.end}`, location, before: beforeText, local: passage.local.text, remote: passage.remote.text, passage };
    const resolution = chosen(c, choices); conflicts.push(...resolution.conflicts);
    let replacement = resolution.value as string;
    if (typeof choices[c.id] === "object") {
      // The editor asks for a sentence, not its surrounding separator/indentation.
      // Retain that context when a manually written sentence omits it.
      const leading = beforeText.match(/^\s*/u)?.[0] ?? "";
      const trailing = beforeText.slice(leading.length).match(/\s*$/u)?.[0] ?? "";
      if (leading && !/^\s/u.test(replacement)) replacement = leading + replacement;
      if (trailing && !/\s$/u.test(replacement)) replacement += trailing;
    }
    replacements.push({ start: s.start, end: s.end, text: replacement, side: "local" });
  }
  const output = apply(tokens, 0, tokens.length, [...all.filter(e => !spans.some(s => covered(e, s))), ...replacements], new Set()).text;
  if (![base, local, remote, output].every(validMarkup)) {
    const full = (text: string): Passage => ({ text, ranges: [[0, text.length]] });
    return chosen({ id: `${JSON.stringify(location)}@markup`, location, before: base, local, remote, passage: { before: full(base), local: full(local), remote: full(remote) } }, choices);
  }
  return { value: output, conflicts };
}

const compatible = (a: Json, b: Json) => obj(a) && obj(b) ? (a.type ? a.type === b.type : true) : typeof a === typeof b && !Array.isArray(a) && !Array.isArray(b);
// Monotonic alignment: exact items anchor nearby edited items. Ambiguous insert/delete alignment
// or moving an unchanged item is deliberately left as a structural conflict.
function align(base: Json[], side: Json[]): { indices: (number | null)[]; added: number[][] } | null {
  if (base.length === side.length) {
    if (base.some((v, i) => !eq(v, side[i]) && side.some((x, j) => j !== i && eq(v, x)))) return null;
    return { indices: base.map((_, i) => i), added: Array.from({ length: base.length + 1 }, () => []) };
  }
  if (base.length * side.length > 100_000) return null;
  const cost = Array.from({ length: base.length + 1 }, () => Array(side.length + 1).fill(0));
  const ways = cost.map(r => r.map(() => 1));
  for (let i = base.length; i >= 0; i--) for (let j = side.length; j >= 0; j--) {
    if (i === base.length) { cost[i][j] = (side.length - j) * 3; continue; }
    if (j === side.length) { cost[i][j] = (base.length - i) * 3; continue; }
    const options = [cost[i + 1][j] + 3, cost[i][j + 1] + 3, (eq(base[i], side[j]) ? 0 : compatible(base[i], side[j]) ? 2 : 100_000) + cost[i + 1][j + 1]];
    cost[i][j] = Math.min(...options);
    ways[i][j] = Math.min(2, options.reduce((n, c, k) => n + (c === cost[i][j] ? k === 0 ? ways[i + 1][j] : k === 1 ? ways[i][j + 1] : ways[i + 1][j + 1] : 0), 0));
  }
  if (ways[0][0] > 1) return null;
  const indices: (number | null)[] = [], added: number[][] = Array.from({ length: base.length + 1 }, () => []);
  let i = 0, j = 0;
  while (i < base.length || j < side.length) {
    if (i === base.length || (j < side.length && cost[i][j] === cost[i][j + 1] + 3)) { added[i].push(j++); }
    else if (j === side.length || cost[i][j] === cost[i + 1][j] + 3) { indices.push(null); i++; }
    else { indices.push(j); i++; j++; }
  }
  return { indices, added };
}
function mergeArray(base: Json[], local: Json[], remote: Json[], location: string[], choices: Record<string, Resolution>): ValueMerge {
  const a = align(base, local), b = align(base, remote);
  if (!a || !b) return atomic(base, local, remote, location, choices);
  const value: Json[] = [], conflicts: ValueConflict[] = [];
  for (let i = 0; i <= base.length; i++) {
    for (const ri of b.added[i]) value.push(remote[ri]);
    for (const li of a.added[i]) if (!b.added[i].some(ri => eq(remote[ri], local[li]))) value.push(local[li]);
    if (i === base.length) break;
    const l = a.indices[i], r = b.indices[i];
    if (l === null && r === null) continue;
    if ((l === null && eq(base[i], remote[r!])) || (r === null && eq(base[i], local[l!]))) continue;
    const result = mergeValue(base[i], l === null ? null : local[l], r === null ? null : remote[r], [...location, String(i)], choices);
    conflicts.push(...result.conflicts); if (result.value !== null) value.push(result.value);
  }
  return { value, conflicts };
}
function isTable(value: Json): value is Record<string, Json> & { cells: string[][]; widths: number[] } {
  return obj(value) && Array.isArray(value.cells) && Array.isArray(value.widths) && value.cells.every(r => Array.isArray(r) && r.length === (value.widths as Json[]).length && r.every(c => typeof c === "string"));
}
type Table = Record<string, Json> & { cells: string[][]; widths: number[] };
function mergeTable(base: Table, local: Table, remote: Table, location: string[], choices: Record<string, Resolution>): ValueMerge {
  const cols = [align(base.cells[0] ?? [], local.cells[0] ?? []), align(base.cells[0] ?? [], remote.cells[0] ?? [])];
  const rows = [align(base.cells.map((r: string[]) => r[0]), local.cells.map((r: string[]) => r[0])), align(base.cells.map((r: string[]) => r[0]), remote.cells.map((r: string[]) => r[0]))];
  // Shape deletions combined with concurrent edits need an explicit structural choice.
  if ([...cols, ...rows].some(a => !a || a.indices.includes(null))) return atomic(base, local, remote, location, choices);
  const ids = (alignment: NonNullable<ReturnType<typeof align>>, side: "l" | "r") => {
    const result: string[] = [];
    for (let i = 0; i < alignment.added.length; i++) { for (const at of alignment.added[i]) result.push(`${side}${at}`); if (i < alignment.indices.length) result.push(`b${i}`); }
    return result;
  };
  const union = (as: string[], bs: string[]) => { const result = [...bs]; for (let i = 0; i < as.length; i++) if (!result.includes(as[i])) { const next = as.slice(i + 1).find(id => result.includes(id)); result.splice(next ? result.indexOf(next) : result.length, 0, as[i]); } return result; };
  const cs = union(ids(cols[0]!, "l"), ids(cols[1]!, "r")), rs = union(ids(rows[0]!, "l"), ids(rows[1]!, "r"));
  // Simultaneously adding the same heading/row would create ambiguous duplicate columns. Ask first.
  if (cs.filter(id => id[0] !== "b").some(id => cs.some(other => other[0] !== id[0] && other[0] !== "b" && (id[0] === "l" ? local : remote).cells[0]?.[+id.slice(1)] === (other[0] === "l" ? local : remote).cells[0]?.[+other.slice(1)]))
    || rs.filter(id => id[0] !== "b").some(id => rs.some(other => other[0] !== id[0] && other[0] !== "b" && (id[0] === "l" ? local : remote).cells[+id.slice(1)]?.[0] === (other[0] === "l" ? local : remote).cells[+other.slice(1)]?.[0]))) return atomic(base, local, remote, location, choices);
  const index = (id: string, alignment: NonNullable<ReturnType<typeof align>>, side: string) => id[0] === "b" ? alignment.indices[+id.slice(1)] : id[0] === side ? +id.slice(1) : null;
  const value: Record<string, Json> = {}, conflicts: ValueConflict[] = [];
  for (const k of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) if (k !== "widths" && k !== "cells") {
    const result = mergeValue(base[k] ?? null, local[k] ?? null, remote[k] ?? null, [...location, k], choices); value[k] = result.value; conflicts.push(...result.conflicts);
  }
  value.widths = cs.map(c => {
    const l = index(c, cols[0]!, "l"), r = index(c, cols[1]!, "r");
    if (c[0] !== "b") return (c[0] === "l" ? local.widths[l!] : remote.widths[r!]) as number;
    const result = mergeValue(base.widths[+c.slice(1)], local.widths[l!], remote.widths[r!], [...location, "widths", c.slice(1)], choices); conflicts.push(...result.conflicts); return result.value;
  });
  value.cells = rs.map(row => cs.map(col => {
    const lr = index(row, rows[0]!, "l"), rr = index(row, rows[1]!, "r"), lc = index(col, cols[0]!, "l"), rc = index(col, cols[1]!, "r");
    if (row[0] !== "b" || col[0] !== "b") return (lr !== null && lc !== null ? local.cells[lr][lc] : rr !== null && rc !== null ? remote.cells[rr][rc] : "") as string;
    const result = mergeValue(base.cells[+row.slice(1)][+col.slice(1)], local.cells[lr!][lc!], remote.cells[rr!][rc!], [...location, "cells", row.slice(1), col.slice(1)], choices);
    conflicts.push(...result.conflicts); return result.value;
  }));
  return { value, conflicts };
}
export function mergeValue(base: Json, local: Json, remote: Json, location: string[] = [], choices: Record<string, Resolution> = {}): ValueMerge {
  if (eq(local, remote) || eq(base, remote)) return { value: local, conflicts: [] };
  if (eq(base, local)) return { value: remote, conflicts: [] };
  if (typeof base === "string" && typeof local === "string" && typeof remote === "string" && (prose.has(location.at(-1) ?? "") || location.includes("cells"))) return mergeText(base, local, remote, location, choices);
  if (isTable(base) && isTable(local) && isTable(remote)) return mergeTable(base, local, remote, location, choices);
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) return mergeArray(base, local, remote, location, choices);
  if (obj(base) && obj(local) && obj(remote)) {
    // A change of block kind/identity is structural, not prose.
    if ((base.type && (base.type !== local.type || base.type !== remote.type)) || (base.id && (base.id !== local.id || base.id !== remote.id))) return atomic(base, local, remote, location, choices);
    const value: Record<string, Json> = {}, conflicts: ValueConflict[] = [];
    const mirrors = [blockMirrors(base), blockMirrors(local), blockMirrors(remote)];
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      if (mirrors.every((m, i) => m && key in m && eq([base, local, remote][i][key] ?? null, m[key]))) { value[key] = remote[key]; continue; }
      const result = mergeValue(base[key] ?? null, local[key] ?? null, remote[key] ?? null, [...location, key], choices);
      if (result.value !== null || key in local || key in remote) value[key] = result.value;
      conflicts.push(...result.conflicts);
    }
    return { value: syncBlockMirrors(value, remote), conflicts };
  }
  return atomic(base, local, remote, location, choices);
}
