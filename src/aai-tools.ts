/** Narrow, validated model-initiated tool protocol for AAi. */
export interface NativeToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export const SEARCH_WEB_TOOL = {
  type: 'function',
  function: {
    name: 'search_web',
    description: 'Cari informasi publik terbaru atau verifikasi klaim yang dapat berubah. Gunakan hanya bila sumber eksternal benar-benar membantu jawaban. Jangan kirim nama pribadi, memori, kredensial, atau isi dokumen rahasia. Jawab langsung tanpa tool bila pengetahuan dan konteks sudah cukup.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query pencarian publik yang ringkas dan bebas data pribadi (3–240 karakter).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
} as const;

export function addNativeToolDeltas(target: Map<number, NativeToolCall>, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  for (const delta of raw) {
    if (!delta || typeof delta !== 'object') continue;
    const item = delta as Record<string, unknown>;
    const index = item.index;
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 3) continue;
    const key = index as number;
    const previous = target.get(key) || { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
    if (typeof item.id === 'string' && item.id) previous.id = item.id.slice(0, 160);
    const fn = item.function;
    if (fn && typeof fn === 'object') {
      const fields = fn as Record<string, unknown>;
      if (typeof fields.name === 'string' && fields.name) {
        if (!previous.function.name || !previous.function.name.endsWith(fields.name)) {
          previous.function.name = (previous.function.name + fields.name).slice(0, 80);
        }
      }
      if (typeof fields.arguments === 'string') {
        previous.function.arguments = (previous.function.arguments + fields.arguments).slice(0, 1200);
      }
    }
    target.set(key, previous);
  }
}

export function completedNativeToolCalls(target: Map<number, NativeToolCall>): NativeToolCall[] {
  return [...target.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
    .filter(call => !!call.id && !!call.function.name);
}

export function extractSearchWebQuery(call: NativeToolCall): string | null {
  if (call.type !== 'function' || call.function.name !== 'search_web') return null;
  try {
    const parsed: unknown = JSON.parse(call.function.arguments);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const args = parsed as Record<string, unknown>;
    if (Object.keys(args).some(key => key !== 'query')) return null;
    const query = typeof args.query === 'string' ? args.query.replace(/\s+/g, ' ').trim() : '';
    return query.length >= 3 && query.length <= 240 ? query : null;
  } catch { return null; }
}
