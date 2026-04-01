import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function calculateAge(dob) {
  if (!dob) return '?';
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
import https from 'https';

// ==================== WEB SEARCH (WIKIPEDIA API - STABIL & GRATIS) ====================
async function webSearch(query) {
  console.log(`🌐 [WebSearch] Query: "${query}"`);
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, gl: 'id', hl: 'id', num: 5 })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Gabungkan hasil organik jadi teks ringkas
    const results = (data.organic || []).slice(0, 3).map(r =>
      `• ${r.title}\n  ${r.snippet}`
    ).join('\n\n');

    const answer = data.answerBox?.answer || data.answerBox?.snippet || '';

    return {
      result: (answer ? `Jawaban Langsung: ${answer}\n\n` : '') + (results || 'Tidak ada hasil.'),
      source: data.organic?.[0]?.link || 'Google Search'
    };

  } catch (e) {
    console.error(`❌ WebSearch Error:`, e.message);
    return { result: `Gagal mencari: ${e.message}`, source: 'System' };
  }
}
// ==================== TOOL DEFINITION ====================
const webSearchTool = {
  type: "function",
  function: {
    name: "web_search",
    description: "Cari informasi terkini di internet (tahun 2025-2026). WAJIB dipakai kalau butuh data terbaru.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Query pencarian yang jelas" } },
      required: ["query"]
    }
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Cuma terima POST bos!' });

  console.log("=== AAi REQUEST DITERIMA ===", { browsing_mode: req.body.browsing_mode });

  try {
    const { message, session_id, user_id, username, persona_name = 'Auto', browsing_mode = false } = req.body;
    const userMessage = message.trim();

    // ====================== 1. USER & PERSON ======================
    let userQuery = supabase.from('users').select('id, person_id');
    if (user_id) userQuery = userQuery.eq('id', user_id);
    else if (username) userQuery = userQuery.eq('username', username);
    else throw new Error("user_id atau username wajib dikirim");

    const { data: user } = await userQuery.single();
    if (!user || !user.person_id) throw new Error("User atau person belum terhubung!");

    const { data: person } = await supabase
      .from('persons')
      .select('name, date_of_birth, role')
      .eq('id', user.person_id)
      .single();

    const currentAge = person.date_of_birth ? calculateAge(person.date_of_birth) : null;

    // Family + Relations + Memory
    const { data: allPersons } = await supabase.from('persons').select('name, date_of_birth, role');
    const familyContext = (allPersons || []).map(p => {
      const age = p.date_of_birth ? calculateAge(p.date_of_birth) : '?';
      const dobStr = p.date_of_birth ? new Date(p.date_of_birth).toISOString().split('T')[0] : 'tidak diketahui';
      return `- ${p.name} (${p.role}, ${age} tahun, lahir ${dobStr})`;
    }).join('\n');

    const { data: relations } = await supabase.from('relationships').select('person_a(name,role), person_b(name,role), relation_type');
    const relationContext = (relations || []).map(r => `- ${r.person_a.name} (${r.person_a.role}) ${r.relation_type} ${r.person_b.name} (${r.person_b.role})`).join('\n') || 'Belum ada relasi.';

    const { data: memories } = await supabase.from('person_memory').select('key, value').eq('person_id', user.person_id);
    const memoryText = memories?.map(m => `${m.key}: ${m.value}`).join('\n') || 'Tidak ada memori permanen.';

    // Chat History
    const { data: userSessions } = await supabase.from('sessions').select('id').eq('user_id', user.id);
    const sessionIds = userSessions?.map(s => s.id) || [];
    let chatHistory = [];
    if (sessionIds.length > 0) {
      const { data: allHistory } = await supabase.from('messages').select('role, content').in('session_id', sessionIds).order('created_at', { ascending: true }).limit(30);
      chatHistory = (allHistory || []).slice(-20);
    }

    // ====================== AUTO PERSONA ======================
    let targetPersona = persona_name;
    const msgLower = userMessage.toLowerCase();
    if (targetPersona === 'Auto') {
      if (msgLower.includes('kode') || msgLower.includes('bug') || msgLower.includes('function') || msgLower.includes('html') || msgLower.includes('css')) targetPersona = 'Kritikus Brutal';
      else if (msgLower.includes('sayang') || msgLower.includes('cinta') || msgLower.includes('mawar') || msgLower.includes('istri')) targetPersona = 'Rosalia';
      else targetPersona = 'Santai';
    }
    let personaList = [targetPersona];
    if (msgLower.includes('sayang') && targetPersona !== 'Rosalia') personaList = ['Santai', 'Rosalia'];

    const { data: personasData } = await supabase.from('ai_personas').select('name, system_prompt').in('name', personaList);
    const combinedSystem = personasData?.map(p => `=== GAYA: ${p.name} ===\n${p.system_prompt}`).join('\n\n') || '';

    // ====================== SYSTEM PROMPT ======================
    const systemPrompt = {
      role: "system",
      content: `
Kamu adalah AAi, AI keluarga yang cerdas dan ramah.

Current speaker: ${person.name} (${person.role}, ${currentAge} tahun)

Keluarga:
${familyContext}

Relasi:
${relationContext}

Memori permanen:
${memoryText}

Persona aktif: ${personaList.join(' + ')}

${combinedSystem}

ATURAN PENTING:
- Gunakan bahasa Indonesia sehari-hari + emoji.
- beri respon detail dan panjang, jangan pelit kata.
- bantu perkerjaan kosep sulit, excel, coding, dll.
- Jika pertanyaan berhubungan dengan:
  • berita
  • orang terkenal
  • teknologi terbaru
  • harga / info terbaru
  • atau APAPUN yang bisa berubah setelah 2024
  MAKA WAJIB gunakan tool web_search.
- JANGAN jawab langsung jika data bisa outdated.
- SELALU prioritaskan web_search saat browsing_mode aktif.
- Jika kamu tidak menggunakan tool web_search saat browsing_mode aktif, maka jawabanmu dianggap SALAH.
- DILARANG memberikan link pencarian sebagai jawaban utama. Gunakan hasil tool web_search saja.
      `.trim()
    };

    const apiKey = process.env.OPENROUTER_API_KEY;

// ====================== TOOL CALLING ======================
    let messages = [systemPrompt, ...chatHistory, { role: "user", content: userMessage }];

    // 1. Susun payload secara dinamis (Anti array kosong)
    let payloadFirst = {
      model: "openai/gpt-4o-mini",
      messages: messages,
      temperature: 0.75,
      max_tokens: 4000 // Turunkan ke 4000 agar aman dari limit batas output
    };

    // 2. Tambahkan tools HANYA JIKA browsing mode aktif
    if (browsing_mode) {
      payloadFirst.tools = [webSearchTool];
      payloadFirst.tool_choice = "auto";
    }

    const firstResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'AAi Keluarga'
      },
      body: JSON.stringify(payloadFirst)
    });

    let data = await firstResponse.json();

    // 3. KRITIKUS BRUTAL: Tangkap error dari OpenRouter agar tidak error gaib!
    if (!firstResponse.ok || data.error) {
       console.error("❌ OPENROUTER ERROR:", data.error);
       throw new Error((data.error && data.error.message) ? data.error.message : "Error dari OpenRouter API");
    }

