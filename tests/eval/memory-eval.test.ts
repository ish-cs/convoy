import { describe, it, expect } from 'vitest';
import { runEval } from './memory-eval';

// CI gate: recall must surface the right memory in the top 3 for at least 90% of questions.
// Runs against live Gemini embeddings; skips cleanly if no key is configured (same posture as
// the other cloud-integration tests).
const RUN = !!process.env.GEMINI_API_KEY;

describe.skipIf(!RUN)('recall eval harness', () => {
  it('top-3 hit rate is >= 90%', async () => {
    const r = await runEval();
    // Always surface the score so a regression is legible in CI output, pass or fail.
    console.log(`recall top-3 hit rate: ${(r.hitRate * 100).toFixed(1)}% (${r.hits}/${r.total})`);
    if (r.misses.length) console.log('misses:', JSON.stringify(r.misses, null, 2));
    expect(r.hitRate).toBeGreaterThanOrEqual(0.9);
  }, 60_000);
});
