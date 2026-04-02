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
// ── KONFIGURASI DINAMIS PER PERSONA ──
function getModelConfig(personaList) {
  const persona = personaList[0]; // persona utama

  const configs = {
    'Coding': {
      temperature: 0.2,   // presisi tinggi, minim kreatifitas liar
      max_tokens: 12000,  // butuh ruang panjang buat kode detail
      top_p: 0.85
    },
    'Kritikus Brutal': {
      temperature: 0.3,   // tajam dan konsisten, tidak ngawur
      max_tokens: 8000,
      top_p: 0.85
    },
    'Santai': {
      temperature: 0.8,   // lebih santai, variatif, natural
      max_tokens: 4000,
      top_p: 0.95
    },
    'Rosalia': {
      temperature: 0.95,  // ekspresif, hangat, penuh perasaan
      max_tokens: 3000,
      top_p: 0.98
    },
    'Auto': {
      temperature: 0.7,
      max_tokens: 6000,
      top_p: 0.9
    }
  };

  return configs[persona] || configs['Auto'];
}

export default async function handler(req, res) {
  // ─────────────────────────────────────────────────────────────
  // GET: Load riwayat percakapan untuk session tertentu
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id wajib dikirim' });

    try {
      const { data: messages, error } = await supabase
        .from('messages')
        .select('id, role, content, parent_id, created_at')
        .eq('session_id', session_id)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return res.status(200).json({
        success: true,
        messages: messages || [],
        session_id
      });
    } catch (err) {
      console.error("❌ Gagal load history:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // POST: Kirim pesan baru, panggil AI, simpan ke DB
  // ─────────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Cuma terima GET & POST bos!' });
  }

  console.log("=== AAi REQUEST ===");

  try {
    const {
      message,
      session_id,
      user_id,
      username,
      persona_name = 'Auto',
      parent_id = null,
      user_message_id = null
    } = req.body;

    const userMessage = message?.trim();
    if (!userMessage) throw new Error("Pesan tidak boleh kosong");

    // ── 1. USER & PERSON ──
    let userQuery = supabase.from('users').select('id, person_id');
    if (user_id) userQuery = userQuery.eq('id', user_id);
    else if (username) userQuery = userQuery.eq('username', username);
    else throw new Error("user_id atau username wajib dikirim");

    const { data: user, error: userErr } = await userQuery.single();
    if (userErr || !user || !user.person_id) throw new Error("User atau person belum terhubung!");

    const { data: person } = await supabase
      .from('persons')
      .select('name, date_of_birth, role')
      .eq('id', user.person_id)
      .single();

    const currentAge = person?.date_of_birth ? calculateAge(person.date_of_birth) : '?';

    // ── 2. FAMILY CONTEXT ──
    const { data: allPersons } = await supabase.from('persons').select('name, date_of_birth, role');
    const familyContext = (allPersons || []).map(p => {
      const age = p.date_of_birth ? calculateAge(p.date_of_birth) : '?';
      const dobStr = p.date_of_birth ? new Date(p.date_of_birth).toISOString().split('T')[0] : 'tidak diketahui';
      return `- ${p.name} (${p.role}, ${age} tahun, lahir ${dobStr})`;
    }).join('\n');

    const { data: relations } = await supabase
      .from('relationships')
      .select('person_a(name,role), person_b(name,role), relation_type');
    const relationContext = (relations || [])
      .map(r => `- ${r.person_a.name} (${r.person_a.role}) ${r.relation_type} ${r.person_b.name} (${r.person_b.role})`)
      .join('\n') || 'Belum ada relasi.';

    const { data: memories } = await supabase
      .from('person_memory')
      .select('key, value')
      .eq('person_id', user.person_id);
    const memoryText = memories?.map(m => `${m.key}: ${m.value}`).join('\n') || 'Tidak ada memori permanen.';

    // ── 3. CHAT HISTORY (CONTEXT UNTUK AI) ──
    let chatHistory = [];
    const apiKey = process.env.OPENROUTER_API_KEY;

    const currentSessMessages = session_id
      ? (await supabase
          .from('messages')
          .select('role, content, created_at')
          .eq('session_id', session_id)
          .order('created_at', { ascending: true })
          .limit(40)
        ).data || []
      : [];

    // Ambil 20 pesan terakhir buat context AI
    chatHistory = currentSessMessages.slice(-20);
    console.log(`📚 Context AI: ${chatHistory.length} pesan`);

 // ── 4. AUTO PERSONA ──
let targetPersona = persona_name;
const msgLower = userMessage.toLowerCase();

if (targetPersona === 'Auto') {
  // 1. Pemicu Kritikus Brutal (Minta roasting, opini, ATAU lagi curhat/sedih biar dikasih tamparan realita!)
  if (/kritik|brutal|roasting|jelek|bodoh|hina|review|menurutmu|sedih|curhat|nangis|galau|kecewa|capek|lelah|stres|pusing|depresi|hancur/i.test(msgLower)) {
    targetPersona = 'Kritikus Brutal';
  }
  // 2. Pemicu Coding (Pertanyaan teknis murni)
  else if (/kode|bug|function|html|css|javascript|js|python|sql|error|fix|api|backend|frontend|react|next|node|database|query|deploy|git|loop|array|object|fetch|async|await|import|export|class|component|hook|state|props|null|undefined|syntax|compile|excel|rumus|build|install|npm|yarn|vercel|server|endpoint|route|request|response|json/i.test(msgLower)) {
    targetPersona = 'Coding';
  } 
  // 3. Pemicu Keluarga/Bucin
  else if (/sayang|cinta|mawar|istri/i.test(msgLower)) {
    targetPersona = 'Rosalia';
  } 
  // 4. Mode Normal (Default)
  else {
    targetPersona = 'Santai';
  }
}

// Logika blending (Opsional)
let personaList = [targetPersona];
if (/sayang|cinta/i.test(msgLower) && targetPersona !== 'Rosalia') {
  personaList = ['Santai', 'Rosalia'];
}



    const { data: personasData } = await supabase
      .from('ai_personas')
      .select('name, system_prompt')
      .in('name', personaList);
    const combinedSystem = personasData?.map(p => `=== GAYA: ${p.name} ===\n${p.system_prompt}`).join('\n\n') || '';

    // ── 5. SYSTEM PROMPT ──
    const systemPrompt = {
      role: "system",
      content: `Kamu adalah AAi, AI keluarga yang cerdas dan ramah.

Current speaker: ${person?.name} (${person?.role}, ${currentAge} tahun)

Keluarga:
${familyContext}

Relasi:
${relationContext}

Memori permanen:
${memoryText}

Persona aktif: ${personaList.join(' + ')}
${combinedSystem}

ATURAN PENTING:
- Gunakan bahasa Indonesia sehari-hari + emoji, respons panjang dan detail.
- Bantu pekerjaan konsep sulit, excel, coding, dll.
- Jawab langsung dan lengkap. DILARANG memotong jawaban di tengah.`
    };

    // ── 6. PANGGIL AI ──
    const messagesPayload = [
      systemPrompt,
      ...chatHistory,
      { role: "user", content: userMessage }
    ];

    const modelConfig = getModelConfig(personaList);
console.log(`🎛️ Persona: ${personaList[0]} | temp: ${modelConfig.temperature} | tokens: ${modelConfig.max_tokens}`);

const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'http://localhost:3000',
    'X-Title': 'AAi Keluarga'
  },
  body: JSON.stringify({
    model: MAIN_MODEL,
    messages: messagesPayload,
    temperature: modelConfig.temperature,  // ✅ dinamis
    max_tokens: modelConfig.max_tokens,    // ✅ dinamis
    top_p: modelConfig.top_p              // ✅ dinamis
  })
});

    const aiData = await aiResponse.json();
    if (!aiResponse.ok || aiData.error) {
      console.error("❌ OPENROUTER ERROR:", aiData.error);
      throw new Error(aiData.error?.message || "Error dari OpenRouter API");
    }

    const aiReply = aiData.choices?.[0]?.message?.content;
    if (!aiReply) throw new Error("AI mengembalikan respons kosong");

    console.log(`✅ AI reply length: ${aiReply.length} chars`);

    // ── 7. SIMPAN KE DATABASE ──
    let currentSessionId = session_id;

    // Buat sesi baru kalau belum ada
    if (!currentSessionId) {
      let newTitle = userMessage.substring(0, 40);
      try {
        const titleRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MAIN_MODEL,
            messages: [{ role: "user", content: `Buatkan judul singkat (maks 3-4 kata) tanpa tanda kutip, tanpa titik di akhir, untuk pesan: "${userMessage}"` }],
            temperature: 0.3,
            max_tokens: 20
          })
        });
        const titleData = await titleRes.json();
        if (titleData.choices?.[0]?.message?.content) {
          newTitle = titleData.choices[0].message.content.replace(/["'.]/g, '').trim();
        }
      } catch (err) {
        console.warn("⚠️ Gagal buat judul, pakai fallback:", err.message);
      }

      const { data: newSession, error: sesErr } = await supabase
        .from('sessions')
        .insert({ user_id: user.id, title: newTitle })
        .select()
        .single();
      if (sesErr) throw new Error("Gagal buat sesi: " + sesErr.message);
      currentSessionId = newSession.id;
    }

    // Tentukan parent_id yang bener buat rantai percakapan
    let effectiveParentId = parent_id;
    if (!effectiveParentId && !user_message_id) {
      const { data: lastMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('session_id', currentSessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      effectiveParentId = lastMsg?.id || null;
    }

    // Simpan pesan user
    let finalUserMessageId = user_message_id;
    if (!finalUserMessageId) {
      const { data: userMsgData, error: userMsgErr } = await supabase
        .from('messages')
        .insert({
          session_id: currentSessionId,
          role: 'user',
          content: userMessage,
          parent_id: effectiveParentId
        })
        .select()
        .single();
      if (userMsgErr) throw new Error("Gagal simpan pesan user: " + userMsgErr.message);
      finalUserMessageId = userMsgData.id;
    }

    // Simpan pesan AI
    const { data: aiMsgData, error: aiMsgErr } = await supabase
      .from('messages')
      .insert({
        session_id: currentSessionId,
        role: 'assistant',
        content: aiReply,
        parent_id: finalUserMessageId
      })
      .select()
      .single();
    if (aiMsgErr) throw new Error("Gagal simpan pesan AI: " + aiMsgErr.message);

    // Update timestamp sesi
    await supabase
      .from('sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', currentSessionId);

    console.log("✅ AAi selesai, session:", currentSessionId);

    res.status(200).json({
      success: true,
      reply: aiReply,
      session_id: currentSessionId,
      message_id: aiMsgData.id,
      user_message_id: finalUserMessageId
    });

  } catch (error) {
    console.error("=== SERVER ERROR ===", error.message);
    res.status(500).json({ error: error.message });
  }
}