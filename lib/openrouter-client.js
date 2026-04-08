import 'server-only';

function assertServerOnly() {
  if (typeof window !== 'undefined') {
    throw new Error('openrouter-client can only run on the server');
  }
}

function readEnv(name, fallback = '') {
  assertServerOnly();
  return String(process.env[name] ?? fallback).trim();
}

function readRequiredEnv(name) {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseModelOrder(value) {
  return [...new Set(
    String(value || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  )];
}

export function getOpenRouterApiKey() {
  return readRequiredEnv('OPENROUTER_API_KEY');
}

export function getOpenRouterConfig() {
  const modelOrder = parseModelOrder(readEnv('OPENROUTER_MODEL_ORDER'));
  const mainModel = readEnv('OPENROUTER_MAIN_MODEL');
  const fallbackModel = readEnv('OPENROUTER_FALLBACK_MODEL');
  return {
    apiKey: getOpenRouterApiKey(),
    modelOrder,
    mainModel,
    fallbackModel,
    maxRetries: parsePositiveInt(readEnv('OPENROUTER_MAX_RETRIES', '2'), 2),
    attemptTimeoutMs: parsePositiveInt(readEnv('OPENROUTER_ATTEMPT_TIMEOUT_MS', '45000'), 45000),
    backoffBaseMs: parsePositiveInt(readEnv('OPENROUTER_BACKOFF_BASE_MS', '800'), 800)
  };
}
