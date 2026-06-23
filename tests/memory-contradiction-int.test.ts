import { describe, it, expect } from 'vitest';
import { embed } from '../src/lib/embed';
import { cosine, findContradictions, CONTRA_SIM_MIN, CONTRA_SIM_MAX } from '../src/lib/memory-contradiction';

// Calibration against LIVE Gemini vectors: the 0.82..0.97 contradiction band is only useful if
// real conflicting statements actually land inside it and unrelated ones fall below. This guards
// against the thresholds drifting out of step with the embedding model.
describe('contradiction band vs live embeddings', () => {
  it('flags a real same-topic/opposite-policy conflict, ignores an unrelated memory', async () => {
    const incoming = {
      id: 'in', content_hash: 'h-in',
      text: 'store auth session tokens in http-only cookies so client JavaScript cannot read them',
      embedding: await embed('store auth session tokens in http-only cookies so client JavaScript cannot read them'),
    };
    const conflict = {
      id: 'conflict', content_hash: 'h-c',
      text: 'store auth session tokens in localStorage so the frontend can read them directly',
      embedding: await embed('store auth session tokens in localStorage so the frontend can read them directly'),
    };
    const unrelated = {
      id: 'unrelated', content_hash: 'h-u',
      text: 'the build pipeline runs vitest then playwright on every push to main',
      embedding: await embed('the build pipeline runs vitest then playwright on every push to main'),
    };

    const simConflict = cosine(incoming.embedding, conflict.embedding);
    const simUnrelated = cosine(incoming.embedding, unrelated.embedding);
    // Surface the actual sims so a calibration drift is debuggable from the test output.
    expect(simConflict, `conflict sim ${simConflict} must be in [${CONTRA_SIM_MIN}, ${CONTRA_SIM_MAX})`)
      .toBeGreaterThanOrEqual(CONTRA_SIM_MIN);
    expect(simConflict).toBeLessThan(CONTRA_SIM_MAX);
    expect(simUnrelated, `unrelated sim ${simUnrelated} must be < ${CONTRA_SIM_MIN}`).toBeLessThan(CONTRA_SIM_MIN);

    expect(findContradictions(incoming, [conflict, unrelated])).toEqual(['conflict']);
  }, 30_000);
});
