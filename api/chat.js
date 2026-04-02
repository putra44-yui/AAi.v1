export const maxDuration = 60;
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAIN_MODEL = "qwen/qwen3.6-plus-preview:free";

function calculateAge(dob) {
  if (!dob) return '?';
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function getModelConfig(personaList) {
  const persona = personaList[0];
  const configs = {
    'Coding':          { temperature: 0.2, max_tokens: 32000, top_p: 0.85 },
    'Kritikus Brutal': { temperature: 0.3, max_tokens: 9000,  top_p: 0.85 },
    'Santai':          { temperature: 0.8, max_tokens: 4000,  top_p: 0.95 },
    'Rosalia':         { temperature: 0.95, max_tokens: 5000, top_p: 0.98 },
    'Auto':            { temperature: 0.7, max_tokens: 6000,  top_p: 0.9  }
  };
  return configs[persona] || configs['Auto'];
}

export default async function handler(req, res) {

  // ── GET: Load riwayat ──
  if (req.method === 'GET') {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id wajib' });
    try {
      const { data: messages, error } = await supabase
        .from('messages')
        .select('id, role, content, parent_id, created_at')
        .eq('session_id', session_id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ success: true, messages: messages || [], session_id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Cuma terima GET & POST!' });
  }

  // ── POST: Kirim pesan + streaming ──
  try {
    const {
      message, session_id, user_id, username,
      persona_name = 'Auto', parent_id = null, user_message_id = null
    } = req.body;

    const userMessage = message?.trim();
    if (!userMessage) throw new Error("Pesan tidak boleh kosong");

    // 1. User & Person
    let userQuery = supabase.from('users').select('id, person_id');
    if (user_id) userQuery = userQuery.eq('id', user_id);
    else if (username) userQuery = userQuery.eq('username', username);
    else throw new Error("user_id atau username wajib");

    const { data: user, error: userErr } = await userQuery.single();
    if (userErr || !user?.person_id) throw new Error("User atau person belum terhubung!");

    const { data: person } = await supabase
      .from('persons').select('name, date_of_birth, role')
      .eq('id', user.person_id).single();

    const currentAge = calculateAge(person?.date_of_birth);

    // 2. Family context
    const { data: allPersons } = await supabase.from('persons').select('name, date_of_birth, role');
    const familyContext = (allPersons || []).map(p => {
      const age = calculateAge(p.date_of_birth);
      const dob = p.date_of_birth ? new Date(p.date_of_birth).toISOString().split('T')[0] : 'tidak diketahui';
      return `- ${p.name} (${p.role}, ${age} tahun, lahir ${dob})`;
    }).join('\n');

    const { data: relations } = await supabase
      .from('relationships')
      .select('person_a(name,role), person_b(name,role), relation_type');
    const relationContext = (relations || [])
      .map(r => `- ${r.person_a.name} (${r.person_a.role}) ${r.relation_type} ${r.person_b.name} (${r.person_b.role})`)
      .join('\n') || 'Belum ada relasi.';

    const { data: memories } = await supabase
      .from('person_memory').select('key, value').eq('person_id', user.person_id);
    const memoryText = memories?.map(m => `${m.key}: ${m.value}`).join('\n') || 'Tidak ada memori.';

    // 3. Chat history — semua, tanpa limit
    const apiKey = process.env.OPENROUTER_API_KEY;
    const chatHistory = session_id
      ? ((await supabase.from('messages').select('role, content')
          .eq('session_id', session_id).order('created_at', { ascending: true })).data || [])
      : [];

    // 4. Persona
    let targetPersona = persona_name;
    const msgLower = userMessage.toLowerCase();
    if (targetPersona === 'Auto') {
      if (/kritik|brutal|roasting|sedih|curhat|nangis|galau|kecewa|capek|stres/i.test(msgLower))
        targetPersona = 'Kritikus Brutal';
      else if (/kode|bug|function|html|css|javascript|js|python|sql|error|fix|api|backend|frontend|react|next|node|database|query|deploy|git|loop|array|object|fetch|async|await|import|export|class|component|hook|state|props|syntax|compile|excel|rumus|build|install|npm|yarn|vercel|server|endpoint|route|request|response|json/i.test(msgLower))
        targetPersona = 'Coding';
      else if (/sayang|cinta|mawar|istri/i.test(msgLower))
        targetPersona = 'Rosalia';
      else
        targetPersona = 'Santai';
    }
    let personaList = [targetPersona];
    if (/sayang|cinta/i.test(msgLower) && targetPersona !== 'Rosalia')
      personaList = ['Santai', 'Rosalia'];

    const { data: personasData } = await supabase
      .from('ai_personas').select('name, system_prompt').in('name', personaList);
    const combinedSystem = personasData?.map(p => `=== GAYA: ${p.name} ===\n${p.system_prompt}`).join('\n\n') || '';

    // 5. System prompt
    const systemPrompt = {
      role: "system",
      content: `Kamu adalah AAi, AI keluarga yang cerdas dan ramah.

Current speaker: ${person?.name} (${person?.role}, ${currentAge} tahun)

Keluarga:\n${familyContext}

Relasi:\n${relationContext}

Memori permanen:\n${memoryText}

Persona aktif: ${personaList.join(' + ')}
${combinedSystem}

ATURAN PENTING:
- Gunakan bahasa Indonesia sehari-hari + emoji, respons panjang dan detail.
- Bantu pekerjaan konsep sulit, excel, coding, dll.
- Jawab langsung dan lengkap. DILARANG memotong jawaban di tengah.`
    };

    // ── SETUP DB SEBELUM STREAMING ──

    // Buat sesi jika belum ada
    let currentSessionId = session_id;
    if (!currentSessionId) {
      // Judul cepat dari 40 karakter pertama, update async setelah streaming
      const quickTitle = userMessage.substring(0, 40);
      const { data: newSession, error: sesErr } = await supabase
        .from('sessions').insert({ user_id: user.id, title: quickTitle }).select().single();
      if (sesErr) throw new Error("Gagal buat sesi: " + sesErr.message);
      currentSessionId = newSession.id;

      // Generate judul AI secara async (tidak tunggu)
      generateTitle(apiKey, userMessage, currentSessionId);
    }

    // Tentukan parent_id
    let effectiveParentId = parent_id;
    if (!effectiveParentId && !user_message_id) {
      const { data: lastMsg } = await supabase.from('messages').select('id')
        .eq('session_id', currentSessionId).order('created_at', { ascending: false })
        .limit(1).maybeSingle();
      effectiveParentId = lastMsg?.id || null;
    }

    // Simpan pesan user
    let finalUserMessageId = user_message_id;
    if (!finalUserMessageId) {
      const { data: userMsgData, error: userMsgErr } = await supabase.from('messages').insert({
        session_id: currentSessionId, role: 'user',
        content: userMessage, parent_id: effectiveParentId
      }).select().single();
      if (userMsgErr) throw new Error("Gagal simpan pesan user: " + userMsgErr.message);
      finalUserMessageId = userMsgData.id;
    }

    // ── MULAI STREAMING ──
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // penting buat Nginx/Vercel

    const modelConfig = getModelConfig(personaList);
    console.log(`🎛️ ${personaList[0]} | temp:${modelConfig.temperature} | tokens:${modelConfig.max_tokens}`);

    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://aai.family',
        'X-Title': 'AAi Keluarga'
      },
      body: JSON.stringify({
        model: MAIN_MODEL,
        messages: [systemPrompt, ...chatHistory, { role: "user", content: userMessage }],
        stream: true,
        temperature: modelConfig.temperature,
        max_tokens: modelConfig.max_tokens,
        top_p: modelConfig.top_p
      })
    });

    if (!aiResponse.ok) {
      const errData = await aiResponse.json();
      res.write(`data: ${JSON.stringify({ error: errData.error?.message || 'API Error' })}\n\n`);
      return res.end();
    }

    // Baca stream dari OpenRouter
    const reader = aiResponse.body.getReader();
    const decoder = new TextDecoder();
    let fullReply = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // simpan baris tidak lengkap

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const parsed = JSON.parse(raw);
          const token = parsed.choices?.[0]?.delta?.content || '';
          if (token) {
            fullReply += token;
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
        } catch {}
      }
    }

    // Simpan balasan AI ke DB
    const { data: aiMsgData, error: aiMsgErr } = await supabase.from('messages').insert({
      session_id: currentSessionId,
      role: 'assistant',
      content: fullReply,
      parent_id: finalUserMessageId
    }).select().single();
    if (aiMsgErr) console.error("Gagal simpan AI:", aiMsgErr.message);

    // Update timestamp sesi
    await supabase.from('sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', currentSessionId);

    // Kirim event selesai
    res.write(`data: ${JSON.stringify({
      done: true,
      session_id: currentSessionId,
      message_id: aiMsgData?.id,
      user_message_id: finalUserMessageId
    })}\n\n`);
    res.end();
    console.log(`✅ Streaming selesai, session: ${currentSessionId}`);

  } catch (error) {
    console.error("=== ERROR ===", error.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
}

// Generate judul AI async (tidak blokir streaming)
async function generateTitle(apiKey, userMessage, sessionId) {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MAIN_MODEL,
        messages: [{ role: "user", content: `Buatkan judul singkat (maks 4 kata) tanpa tanda kutip, tanpa titik, untuk pesan: "${userMessage}"` }],
        temperature: 0.3, max_tokens: 20
      })
    });
    const d = await r.json();
    const title = d.choices?.[0]?.message?.content?.replace(/["'.]/g, '').trim();
    if (title) {
      const supabase2 = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      await supabase2.from('sessions').update({ title }).eq('id', sessionId);
    }
  } catch {}
}