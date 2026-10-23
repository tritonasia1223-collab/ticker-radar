import type { ChapterParagraph } from './credit/chapter-reading.js';
import october21 from './editorials/2026-10-21.json';
import { octoberWeekTwoEditorial, octoberWeekTwoNote } from './october-week-two-editorial.js';

interface EditorialBlock { id: string; paragraphs: string[]; emphasis?: string[]; note?: string }
const editions: Record<string, { blocks: EditorialBlock[] }> = { [october21.asOf]: october21 };
export const hasWeeklyEditorial = (asOf: string) => Object.hasOwn(editions, asOf);
export function weeklyEditorial(id: string, asOf: string, weeks = 4): ChapterParagraph[] {
  if (!hasWeeklyEditorial(asOf)) return octoberWeekTwoEditorial(id, asOf, weeks);
  if (weeks !== 4) return [];
  const block = editions[asOf].blocks.find(b => b.id === id);
  return (block?.paragraphs ?? []).map(text => ({ kind: 'analysis', text, ...(block?.emphasis ? { emphasis: block.emphasis } : {}) }));
}
export function weeklyEditorialNote(id: string, asOf: string): string | undefined {
  return hasWeeklyEditorial(asOf) ? editions[asOf].blocks.find(b => b.id === id)?.note : octoberWeekTwoNote(id, asOf);
}
