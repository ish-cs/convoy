import { describe, it, expect } from 'vitest';
import { parseContract } from '../src/lib/ingest-contract';

describe('parseContract — v1', () => {
  it('accepts a full v1 contract from a non-Claude tool', () => {
    const r = parseContract({
      v: 1, repo: 'acme/web', branch: 'feat/x', files: ['src/a.ts'],
      session_id: 's1', source_tool: 'cursor',
      event: { kind: 'edit', message: 'edited a.ts' },
      memory: { text: 'auth.ts must use http-only cookies', file_paths: ['src/auth.ts'] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sourceTool).toBe('cursor');
    expect(r.value.event).toEqual({ kind: 'edit', message: 'edited a.ts' });
    expect(r.value.memory?.text).toBe('auth.ts must use http-only cookies');
  });

  it('accepts event-only and memory-only contracts', () => {
    expect(parseContract({ v: 1, session_id: 's', source_tool: 'codex', event: { kind: 'idle' } }).ok).toBe(true);
    expect(parseContract({ v: 1, session_id: 's', source_tool: 'codex', memory: { text: 'x' } }).ok).toBe(true);
  });

  it('rejects a contract carrying neither event nor memory', () => {
    const r = parseContract({ v: 1, session_id: 's', source_tool: 'codex' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/event.*memory|memory.*event/);
  });

  it('rejects an unknown contract version loudly', () => {
    const r = parseContract({ v: 2, session_id: 's', source_tool: 'cursor', event: { kind: 'edit' } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/unsupported contract version: 2/);
  });

  it('rejects an unregistered source_tool', () => {
    const r = parseContract({ v: 1, session_id: 's', source_tool: 'evilbot', event: { kind: 'edit' } });
    expect(r.ok).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(parseContract(null).ok).toBe(false);
    expect(parseContract('nope').ok).toBe(false);
  });
});

describe('parseContract — legacy back-compat', () => {
  it('maps the shipped claude-code CLI shape to a v1 edit event', () => {
    const r = parseContract({ session_id: 's1', kind: 'edit', branch: 'main', files: ['a.ts'], message: 'edited a.ts' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sourceTool).toBe('claude-code');
    expect(r.value.event).toEqual({ kind: 'edit', message: 'edited a.ts' });
    expect(r.value.memory).toBeNull();
  });

  it('maps a legacy idle ping', () => {
    const r = parseContract({ session_id: 's1', kind: 'idle' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.event).toEqual({ kind: 'idle', message: undefined });
  });

  it('rejects a legacy body with a bad kind', () => {
    expect(parseContract({ session_id: 's1', kind: 'frobnicate' }).ok).toBe(false);
  });
});
