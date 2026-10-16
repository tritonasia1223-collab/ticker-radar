import 'dotenv/config';
import { collectCredit } from '../server/credit/sources.js';
import { readCreditSnapshot, saveCreditSnapshot } from '../server/credit/storage.js';
import { analyze } from '../shared/credit/signals.js';
import { readingIndicators } from '../shared/credit/schema.js';
import { cpDashboard } from '../shared/credit/cp-dashboard.js';

// Default is a read-only rehearsal. --save adds these three series to the latest
// stored snapshot; it retains all existing series and the normal collection job.
const keys = ['RIFSPPNA2P2D30NB', 'DCPN30', 'DTB4WK'];
async function main() {
  const previous = await readCreditSnapshot();
  if (!previous) throw new Error('Existing snapshot required');
  const next = await collectCredit(previous, new Date(), false, keys);
  for (const key of keys) {
    const series = next.series.find(s => s.key === key);
    if (!series || series.error || series.points.length < 500) throw new Error('CP source validation failed: ' + key);
  }
  for (const old of previous.series.filter(s => !keys.includes(s.key))) {
    if (JSON.stringify(next.series.find(s => s.key === old.key)) !== JSON.stringify(old)) throw new Error('Unrelated source changed');
  }
  const current = cpDashboard(analyze(next, '2026-10-14', 'observation', readingIndicators), '2026-10-14').current;
  if (!current || current.date !== '2026-10-14' || Math.abs(current.creditSpread! - .21) > .00001) throw new Error('CP reference-date validation failed');
  const save = process.argv.includes('--save');
  if (save) await saveCreditSnapshot(next);
  console.log(JSON.stringify({saved: save, previousCollectedAt: previous.collectedAt, sources: next.series.length, added: keys.map(key => ({key, count: next.series.find(s => s.key === key)!.points.length})), reference: current}));
}
main().then(() => process.exit(0)).catch(() => { console.error('CP migration failed; inspect configuration and source availability.'); process.exit(1); });
