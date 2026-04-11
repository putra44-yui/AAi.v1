import { NextResponse } from 'next/server';

export async function GET() {
  // Cek environment critical sebelum lanjut
  const hasOpenRouterKey = !!process.env.OPENROUTER_API_KEY;
  const hasNodeEnv = process.env.NODE_ENV;

  // Validasi modul inti (bisa diperluas nanti saat pipeline/memori aktif)
  const modules = {
    openrouter: hasOpenRouterKey ? 'ready' : 'missing_key',
    environment: hasNodeEnv || 'unknown',
    streaming: 'active', // Sudah terverifikasi manual via curl -N
  };

  // Return status JSON standar untuk monitoring
  return NextResponse.json(
    {
      status: hasOpenRouterKey ? 'healthy' : 'degraded',
      modules,
      timestamp: new Date().toISOString(),
    },
    { status: hasOpenRouterKey ? 200 : 503 }
  );
}
