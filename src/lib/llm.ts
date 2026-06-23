// The single swappable LLM seam for auto-extraction. Mirrors embed.ts: one real provider
// (Gemini), a test override, strict validation of whatever comes back. Nothing on the write
// path imports this — extraction is an opt-in, offline-ish proposer, never inline with a write.
// flash-lite is ample for this background proposer and far less prone to the 503 "high demand"
// throttling that the headline flash model hits. We retry transient 503/429s a couple of times.
const MODEL = 'gemini-2.5-flash-lite';
const RETRY_STATUS = new Set([429, 503]);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export type SessionEvent = { message: string; files: string[] };
export type ExtractedMemory = { text: string; file_paths: string[]; confidence: number };
export type Extractor = (events: SessionEvent[]) => Promise<ExtractedMemory[]>;

export const MAX_DRAFTS = 5;

let _override: Extractor | null = null;
export function __setExtractor(fn: Extractor | null): void { _override = fn; }

const PROMPT = [
  'You read a software team member\'s coding-session events (commit messages, edits and the files',
  'they touched) and extract DURABLE team-memory facts worth keeping: decisions, conventions,',
  'gotchas, architectural choices. Ignore routine/transient work ("fixed typo", "wip", "ran tests").',
  'Each fact must stand on its own out of context. Attach the most relevant file paths.',
  `Return STRICT JSON: an array (max ${MAX_DRAFTS}) of {"text": string, "file_paths": string[],`,
  '"confidence": number between 0 and 1}. If nothing is durable, return []. No prose, JSON only.',
].join(' ');

async function geminiExtract(events: SessionEvent[]): Promise<ExtractedMemory[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('llm: GEMINI_API_KEY missing');
  const transcript = events.map(e => `- ${e.message}${e.files.length ? `  [${e.files.join(', ')}]` : ''}`).join('\n');
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: transcript }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  let res!: Response;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (res.ok || !RETRY_STATUS.has(res.status) || attempt === 2) break;
    await sleep(500 * (attempt + 1));
  }
  if (!res.ok) throw new Error(`llm: http ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const raw = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof raw !== 'string') throw new Error('llm: no text in response');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('llm: response was not a JSON array');
  return parsed as ExtractedMemory[];
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

// Extract durable memories from a session's events. Validates/sanitizes whatever the provider
// returns (verify-before-trust): drops malformed/empty drafts, clamps confidence, caps count.
export async function extractMemories(events: SessionEvent[]): Promise<ExtractedMemory[]> {
  const clean = (events ?? []).filter(e => e && typeof e.message === 'string' && e.message.trim());
  if (!clean.length) return [];
  const fn = _override ?? geminiExtract;
  const out = await fn(clean);
  if (!Array.isArray(out)) throw new Error('llm: extractor did not return an array');
  return out
    .filter(d => d && typeof d.text === 'string' && d.text.trim())
    .slice(0, MAX_DRAFTS)
    .map(d => ({
      text: d.text.trim(),
      file_paths: Array.isArray(d.file_paths) ? d.file_paths.filter(p => typeof p === 'string') : [],
      confidence: typeof d.confidence === 'number' ? clamp01(d.confidence) : 0.3,
    }));
}
