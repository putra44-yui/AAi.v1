import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function calculateAge(dob) {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();

  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  return age;
}


export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Cuma terima POST bos!' });
  }

  try {
    const { message, session_id, user_id, persona_name } = req.body;
      // ====================== GET USER + PERSON ======================
const { data: user } = await supabase
  .from('users')
  .select('id, person_id')
  .eq('username', 'teguh')
  .single();

if (!user || !user.person_id) {
  throw new Error("User atau person belum terhubung!");
}

const { data: person } = await supabase
  .from('persons')
  .select('name, date_of_birth, role')
  .eq('id', user.person_id)
  .single();

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


    const age = person.date_of_birth
  ? calculateAge(person.date_of_birth)
  : null;

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

    const systemPrompt = {
  role: "system",
  content: `
You are a brutally logical AI critic.

Current speaker:
- Name: ${person.name}
- Role: ${person.role}
- Age: ${age}

Behavior:
- Challenge assumptions
- Find logical flaws
- Stay brutally honest
`
};

    // ====================== 3. HISTORY ======================
    const { data: history } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', currentSessionId)
      .order('created_at', { ascending: true });

    const lastMessages = (history || []).slice(-10);

    // ====================== 4 open router ======================
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY belum diset!");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'http://localhost:3000',
    'X-Title': 'Aplikasi Chat Kamu'
  },
  body: JSON.stringify({
    model: "meta-llama/llama-4-maverick",
    messages: [
      systemPrompt,
      ...lastMessages,
      { role: "user", content: userMessage }
    ],
    temperature: 0.7,
    max_tokens: 1024
  })
});

    const Data = await response.json();
    if (!response.ok) throw new Error(Data.error?.message || "open router error");

    const aiReply = Data.choices?.[0]?.message?.content || "AI lagi bingung.";

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