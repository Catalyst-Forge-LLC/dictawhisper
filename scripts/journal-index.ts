/**
 * Rebuild the derived journal SQLite index (FTS5 + optional sqlite-vec).
 *
 *   pnpm journal:index
 *   pnpm journal:index --embed
 *   pnpm journal:index --no-embed
 */
import { config } from '../src/config.ts';
import { rebuildJournalIndex } from '../src/lib/journalService.ts';

const embed = !process.argv.includes('--no-embed');
const roots = [...config.watch.roots, config.watch.browserDropFolder];
const result = await rebuildJournalIndex(roots, { embed });
console.log(
  `[journal-index] done upserted=${result.upserted} removed=${result.removed} embedded=${result.embedded}`,
);
