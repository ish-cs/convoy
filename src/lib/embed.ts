// Embedding seam — ONE function, swappable provider.
//
// Default provider: Gemini `gemini-embedding-001` requested at 384 dims so the output
// matches the `memory.embedding vector(384)` column exactly (verify-before-trust). Storage
// stays 100% in our Postgres; this only computes the vector. It's a plain fetch, so it runs
// fine in serverless (backfill route today, recall-time query embedding in T9).
//
// Embeddings are computed ASYNC (backfill) and NEVER on the write path — see Global
// Constraints. Nothing in the write path imports this module.

export const EMBED_DIM = 384;
const MODEL = 'gemini-embedding-001';
// Gemini free tier throttles bursts with 429/503; retry transiently so recall and the eval
// gate don't flake on a momentary spike.
const RETRY_STATUS = new Set([429, 503]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type Embedder = (text: string) => Promise<number[]>;

// Test seam: inject a stub embedder (pass null to restore the default provider).
let _override: Embedder | null = null;
export function __setEmbedder(fn: Embedder | null): void {
  _override = fn;
}

async function geminiEmbed(text: string): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('embed: GEMINI_API_KEY missing');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent?key=${key}`;
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: `models/${MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: EMBED_DIM,
    }),
  };
  let res!: Response;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, init);
    if (res.ok || !RETRY_STATUS.has(res.status) || attempt === 2) break;
    await sleep(500 * (attempt + 1));
  }
  if (!res.ok) throw new Error(`embed: http ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const v = j?.embedding?.values;
  if (!Array.isArray(v)) throw new Error('embed: no embedding.values in response');
  return v as number[];
}

// Gemini does not normalize sub-3072-dim outputs; unit-normalize so cosine distance is clean.
function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum);
  return n > 0 ? v.map((x) => x / n) : v;
}

export async function embed(text: string): Promise<number[]> {
  const t = (text ?? '').trim();
  if (!t) throw new Error('embed: empty text');
  const fn = _override ?? geminiEmbed;
  const v = await fn(t);
  if (v.length !== EMBED_DIM) throw new Error(`embed: dim ${v.length} != ${EMBED_DIM}`);
  return l2normalize(v);
}
