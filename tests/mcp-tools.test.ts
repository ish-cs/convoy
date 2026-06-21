import { describe, it, expect } from 'vitest';
import { resolveMember } from '../src/lib/mcp/auth';
describe('resolveMember', () => {
  it('returns null for an unknown token', async () => {
    expect(await resolveMember('definitely-not-real')).toBeNull();
  });
});