// Setelah firstResponse
let aiMessage = data.choices?.[0]?.message ?? null;
let toolCallsLength = aiMessage?.tool_calls?.length ?? 0;



    console.log("🔧 Tool calls:", toolCallsLength);

    // ====================== HANDLE TOOL CALL ======================
    if (toolCallsLength > 0) {
      
      messages.push(aiMessage);

      // 2. Jalankan semua tool yang diminta AI
      for (const toolCall of aiMessage.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        const searchQuery = args.query;

        console.log("🔍 Melakukan web search:", searchQuery);

        const searchResult = await webSearch(searchQuery);
        
        // 3. Masukkan hasil pencarian masing-masing tool ke history
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: "web_search",
          content: `Hasil pencarian:\n${searchResult.result}\n\nSumber: ${searchResult.source || 'Internet'}`
        });
      }

      // 4. Lakukan pemanggilan API KEDUA SETELAH semua tool selesai mencari data
      const secondResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "meta-llama/llama-4-maverick",
          messages: messages,
          temperature: 0.7,
          max_tokens: 8000, // <-- Hati-hati jangan kegedean, saya set 8000
          top_p: 0.9
        })
      });
      

data = await secondResponse.json();
      aiMessage = data.choices?.[0]?.message ?? null;
    }
    const aiReply = (aiMessage && aiMessage.content) ? aiMessage.content : "Maaf, aku lagi bingung.";
    // ====================== SIMPAN KE DATABASE ======================
    let currentSessionId = session_id;

    if (!currentSessionId) {
      let newTitle = "Obrolan Baru";
      
      // Minta AI buatkan judul pendek (3-4 kata)
      try {
        const titleRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${apiKey}`, 
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            messages: [{ 
              role: "user", 
              content: `Buatkan judul singkat (maks 3-4 kata) tanpa tanda kutip, tanpa titik di akhir, untuk pesan ini: "${userMessage}"` 
            }],
            temperature: 0.3,
            max_tokens: 15
          })
        });

const titleData = await titleRes.json();
        
    if (titleData.choices && titleData.choices.length > 0 && titleData.choices.message && titleData.choices.message.content) {
          newTitle = titleData.choices.message.content
            .replace(/["']/g, '')           // hapus kutip
            .trim();
        }
      } catch (err) {
        console.error("Gagal buat auto-title:", err);
        newTitle = userMessage.substring(0, 30); // fallback
      }

      // Insert sesi baru
      const { data: newSession, error: sesErr } = await supabase
        .from('sessions')
        .insert({ 
          user_id: user.id, 
          title: newTitle 
        })
        .select()
        .single();
      
      if (sesErr) throw new Error("Gagal membuat sesi baru: " + sesErr.message);
      currentSessionId = newSession.id;
    }

    // Simpan pesan user + assistant
    await supabase.from('messages').insert([
      { session_id: currentSessionId, role: 'user', content: userMessage },
      { session_id: currentSessionId, role: 'assistant', content: aiReply }
    ]);

    console.log("✅ AAi berhasil jawab");

    res.status(200).json({ 
      reply: aiReply, 
      session_id: currentSessionId 
    });

  } catch (error) {
    console.error("=== SERVER ERROR ===", error);
    res.status(500).json({ error: error.message });
  }
}