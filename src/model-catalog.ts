export const DEFAULT_MODEL_ID = 'qwen/qwen3.8-flash';

export const MODEL_CATALOG = [
  {
    id: 'auto',
    label: 'Auto · Qwen 3.8 Flash',
    model_id: DEFAULT_MODEL_ID,
    description: 'Pilihan otomatis bawaan AAi.',
  },
  {
    id: 'qwen/qwen3.8-omni-flash',
    label: 'Qwen 3.8 Omni Flash',
    model_id: 'qwen/qwen3.8-omni-flash',
    description: 'Untuk percakapan yang membutuhkan kemampuan multimodal.',
  },
  {
    id: 'z-ai/glm-5.3-flash',
    label: 'GLM 5.3 Flash',
    model_id: 'z-ai/glm-5.3-flash',
    description: 'Pilihan model alternatif untuk percakapan dan analisis.',
  },
] as const;

export type ModelSelectionId = typeof MODEL_CATALOG[number]['id'] | typeof MODEL_CATALOG[number]['model_id'];

const MODEL_SELECTIONS = new Map<string, string>(
  MODEL_CATALOG.flatMap((model) => [
    [model.id, model.model_id] as const,
    [model.model_id, model.model_id] as const,
  ]),
);

export function parseModelSelection(value: unknown):
  | { ok: true; value: ModelSelectionId | null }
  | { ok: false } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }

  if (typeof value !== 'string') return { ok: false };
  const normalized = value.trim();
  if (!MODEL_SELECTIONS.has(normalized)) return { ok: false };

  return { ok: true, value: normalized as ModelSelectionId };
}

export function resolveModelSelection(value: ModelSelectionId): string {
  return MODEL_SELECTIONS.get(value) || DEFAULT_MODEL_ID;
}

export function getPublicModelCatalog() {
  return {
    default_selection: 'auto',
    default_model_id: DEFAULT_MODEL_ID,
    models: MODEL_CATALOG.map((model) => ({
      id: model.id,
      label: model.label,
      model_id: model.model_id,
      description: model.description,
    })),
  };
}
