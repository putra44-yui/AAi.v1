import type { CriticOutput } from './critic-pipeline';

// ── Types ────────────────────────────────────────────────────────────────────

export type AudienceTone = 'formal' | 'casual' | 'empathetic' | 'direct';
export type AudienceComplexity = 'simple' | 'medium' | 'technical';
export type AudienceFormatPreference = 'paragraph' | 'bullet' | 'concise';

export type AudienceProfile = {
  tone: AudienceTone;
  complexity: AudienceComplexity;
  format_preference: AudienceFormatPreference;
};

export type DeliveryPayload = {
  adapted_content: string;
  metadata: {
    tone: string;
    complexity: string;
    trace_id: string;
  };
};

// ── Tone Adapters ─────────────────────────────────────────────────────────────

function applyTone(content: string, tone: AudienceTone): string {
  switch (tone) {
    case 'formal':
      return content
        .replace(/\bkamu\b/gi, 'Anda')
        .replace(/\belo\b/gi, 'Anda')
        .replace(/\bgue\b/gi, 'saya');

    case 'casual':
      return content
        .replace(/\bAnda\b/g, 'kamu')
        .replace(/\bsaya\b/g, 'aku');

    case 'empathetic':
      return `Dengan memahami konteks ini — ${content}`;

    case 'direct':
    default:
      return content;
  }
}

// ── Complexity Adapters ───────────────────────────────────────────────────────

function applyComplexity(synthesized: string, complexity: AudienceComplexity): string {
  switch (complexity) {
    case 'simple':
      // Strip parenthetical qualifiers and technical markers
      return synthesized
        .replace(/\[.*?\]/g, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    case 'technical':
      // Keep synthesized as-is, prepend analytical prefix
      return `[ANALYTIC] ${synthesized}`;

    case 'medium':
    default:
      return synthesized;
  }
}

// ── Format Adapters ────────────────────────────────────────────────────────────

function applyFormat(
  deconstructed: string[],
  synthesized: string,
  format: AudienceFormatPreference
): string {
  switch (format) {
    case 'bullet':
      if (deconstructed.length > 1) {
        const bullets = deconstructed.map((d) => `• ${d}`).join('\n');
        return `${bullets}\n\nRingkasan: ${synthesized}`;
      }
      return `• ${synthesized}`;

    case 'concise':
      // Return only the first sentence of synthesized
      return synthesized.split(/(?<=[.!?])\s/)[0] ?? synthesized;

    case 'paragraph':
    default:
      return synthesized;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function routeAudienceDelivery(
  payload: CriticOutput,
  profile: AudienceProfile
): DeliveryPayload {
  const traceId = crypto.randomUUID();

  // Apply complexity first (affects synthesized text)
  const complexityAdapted = applyComplexity(payload.synthesized, profile.complexity);

  // Apply format (may use deconstructed)
  const formatAdapted = applyFormat(
    payload.deconstructed,
    complexityAdapted,
    profile.format_preference
  );

  // Apply tone last (surface-level language adaptation)
  const adapted_content = applyTone(formatAdapted, profile.tone);

  return {
    adapted_content,
    metadata: {
      tone: profile.tone,
      complexity: profile.complexity,
      trace_id: traceId,
    },
  };
}
