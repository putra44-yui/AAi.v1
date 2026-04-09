import { createHash, randomUUID } from 'node:crypto';

export type CriticOutput = {
  deconstructed: string[];
  extracted: Record<string, unknown>;
  projected: string;
  synthesized: string;
};

type CriticError = { error: string };

// Fix: hapus trace dari parameter jika tidak dipakai, atau gunakan untuk logging nyata
function stageDeconstruct(input: string): string[] {
  const normalized = String(input || '').trim();
  if (!normalized) return [];

  const clauses = normalized
    .split(/(?<=[.!?;])\s+|(?:\s*,\s*(?:dan|dan juga|serta|namun|tetapi|karena|sehingga|maka|yang|agar|supaya|while|because|but|and|or|so|then|therefore|however|although)\s+)/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  if (clauses.length <= 1) {
    const tokens = normalized.split(/\s+/);
    const windows: string[] = [];
    for (let i = 0; i < tokens.length; i += 6) {
      windows.push(tokens.slice(i, i + 6).join(' '));
    }
    return windows.filter((w) => w.length > 0);
  }
  return clauses;
}

function stageExtract(deconstructed: string[], input: string): Record<string, unknown> {
  const full = String(input || '').trim();
  const entities: string[] = [];
  const keywords: string[] = [];

  const entityMatches = full.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g);
  for (const match of entityMatches) {
    if (!entities.includes(match[1])) entities.push(match[1]);
  }

  const stopwords = new Set([
    'yang', 'dan', 'dari', 'atau', 'ini', 'itu', 'para', 'dengan', 'pada', 'untuk',
    'adalah', 'dalam', 'akan', 'juga', 'saja', 'bisa', 'oleh',
    'the', 'and', 'for', 'are', 'was', 'but', 'not', 'with', 'this', 'that',
    'have', 'from', 'they', 'been', 'were', 'their',
  ]);
  const tokenMatches = full.matchAll(/\b([a-z]{4,})\b/gi);
  for (const match of tokenMatches) {
    const w = match[1].toLowerCase();
    if (!stopwords.has(w) && !keywords.includes(w)) keywords.push(w);
  }

  const contentHash = createHash('sha256').update(full).digest('hex').slice(0, 12);

  // Fix: jangan mutate object bertipe. Buat baru dengan spread.
  return {
    entities,
    keywords: keywords.slice(0, 20),
    clause_count: deconstructed.length,
    char_count: full.length,
    content_hash: contentHash,
    pipeline_trace_id: randomUUID(),
  };
}

function stageProject(deconstructed: string[], extracted: Record<string, unknown>): string {
  if (deconstructed.length === 0) return '';

  const clauseCount = Number(extracted.clause_count ?? deconstructed.length);
  const keywords = (extracted.keywords as string[]) ?? [];
  const entities = (extracted.entities as string[]) ?? [];

  const domainHints = keywords.slice(0, 3).join(', ') || '(general)';
  const entityHints = entities.slice(0, 2).join(', ');

  if (clauseCount === 1) {
    return `Single-claim input focused on: ${domainHints}${entityHints ? ` — involving ${entityHints}` : ''}.`;
  }

  return `Multi-clause input (${clauseCount} segments) spanning topics: ${domainHints}${entityHints ? `. Key entities mentioned: ${entityHints}.` : '.'}`;
}

function stageSynthesize(deconstructed: string[], extracted: Record<string, unknown>, projected: string, input: string): string {
  const charCount = Number(extracted.char_count ?? 0);
  const clauseCount = Number(extracted.clause_count ?? 0);
  const keywords = (extracted.keywords as string[]) ?? [];

  const complexity = charCount > 500 || clauseCount > 5 ? 'complex' : charCount > 100 || clauseCount > 2 ? 'moderate' : 'simple';
  const topKeywords = keywords.slice(0, 5).join(', ') || 'general';

  return `[${complexity.toUpperCase()}] ${projected} Core signal: "${deconstructed[0] || input.slice(0, 60)}". Top signals: ${topKeywords}.`;
}

export async function runCriticPipeline(input: string): Promise<CriticOutput | CriticError> {
  try {
    const deconstructed = stageDeconstruct(input);
    const extracted = stageExtract(deconstructed, input);
    const projected = stageProject(deconstructed, extracted);
    const synthesized = stageSynthesize(deconstructed, extracted, projected, input);

    return { deconstructed, extracted, projected, synthesized };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `critic-pipeline failed: ${message}` };
  }
}
