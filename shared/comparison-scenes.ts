import { z } from "zod";
import { insightBalanceSchema } from "./comparison-balance.js";

export const insightSceneSchema = z.object({
  id: z.string().uuid(), title: z.string().max(100), balance: insightBalanceSchema,
}).strict();
export type InsightScene = z.infer<typeof insightSceneSchema>;
const markerPattern = /\[\[balance:([0-9a-f-]{36})\]\]/g;
export const sceneMarker = (id: string) => `[[balance:${id}]]`;
export function splitInsightScenes(text: string) {
  const parts: { after: string | null; text: string; start: number; end: number }[] = [];
  let start = 0, after: string | null = null;
  for (const match of text.matchAll(markerPattern)) {
    parts.push({ after, text: text.slice(start, match.index), start, end: match.index! });
    after = match[1]; start = match.index! + match[0].length;
  }
  parts.push({ after, text: text.slice(start), start, end: text.length });
  return parts;
}
export const insightProse = (text: string) => text.replace(markerPattern, "");
export function moveScene(text: string, id: string, direction: -1 | 1) {
  const token = sceneMarker(id), at = text.indexOf(token);
  if (at < 0) return text;
  const clean = text.slice(0, at) + text.slice(at + token.length);
  // Skip entire rich spans and other diagrams; never place a marker inside formatting.
  const boundaries = [0];
  for (const m of clean.matchAll(/\[\[[^\]]*\]\]|\n+/g)) {
    if (m[0].startsWith("\n")) boundaries.push(m.index! + m[0].length);
  }
  boundaries.push(clean.length);
  const next = direction < 0 ? boundaries.filter(n => n < at).at(-1) : boundaries.find(n => n > at);
  if (next === undefined) return text;
  return clean.slice(0, next) + token + clean.slice(next);
}
