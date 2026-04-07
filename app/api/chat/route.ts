import legacyHandler from '../../../api_backup/chat.js';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createLegacyRouteHandlers } from '../_lib/legacy-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const handlers = createLegacyRouteHandlers(legacyHandler);

type JsonLike = Record<string, unknown> | unknown[] | string | number | boolean | null;

function getTraceId(request: NextRequest): string {
	const incoming = request.headers.get('x-trace-id');
	return incoming && incoming.trim() ? incoming.trim() : randomUUID();
}

function withTraceHeader(response: Response, traceId: string): Response {
	const headers = new Headers(response.headers);
	headers.set('x-trace-id', traceId);

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

async function withTraceJsonBody(response: Response, traceId: string): Promise<Response> {
	const contentType = response.headers.get('content-type') || '';
	const isSse = contentType.includes('text/event-stream');
	if (isSse) {
		return withTraceHeader(response, traceId);
	}

	if (!contentType.includes('application/json')) {
		return withTraceHeader(response, traceId);
	}

	try {
		const payload = await response.clone().json() as JsonLike;
		const objectPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
			? payload as Record<string, unknown>
			: { data: payload };

		if (!objectPayload.trace_id) {
			objectPayload.trace_id = traceId;
		}

		const headers = new Headers(response.headers);
		headers.set('x-trace-id', traceId);

		return new Response(JSON.stringify(objectPayload), {
			status: response.status,
			statusText: response.statusText,
			headers
		});
	} catch {
		return withTraceHeader(response, traceId);
	}
}

function jsonError(status: number, message: string, traceId: string): Response {
	return Response.json(
		{
			success: false,
			error: message,
			trace_id: traceId
		},
		{
			status,
			headers: {
				'x-trace-id': traceId
			}
		}
	);
}

function withTraceRequest(request: NextRequest, traceId: string): NextRequest {
	const headers = new Headers(request.headers);
	headers.set('x-trace-id', traceId);

	const forwarded = new Request(request, { headers });
	return forwarded as unknown as NextRequest;
}

export async function GET(request: NextRequest): Promise<Response> {
	const traceId = getTraceId(request);
	const sessionId = request.nextUrl.searchParams.get('session_id');

	if (!sessionId || !sessionId.trim()) {
		return jsonError(400, 'session_id wajib', traceId);
	}

	try {
		const response = await handlers.GET(withTraceRequest(request, traceId));
		return await withTraceJsonBody(response, traceId);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Internal server error';
		return jsonError(500, message, traceId);
	}
}

export async function POST(request: NextRequest): Promise<Response> {
	const traceId = getTraceId(request);
	const contentType = request.headers.get('content-type') || '';

	if (!contentType.includes('application/json')) {
		return jsonError(415, 'Content-Type harus application/json', traceId);
	}

	let payload: Record<string, unknown>;
	try {
		payload = await request.clone().json();
	} catch {
		return jsonError(400, 'Body JSON tidak valid', traceId);
	}

	const message = String(payload.message ?? '').trim();
	const hasUser = Boolean(String(payload.user_id ?? '').trim() || String(payload.username ?? '').trim());

	if (!message) {
		return jsonError(400, 'Pesan tidak boleh kosong', traceId);
	}

	if (!hasUser) {
		return jsonError(400, 'user_id atau username wajib', traceId);
	}

	try {
		const response = await handlers.POST(withTraceRequest(request, traceId));
		return await withTraceJsonBody(response, traceId);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Internal server error';
		return jsonError(500, message, traceId);
	}
}

export const PUT = handlers.PUT;
