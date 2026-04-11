export async function streamOpenRouterResponse(message: string) {
  // Ambil key dari environment, throw error kalau kosong
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY tidak ditemukan di .env.local');

  // Request ke OpenRouter dengan flag stream: true
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'AAi Family AI',
    },
    body: JSON.stringify({
      model: 'qwen/qwen-2.5-72b-instruct',
      messages: [{ role: 'user', content: message }],
      stream: true, // Wajib untuk streaming
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  // Validasi respons sebelum pipe
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`OpenRouter error (${res.status}): ${errText}`);
  }

  // Kembalikan ReadableStream mentah (SSE format)
  return res.body;
}
