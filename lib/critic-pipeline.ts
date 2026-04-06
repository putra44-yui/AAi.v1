import { createHash } from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────────

export type CriticOutput = {
  deconstructed: string[];
  extracted: Record<string, unknown>;
  projected: string;
  synthesized: string;
};

type CriticError = {
  error: string;
};

type StageTrace = {
  stage: string;
  trace_id: string;
};

// ── Stage Implementations ────────────────────────────────────────────────────

function stageDeconstruct(input: string, trace: StageTrace): string[] {
  void trace;
  const normalized = String(input || '').trim();
  if (!normalized) return [];

  // Split into clauses: by sentence terminators, semicolons, and conjunctions
  const clauses = normalized
    .split(/(?<=[.!?;])\s+|(?:\s*,\s*(?:dan|dan juga|serta|namun|tetapi|karena|sehingga|maka|yang|agar|supaya|while|because|but|and|or|so|then|therefore|however|although)\s+)/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  if (clauses.length <= 1) {
    // Fallback: split by whitespace into token windows of ~6 words
    const tokens = normalized.split(/\s+/);
    const windows: string[] = [];
    for (let i = 0; i < tokens.length; i += 6) {
      windows.push(tokens.slice(i, i + 6).join(' '));
    }
    return windows.filter((w) => w.length > 0);
  }

  return clauses;
}

function stageExtract(
  deconstructed: string[],
  input: string,
  trace: StageTrace
): Record<string, unknown> {
  void trace;
  const full = String(input || '').trim();

  const entities: string[] = [];
  const keywords: string[] = [];

  // Simple entity detection: capitalized word sequences (≥2 chars)
  const entityMatches = full.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g);
  for (const match of entityMatches) {
    if (!entities.includes(match[1])) entities.push(match[1]);
  }

  // Keywords: non-stopword tokens ≥4 chars (Indonesian+English light stopwords)
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

  // Content hash: stable fingerprint of the input
  const contentHash = createHash('sha256').update(full).digest('hex').slice(0, 12);

  return {
    entities,
    keywords: keywords.slice(0, 20),
    clause_count: deconstructed.length,
    char_count: full.length,
    content_hash: contentHash,
  };
}

function stageProject(
  deconstructed: string[],
  extracted: Record<string, unknown>,
  trace: StageTrace
): string {
  void trace;
  if (deconstructed.length === 0) return '';

  const clauseCount = Number(extracted.clause_count ?? deconstructed.length);
  const keywords = (extracted.keywords as string[]) ?? [];
  const entities = (extracted.entities as string[]) ?? [];

  const domainHints = keywords.slice(0, 3).join(', ') || '(general)';
  const entityHints = entities.slice(0, 2).join(', ');

  if (clauseCount === 1) {
    return `Single-claim input focused on: ${domainHints}${entityHints ? ` — involving ${entityHints}` : ''}.`;
  }

  return (
    `Multi-clause input (${clauseCount} segments) spanning topics: ${domainHints}` +
    (entityHints ? `. Key entities mentioned: ${entityHints}.` : '.')
  );
}

function stageSynthesize(
  deconstructed: string[],
  extracted: Record<string, unknown>,
  projected: string,
  input: string,
  trace: StageTrace
): string {
  void trace;
  const charCount = Number(extracted.char_count ?? 0);
  const clauseCount = Number(extracted.clause_count ?? 0);
  const keywords = (extracted.keywords as string[]) ?? [];

  const complexity =
    charCount > 500 || clauseCount > 5
      ? 'complex'
      : charCount > 100 || clauseCount > 2
        ? 'moderate'
        : 'simple';

  const topKeywords = keywords.slice(0, 5).join(', ') || 'general';

  return (
    `[${complexity.toUpperCase()}] ${projected} ` +
    `Core signal: "${deconstructed[0] || input.slice(0, 60)}". ` +
    `Top signals: ${topKeywords}.`
  );
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function runCriticPipeline(
  input: string
): Promise<CriticOutput | CriticError> {
  try {
    const pipelineTraceId = crypto.randomUUID();

    // Stage 1: Deconstruct
    const deconstructTrace: StageTrace = { stage: 'deconstruct', trace_id: crypto.randomUUID() };
    const deconstructed = stageDeconstruct(input, deconstructTrace);

    // Stage 2: Extract
    const extractTrace: StageTrace = { stage: 'extract', trace_id: crypto.randomUUID() };
    const extracted = stageExtract(deconstructed, input, extractTrace);
    extracted['pipeline_trace_id'] = pipelineTraceId;

    // Stage 3: Project
    const projectTrace: StageTrace = { stage: 'project', trace_id: crypto.randomUUID() };
    const projected = stageProject(deconstructed, extracted, projectTrace);

    // Stage 4: Synthesize
    const synthesizeTrace: StageTrace = { stage: 'synthesize', trace_id: crypto.randomUUID() };
    const synthesized = stageSynthesize(
      deconstructed,
      extracted,
      projected,
      input,
      synthesizeTrace
    );

    return { deconstructed, extracted, projected, synthesized };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `critic-pipeline failed: ${message}` };
  }
}
