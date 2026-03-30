import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Cuma terima POST bos!' });
  }

  try {
    const { message, session_id, user_id, persona_name } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Pesan kosong bro!' });
    }

    const userMessage = message.trim();

    // ====================== 1. BUAT / AMBIL SESSION ======================
    let currentSessionId = session_id;

    if (currentSessionId) {
      const { data: existing } = await supabase
        .from('sessions')
        .select('id')
        .eq('id', currentSessionId)
        .single();
      if (!existing) currentSessionId = null;
    }

    if (!currentSessionId) {
      if (!user_id) throw new Error("user_id diperlukan");
      const { data: newSession, error: sessionError } = await supabase
        .from('sessions')
        .insert({ user_id, title: userMessage.substring(0, 50) })
        .select()
        .single();

      if (sessionError) throw new Error("Gagal buat session");
      currentSessionId = newSession.id;
    }

    // ====================== 2. AMBIL PROMPT DARI PERSONA ======================
    let targetPersona = persona_name;
    const msgLower = userMessage.toLowerCase();

    // Logika Auto Detect
    if (targetPersona === 'Auto') {
      if (msgLower.includes('kode') || msgLower.includes('bug') || msgLower.includes('function') || msgLower.includes('html')) {
        targetPersona = 'Kritikus Brutal';
      } else if (msgLower.includes('sayang') || msgLower.includes('cinta') || msgLower.includes('mawar') || msgLower.includes('istri')) {
        targetPersona = 'Rosalia';
      } else {
        targetPersona = 'Santai';
      }
    }

    // Default prompt jika semua gagal (Identity Anchor)
    let systemContent = "Nama kamu AAi, buatan Bos. Kamu adalah AI yang jujur dan logis.";

    if (targetPersona) {
      const { data: persona } = await supabase
        .from('ai_personas')
        .select('system_prompt')
        .eq('name', targetPersona) // Sekarang targetPersona sudah ter-mapping benar
        .single();

      if (persona && persona.system_prompt) {
        systemContent = persona.system_prompt;
      }
    }

    const systemPrompt = { role: "system", content: systemContent };

    // ====================== 3. HISTORY ======================
    const { data: history } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', currentSessionId)
      .order('created_at', { ascending: true });

    const lastMessages = (history || []).slice(-10);

    // ====================== 4. GROQ ======================
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY belum diset!");

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [systemPrompt, ...lastMessages, { role: "user", content: userMessage }],
        temperature: 0.7,
        max_tokens: 1024
      })
    });

    const groqData = await groqResponse.json();
    if (!groqResponse.ok) throw new Error(groqData.error?.message || "Groq error");

    const aiReply = groqData.choices?.[0]?.message?.content || "AI lagi bingung.";

    // ====================== 5. SIMPAN ======================
    await supabase.from('messages').insert([
      { session_id: currentSessionId, role: 'user', content: userMessage },
      { session_id: currentSessionId, role: 'assistant', content: aiReply }
    ]);

    res.status(200).json({ 
      reply: aiReply,
      session_id: currentSessionId 
    });

  } catch (error) {
    console.error("=== SERVER ERROR ===", error.message);
    res.status(500).json({ error: error.message });
  }
}