import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const incomingTraceId = request.headers.get('x-trace-id');
  const traceId = incomingTraceId && incomingTraceId.trim()
    ? incomingTraceId.trim()
    : crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set('x-trace-id', traceId);

  console.log(`[AAi-Audit] Trace ID ${incomingTraceId ? 'dipakai ulang' : 'dibuat'}: ${traceId} | Tujuan: ${request.nextUrl.pathname}`);

  return NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
}

export const config = {
  matcher: ['/api/:path*']
};