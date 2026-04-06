import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const traceId = crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set('x-trace-id', traceId);

  console.log(`[AAi-Audit] Trace ID dibuat: ${traceId} | Tujuan: ${request.nextUrl.pathname}`);

  return NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
}

export const config = {
  matcher: ['/api/:path*']
};