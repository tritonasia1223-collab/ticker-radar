import type { SavedInsight } from '../../../shared/cap-comparison';
import { splitInsightScenes } from '../../../shared/comparison-scenes';

// This card compares two regions at the same time, rather than successive events.
export function parallelCivilWarScene(note: SavedInsight) {
  if (note.id !== 'a92f10fc-22c4-4a33-aeb1-5d4f99d7e5c7' || !note.balance) return undefined;
  const parts = splitInsightScenes(note.text);
  if (parts[0].text.trim() || parts[1]?.after !== '557b0060-05ef-4131-82ca-16326ea8551b') return undefined;
  return note.scenes?.find(scene => scene.id === parts[1].after);
}
