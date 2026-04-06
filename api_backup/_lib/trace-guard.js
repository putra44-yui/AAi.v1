import { randomUUID } from 'crypto';

/**
 * Generates a unique trace ID for request tracing.
 * @returns {string} UUID v4 trace ID
 */
export function generateTraceId() {
  return randomUUID();
}

/**
 * Injects trace ID into request object and returns it.
 * @param {Object} req - Node request object
 * @param {string|null} traceId - Existing trace ID or null to read from headers
 * @returns {string} The trace ID
 */
export function injectTraceId(req, traceId = null) {
  const id = traceId || req.headers['x-trace-id'] || generateTraceId();
  req.x_trace_id = id;
  return id;
}

/**
 * Logs an audit trail entry to Supabase. Fire-and-forget (async without await).
 * On error, logs to stderr only (never throws to avoid blocking response).
 *
 * @param {Object} supabase - Supabase client
 * @param {string} traceId - Trace ID for this request
 * @param {string} route - API route (e.g., '/api/chat')
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {number} statusCode - HTTP response status code
 * @param {Object} payloadSummary - Brief summary object {user_id, message_count, ...}
 */
export async function logAuditTrail(supabase, traceId, route, method, statusCode, payloadSummary = {}) {
  try {
    const { error } = await supabase
      .from('audit_trail')
      .insert({
        trace_id: traceId,
        route,
        method,
        status_code: statusCode,
        payload_summary: JSON.stringify(payloadSummary)
      });

    if (error) {
      console.error(`[AUDIT_TRAIL_ERROR] trace_id=${traceId} route=${route}: ${error.message}`);
    }
  } catch (err) {
    console.error(`[AUDIT_TRAIL_ERROR] trace_id=${traceId} route=${route}: ${err.message}`);
  }
}
