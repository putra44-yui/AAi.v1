import legacyHandler from '../../../api_backup/chat.js';
import { createLegacyRouteHandlers } from '../_lib/legacy-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const handlers = createLegacyRouteHandlers(legacyHandler);

export const GET = handlers.GET;
export const POST = handlers.POST;

export const PUT = handlers.PUT;
