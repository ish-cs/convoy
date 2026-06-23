import { describe, it, expect, afterEach } from 'vitest';
import { extractMemories, __setExtractor, MAX_DRAFTS } from '../src/lib/llm';

afterEach(() => __setExtractor(null));

describe('extractMemories', () => {
  it('returns [] for empty / message-less events without calling the provider', async () => {
    let called = false;
    __setExtractor(async () => { called = true; return []; });
    expect(await extractMemories([])).toEqual([]);
    expect(await extractMemories([{ message: '   ', files: [] }])).toEqual([]);
    expect(called).toBe(false);
  });

  it('passes through valid drafts, clamps confidence, defaults missing confidence', async () => {
    __setExtractor(async () => [
      { text: 'auth uses http-only cookies', file_paths: ['src/auth.ts'], confidence: 1.4 },
      { text: 'ci runs vitest then playwright', file_paths: [], confidence: -3 },
      { text: 'no confidence given' } as never,
    ]);
    const out = await extractMemories([{ message: 'did stuff', files: ['src/auth.ts'] }]);
    expect(out).toEqual([
      { text: 'auth uses http-only cookies', file_paths: ['src/auth.ts'], confidence: 1 },
      { text: 'ci runs vitest then playwright', file_paths: [], confidence: 0 },
      { text: 'no confidence given', file_paths: [], confidence: 0.3 },
    ]);
  });

  it('drops malformed drafts (empty/blank text, non-string paths) and caps at MAX_DRAFTS', async () => {
    __setExtractor(async () => [
      { text: '', file_paths: [], confidence: 0.5 },
      { text: '  ', file_paths: [], confidence: 0.5 },
      ...Array.from({ length: MAX_DRAFTS + 3 }, (_, i) => ({ text: `fact ${i}`, file_paths: [1, 'src/x.ts'] as never, confidence: 0.5 })),
    ]);
    const out = await extractMemories([{ message: 'work', files: [] }]);
    expect(out).toHaveLength(MAX_DRAFTS);
    expect(out[0]).toEqual({ text: 'fact 0', file_paths: ['src/x.ts'], confidence: 0.5 });
  });
});
