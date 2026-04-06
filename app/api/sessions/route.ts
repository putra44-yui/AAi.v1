import legacyHandler from '../../../api_backup/sessions.js';
import { createLegacyRouteHandlers } from '../_lib/legacy-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const handlers = createLegacyRouteHandlers(legacyHandler);

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
export const OPTIONS = handlers.OPTIONS;
export const HEAD = handlers.HEAD;