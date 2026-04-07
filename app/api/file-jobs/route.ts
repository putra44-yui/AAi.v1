import legacyHandler from '../../../api_backup/file-jobs.js';
import { createLegacyRouteHandlers } from '../_lib/legacy-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const handlers = createLegacyRouteHandlers(legacyHandler);

export const GET = handlers.GET;
export const POST = handlers.POST;
export async function PUT(...args: Parameters<typeof handlers.PUT>): Promise<Response> {
	return handlers.PUT(...args);
}
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
export const OPTIONS = handlers.OPTIONS;
export const HEAD = handlers.HEAD;