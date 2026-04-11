const DEFAULT_MAIN_MODEL = 'qwen/qwen3.6-plus';
const DEFAULT_FALLBACK_MODEL = 'openai/gpt-oss-20b:free';
const RETRYABLE_OPENROUTER_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const DEFAULT_MAX_RETRIES = 0;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 90000;
const DEFAULT_BACKOFF_BASE_MS = 500;
const DEFAULT_AUTO_TITLE_ENABLED = false;

const MODEL_LABEL_OVERRIDES = {
  'qwen/qwen3.6-plus': 'qwen3.6 Plus',
  'openai/gpt-oss-20b:free': 'GPT OSS 20B'
};

function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function readModelEnv(name) {
  return String(process.env[name] || '').trim();
}

function parseModelOrderEnv(name) {
  const raw = readModelEnv(name);
  if (!raw) return [];

  return uniqueList(
    raw
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  );
}

function resolveConfiguredMainModel() {
  return readModelEnv('OPENROUTER_MAIN_MODEL') || DEFAULT_MAIN_MODEL;
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

function parseBooleanEnv(name, fallbackValue = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallbackValue;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallbackValue;
}

function isHardRateLimit(status, errorBody = '') {
  if (status !== 429) return false;
  const normalized = String(errorBody || '').toLowerCase();
  return (
    normalized.includes('insufficient credits') ||
    normalized.includes('quota') ||
    normalized.includes('daily limit') ||
    normalized.includes('monthly limit') ||
    normalized.includes('exceeded your current quota') ||
    normalized.includes('rate limit exceeded') ||
    normalized.includes('free-tier') ||
    normalized.includes('billing')
  );
}

function normalizeRateLimitErrorBody(errorBody = '', retryAfterHeader = '') {
  const body = String(errorBody || '').trim();
  const retryAfter = String(retryAfterHeader || '').trim();
  if (!retryAfter) return body || 'Rate limit OpenRouter tercapai.';
  const retryInfo = `Retry-After=${retryAfter}s`;
  return body ? `${body} (${retryInfo})` : `Rate limit OpenRouter tercapai (${retryInfo}).`;
}

function titleCaseToken(token = '') {
  if (!token) return '';
  if (/^[a-z]{2,4}$/i.test(token)) return token.toUpperCase();
  if (/^[0-9]+[a-z]+$/i.test(token)) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1);
}

export function formatModelLabel(modelName = '') {
  const normalized = String(modelName || '').trim();
  if (!normalized) return '';

  if (MODEL_LABEL_OVERRIDES[normalized]) {
    return MODEL_LABEL_OVERRIDES[normalized];
  }

  const shortName = normalized.split('/').pop()?.replace(/:.*$/, '') || normalized;
  return shortName
    .split(/[-_]+/)
    .filter(Boolean)
    .map(titleCaseToken)
    .join(' ');
}

export function getModelConfig(personaList) {
  const persona = personaList[0];
  const configs = {
    Coding: { temperature: 0.0, max_tokens: 35000, top_p: 0.85 },
    'Kritikus Brutal': { temperature: 0.3, max_tokens: 5000, top_p: 0.85 },
    Santai: { temperature: 0.8, max_tokens: 3000, top_p: 0.95 },
    Rosalia: { temperature: 0.95, max_tokens: 3000, top_p: 0.95 },
    Auto: { temperature: 0.7, max_tokens: 5000, top_p: 0.9 }
  };
  return configs[persona] || configs.Auto;
}

export function buildModelCandidates() {
  return [resolveConfiguredMainModel()].filter(Boolean);
}

async function attemptOpenRouterRequest({ apiKey, payload, modelName, attemptTimeoutMs, fallbackUsed }) {
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

    if (aiResponse.ok) {
      return {
        ok: true,
        response: aiResponse,
        modelUsed: modelName,
        fallbackUsed,
        retryable: false,
        hardRateLimited: false
      };
    }

    const errorBody = await aiResponse.text();
    const retryAfterHeader = aiResponse.headers.get('retry-after');
    const normalizedErrorBody = normalizeRateLimitErrorBody(errorBody, retryAfterHeader);
    const hardRateLimited = isHardRateLimit(aiResponse.status, normalizedErrorBody);

    return {
      ok: false,
      status: aiResponse.status,
      statusText: aiResponse.statusText,
      errorBody: normalizedErrorBody,
      modelUsed: modelName,
      fallbackUsed,
      retryable: RETRYABLE_OPENROUTER_STATUS.has(aiResponse.status),
      hardRateLimited
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      status: isAbort ? 504 : 503,
      statusText: isAbort ? 'Gateway Timeout' : 'Service Unavailable',
      errorBody: isAbort
        ? `Provider timeout setelah ${attemptTimeoutMs}ms.`
        : (error instanceof Error ? error.message : 'Gagal menghubungi provider.'),
      modelUsed: modelName,
      fallbackUsed,
      retryable: true,
      hardRateLimited: false
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function callOpenRouterWithRetry({ apiKey, payload }) {
  const maxRetries = Math.max(0, parsePositiveIntEnv('OPENROUTER_MAX_RETRIES', DEFAULT_MAX_RETRIES));
  const attemptTimeoutMs = parsePositiveIntEnv('OPENROUTER_ATTEMPT_TIMEOUT_MS', DEFAULT_ATTEMPT_TIMEOUT_MS);
  const backoffBaseMs = parsePositiveIntEnv('OPENROUTER_BACKOFF_BASE_MS', DEFAULT_BACKOFF_BASE_MS);
  const modelName = resolveConfiguredMainModel();
  let totalRetryCount = 0;
  let lastFailure = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await attemptOpenRouterRequest({
      apiKey,
      payload,
      modelName,
      attemptTimeoutMs,
      fallbackUsed: false
    });

    if (result.ok) {
      return {
        ok: true,
        response: result.response,
        modelUsed: modelName,
        retryCount: totalRetryCount,
        fallbackUsed: false
      };
    }

    lastFailure = {
      status: result.status,
      statusText: result.statusText,
      errorBody: result.errorBody,
      modelUsed: modelName,
      retryCount: totalRetryCount,
      fallbackUsed: false
    };

    const shouldRetryCurrentModel = attempt < maxRetries && result.retryable && !result.hardRateLimited;
    if (!shouldRetryCurrentModel) break;

    totalRetryCount += 1;
    const jitter = Math.floor(Math.random() * 180);
    const waitMs = backoffBaseMs * (2 ** attempt) + jitter;
    await sleep(waitMs);
  }

  return {
    ok: false,
    status: lastFailure?.status || 503,
    statusText: lastFailure?.statusText || 'Service Unavailable',
    errorBody: lastFailure?.errorBody || 'Gagal terhubung ke provider setelah retry.',
    modelUsed: lastFailure?.modelUsed || resolveConfiguredMainModel(),
    retryCount: totalRetryCount,
    fallbackUsed: false
  };
}

const MAIN_MODEL = resolveConfiguredMainModel();

export { MAIN_MODEL };
export { DEFAULT_MAIN_MODEL, DEFAULT_FALLBACK_MODEL };
export const AUTO_TITLE_ENABLED = parseBooleanEnv('AAI_ENABLE_AUTO_TITLE', DEFAULT_AUTO_TITLE_ENABLED);
