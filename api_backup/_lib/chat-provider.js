const MAIN_MODEL = 'qwen/qwen3.6-plus:free';
const DEFAULT_FALLBACK_MODEL = 'qwen/qwen2.5-coder:free';
const RETRYABLE_OPENROUTER_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean))];
}

export function parsePositiveIntEnv(name, fallbackValue) {
  const raw = Number.parseInt(process.env[name] || '', 10);
  if (Number.isNaN(raw) || raw <= 0) return fallbackValue;
  return raw;
}

export function parseFloatEnv(name, fallbackValue, min = 0, max = 1) {
  const raw = Number.parseFloat(process.env[name] || '');
  if (Number.isNaN(raw)) return fallbackValue;
  return Math.max(min, Math.min(max, raw));
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getModelConfig(personaList) {
  const persona = personaList[0];
  const configs = {
    Coding: { temperature: 0.0, max_tokens: 52000, top_p: 0.85 },
    'Kritikus Brutal': { temperature: 0.3, max_tokens: 3000, top_p: 0.85 },
    Santai: { temperature: 0.8, max_tokens: 1500, top_p: 0.95 },
    Rosalia: { temperature: 0.95, max_tokens: 1000, top_p: 0.95 },
    Auto: { temperature: 0.7, max_tokens: 3000, top_p: 0.9 }
  };
  return configs[persona] || configs.Auto;
}

export function buildModelCandidates() {
  const fallbackFromEnv = String(process.env.OPENROUTER_FALLBACK_MODEL || '').trim();
  const fallbacks = uniqueList([
    fallbackFromEnv || DEFAULT_FALLBACK_MODEL
  ]).filter(model => model && model !== MAIN_MODEL);
  return [MAIN_MODEL, ...fallbacks];
}

export async function callOpenRouterWithRetry({ apiKey, payload }) {
  const maxRetries = Math.max(0, parsePositiveIntEnv('OPENROUTER_MAX_RETRIES', 2));
  const attemptTimeoutMs = parsePositiveIntEnv('OPENROUTER_ATTEMPT_TIMEOUT_MS', 45000);
  const backoffBaseMs = parsePositiveIntEnv('OPENROUTER_BACKOFF_BASE_MS', 800);
  const models = buildModelCandidates();
  let totalRetryCount = 0;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const modelName = models[modelIndex];
    const fallbackUsed = modelIndex > 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), attemptTimeoutMs);

      try {
        const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://aai.family',
            'X-Title': 'AAi Keluarga'
          },
          body: JSON.stringify({ ...payload, model: modelName }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (aiResponse.ok) {
          return {
            ok: true,
            response: aiResponse,
            modelUsed: modelName,
            retryCount: totalRetryCount,
            fallbackUsed
          };
        }

        const errorBody = await aiResponse.text();
        const isRetryable = RETRYABLE_OPENROUTER_STATUS.has(aiResponse.status);
        if (!isRetryable) {
          return {
            ok: false,
            status: aiResponse.status,
            statusText: aiResponse.statusText,
            errorBody,
            modelUsed: modelName,
            retryCount: totalRetryCount,
            fallbackUsed
          };
        }

        if (attempt >= maxRetries) {
          break;
        }

        totalRetryCount += 1;
        const jitter = Math.floor(Math.random() * 450);
        const waitMs = backoffBaseMs * (2 ** attempt) + jitter;
        await sleep(waitMs);
      } catch {
        clearTimeout(timeoutId);
        if (attempt >= maxRetries) {
          break;
        }

        totalRetryCount += 1;
        const jitter = Math.floor(Math.random() * 450);
        const waitMs = backoffBaseMs * (2 ** attempt) + jitter;
        await sleep(waitMs);
      }
    }
  }

  return {
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    errorBody: 'Gagal terhubung ke provider setelah retry dan fallback.',
    modelUsed: MAIN_MODEL,
    retryCount: totalRetryCount,
    fallbackUsed: true
  };
}

export { MAIN_MODEL };
