import { randomUUID } from 'node:crypto';
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

// ── Adapters ─────────────────────────────────────────────────────────────────
function applyTone(content: string, tone: AudienceTone): string {
  switch (tone) {
    case 'formal':
      return content.replace(/\bkamu\b/gi, 'Anda').replace(/\belo\b/gi, 'Anda').replace(/\bgue\b/gi, 'saya');
    case 'casual':
      return content.replace(/\bAnda\b/g, 'kamu').replace(/\bsaya\b/g, 'aku');
    case 'empathetic':
      return `Dengan memahami konteks ini — ${content}`;
    default:
      return content;
  }
}

function applyComplexity(synthesized: string, complexity: AudienceComplexity): string {
  switch (complexity) {
    case 'simple':
      return synthesized.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/\s{2,}/g, ' ').trim();
    case 'technical':
      return `[ANALYTIC] ${synthesized}`;
    default:
      return synthesized;
  }
}

function applyFormat(deconstructed: string[], synthesized: string, format: AudienceFormatPreference): string {
  switch (format) {
    case 'bullet':
      return deconstructed.length > 1
        ? `${deconstructed.map((d) => `• ${d}`).join('\n')}\n\nRingkasan: ${synthesized}`
        : `• ${synthesized}`;
    case 'concise':
      return synthesized.split(/(?<=[.!?])\s/)[0] ?? synthesized;
    default:
      return synthesized;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export function routeAudienceDelivery(
  payload: CriticOutput,
  profile: AudienceProfile
): DeliveryPayload {
  // Fix: gunakan import randomUUID, bukan global crypto yang tidak konsisten di edge/node
  const traceId = randomUUID();

  const complexityAdapted = applyComplexity(payload.synthesized, profile.complexity);
  const formatAdapted = applyFormat(payload.deconstructed, complexityAdapted, profile.format_preference);
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
