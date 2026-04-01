import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ==================== MODEL UTAMA ====================
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

// ==================== WEB SEARCH (FREE APIs) ====================
async function webSearch(query) {
  console.log(`🌐 [FreeSearch] Query: "${query}"`);

  const isCodeQuery = /\b(code|coding|error|bug|function|javascript|python|sql|css|html|api|npm|git|typescript|react|node|debug|syntax|library|framework|stackover)\b/i.test(query);
  const results = [];

  // ── 1. Wikipedia Bahasa Indonesia ──
  try {
    const wikiIdRes = await fetch(
      `https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3&origin=*`
    );
    const wikiIdData = await wikiIdRes.json();
    const hits = wikiIdData?.query?.search || [];
    for (const hit of hits.slice(0, 2)) {
      const summaryRes = await fetch(
        `https://id.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`
      );
      const summary = await summaryRes.json();
      if (summary.extract) {
        results.push({
          title: summary.title,
          link: summary.content_urls?.desktop?.page || `https://id.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`,
          content: summary.extract.substring(0, 500)
        });
      }
    }
    console.log(`✅ Wikipedia ID: ${results.length} hasil`);
  } catch (e) {
    console.error('❌ Wikipedia ID error:', e.message);
  }

  // ── 2. Wikipedia English ──
  try {
    const wikiRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3&origin=*`
    );
    const wikiData = await wikiRes.json();
    const wikiHits = wikiData?.query?.search || [];
    for (const hit of wikiHits.slice(0, 2)) {
      const summaryRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`
      );
      const summary = await summaryRes.json();
      if (summary.extract) {
        results.push({
          title: summary.title,
          link: summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`,
          content: summary.extract.substring(0, 400)
        });
      }
    }
    console.log(`✅ Wikipedia EN: ${results.length} total hasil`);
  } catch (e) {
    console.error('❌ Wikipedia EN error:', e.message);
  }

  // ── 3. DuckDuckGo Instant Answer ──
  try {
    const ddgRes = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`
    );
    const ddgData = await ddgRes.json();
    if (ddgData.AbstractText) {
      results.push({
        title: ddgData.Heading || query,
        link: ddgData.AbstractURL || 'https://duckduckgo.com',
        content: ddgData.AbstractText.substring(0, 400)
      });
    }
    const related = ddgData.RelatedTopics?.slice(0, 2) || [];
    for (const topic of related) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.substring(0, 60),
          link: topic.FirstURL,
          content: topic.Text.substring(0, 300)
        });
      }
    }
    console.log(`✅ DuckDuckGo: abstract ada = ${!!ddgData.AbstractText}`);
  } catch (e) {
    console.error('❌ DuckDuckGo error:', e.message);
  }

  // ── 4. Stack Exchange (khusus coding) ──
  if (isCodeQuery) {
    try {
      const seRes = await fetch(
        `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=3&filter=withbody`
      );
      const seData = await seRes.json();
      const items = seData?.items || [];
      for (const item of items.slice(0, 2)) {
        const cleanBody = item.body ? item.body.replace(/<[^>]+>/g, '').substring(0, 350) : '';
        results.push({ title: item.title, link: item.link, content: cleanBody || item.title });
      }
      console.log(`✅ StackOverflow: ${items.length} hasil`);
    } catch (e) {
      console.error('❌ Stack Exchange error:', e.message);
    }
  }

  if (results.length === 0) {
    return { result: 'Tidak ada hasil pencarian. Jawab berdasarkan pengetahuanmu.', metadata: null };
  }

  const sources = results.map(r => ({ title: r.title, link: r.link }));
  const resultsText = results.map(r => `• ${r.title}\n  ${r.content}`).join('\n\n');
  return { result: resultsText, metadata: { sources, image: null } };
}

// ==================== TOOL DEFINITION ====================
const webSearchTool = {
  type: "function",
  function: {
    name: "web_search",
    description: "Cari informasi terkini di internet. Gunakan saat butuh data terbaru, berita, harga, atau fakta yang bisa berubah.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Query pencarian yang spesifik dan jelas" } },
      required: ["query"]
    }
  }
};

// ==================== MAIN HANDLER ====================
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Cuma terima POST bos!' });

  console.log("=== AAi REQUEST ===", { browsing_mode: req.body.browsing_mode });

  try {
    const {
      message,
      session_id,
      user_id,
      username,
      persona_name = 'Auto',
      browsing_mode = false,
      parent_id = null,
      user_message_id = null,
      image_base64 = null,
      image_mime = 'image/jpeg'
    } = req.body;

    const userMessage = message.trim();

    // ── 1. USER & PERSON ──
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

    // ── 2. FAMILY CONTEXT ──
    const { data: allPersons } = await supabase.from('persons').select('name, date_of_birth, role');
    const familyContext = (allPersons || []).map(p => {
      const age = p.date_of_birth ? calculateAge(p.date_of_birth) : '?';
      const dobStr = p.date_of_birth ? new Date(p.date_of_birth).toISOString().split('T')[0] : 'tidak diketahui';
      return `- ${p.name} (${p.role}, ${age} tahun, lahir ${dobStr})`;
    }).join('\n');

    const { data: relations } = await supabase.from('relationships').select('person_a(name,role), person_b(name,role), relation_type');
    const relationContext = (relations || [])
      .map(r => `- ${r.person_a.name} (${r.person_a.role}) ${r.relation_type} ${r.person_b.name} (${r.person_b.role})`)
      .join('\n') || 'Belum ada relasi.';

    const { data: memories } = await supabase.from('person_memory').select('key, value').eq('person_id', user.person_id);
    const memoryText = memories?.map(m => `${m.key}: ${m.value}`).join('\n') || 'Tidak ada memori permanen.';

    // ── 3. SMART CONTEXT ──
    let chatHistory = [];
    const currentSessMessages = session_id
      ? (await supabase
          .from('messages')
          .select('role, content, created_at')
          .eq('session_id', session_id)
          .order('created_at', { ascending: true })
          .limit(20)
        ).data || []
      : [];

    if (currentSessMessages.length >= 4) {
      chatHistory = currentSessMessages.slice(-20);
      console.log(`📚 Context: sesi saat ini (${chatHistory.length} pesan)`);
    } else {
      const { data: userSessions } = await supabase
        .from('sessions')
        .select('id')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(5);

      const sessionIds = userSessions?.map(s => s.id) || [];
      if (sessionIds.length > 0) {
        const { data: allHistory } = await supabase
          .from('messages')
          .select('role, content, created_at')
          .in('session_id', sessionIds)
          .order('created_at', { ascending: true })
          .limit(30);
        chatHistory = (allHistory || []).slice(-20);
      }

      if (chatHistory.length < 3) {
        const keywords = userMessage
          .replace(/[^a-zA-Z0-9\s]/g, '')
          .split(' ')
          .filter(w => w.length > 4)
          .slice(0, 5);

        if (keywords.length > 0) {
          const { data: crossMessages } = await supabase
            .from('messages')
            .select('role, content, created_at')
            .or(keywords.map(k => `content.ilike.%${k}%`).join(','))
            .eq('role', 'assistant')
            .order('created_at', { ascending: false })
            .limit(5);

          if (crossMessages?.length > 0) {
            console.log(`🔍 Lintas sesi: ${crossMessages.length} referensi`);
            chatHistory = [
              ...chatHistory,
              ...crossMessages.map(m => ({
                role: 'system',
                content: `[Referensi percakapan lain]: ${m.content.substring(0, 300)}`
              }))
            ];
          }
        }
      }
    }

    // ── 4. AUTO PERSONA ──
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

    // ── 5. SYSTEM PROMPT ──
    const systemPrompt = {
      role: "system",
      content: `Kamu adalah AAi, AI keluarga yang cerdas dan ramah.

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
- Gunakan bahasa Indonesia sehari-hari + emoji, respons panjang dan detail.
- Bantu pekerjaan konsep sulit, excel, coding, dll.
- Jika pertanyaan butuh info terbaru (berita, harga, orang terkenal, teknologi), gunakan tool web_search yang tersedia.
- Setelah mendapat hasil pencarian, langsung tulis jawabannya dalam bahasa natural.
- DILARANG menampilkan JSON, kode tool call, atau format teknis apapun ke user.
- JANGAN pernah menulis teks seperti {"type": "function"} atau format tool secara literal.`
    };

    const apiKey = process.env.OPENROUTER_API_KEY;

    // ── 6. SUSUN PESAN USER ──
    let userContent;
    if (image_base64) {
      userContent = [
        { type: "image_url", image_url: { url: `data:${image_mime};base64,${image_base64}` } },
        { type: "text", text: userMessage || "Jelaskan gambar ini." }
      ];
    } else {
      userContent = userMessage;
    }

    // Model: pakai Qwen kecuali ada gambar (Qwen ini text-only)
    const modelFirst = image_base64 ? "openai/gpt-4o" : MAIN_MODEL;

    // ── 7. FIRST CALL ──
    let payloadFirst = {
      model: modelFirst,
      messages: [systemPrompt, ...chatHistory, { role: "user", content: userContent }],
      temperature: 0.7,
      max_tokens: 4000
    };

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
    if (!firstResponse.ok || data.error) {
      console.error("❌ OPENROUTER ERROR:", data.error);
      throw new Error(data.error?.message || "Error dari OpenRouter API");
    }

    let aiMessage = data.choices?.[0]?.message ?? null;
    const toolCallsLength = aiMessage?.tool_calls?.length ?? 0;
    console.log("🔧 Tool calls:", toolCallsLength);

    // ── 8. HANDLE TOOL CALL ──
    let searchMetadata = null;

    if (toolCallsLength > 0) {
      messages.push(aiMessage);  // ← ini sudah ada di atas, tapi biar aman

      for (const toolCall of aiMessage.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        console.log("🔍 Web search:", args.query);

        let toolResultContent = '';
        try {
          const searchResult = await webSearch(args.query);
          if (!searchMetadata && searchResult.metadata) searchMetadata = searchResult.metadata;
          toolResultContent = `Hasil pencarian:\n${searchResult.result}`;
        } catch (err) {
          toolResultContent = `Pencarian gagal: ${err.message}. Jawab berdasarkan pengetahuanmu.`;
          console.error("❌ Tool error:", err.message);
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: "web_search",
          content: toolResultContent
        });
      }

      // Second call — pakai Qwen juga
      const secondResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: MAIN_MODEL,
          messages: messages,
          temperature: 0.7,
          max_tokens: 8000,
          top_p: 0.9,
          tool_choice: "none"
        })
      });

      data = await secondResponse.json();
      if (!secondResponse.ok || data.error) {
        throw new Error(data.error?.message || "Error second call");
      }
      aiMessage = data.choices?.[0]?.message ?? null;
    }

    const aiReply = aiMessage?.content || "Maaf, aku lagi bingung.";

    // ── 9. SIMPAN KE DATABASE ──
    let currentSessionId = session_id;

    if (!currentSessionId) {
      let newTitle = "Obrolan Baru";
      try {
        const titleRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MAIN_MODEL,
            messages: [{ role: "user", content: `Buatkan judul singkat (maks 3-4 kata) tanpa tanda kutip, tanpa titik di akhir, untuk pesan: "${userMessage}"` }],
            temperature: 0.3,
            max_tokens: 15
          })
        });
        const titleData = await titleRes.json();
        if (titleData.choices?.[0]?.message?.content) {
          newTitle = titleData.choices[0].message.content.replace(/["']/g, '').trim();
        }
      } catch (err) {
        newTitle = userMessage.substring(0, 30);
      }

      const { data: newSession, error: sesErr } = await supabase
        .from('sessions')
        .insert({ user_id: user.id, title: newTitle })
        .select()
        .single();
      if (sesErr) throw new Error("Gagal buat sesi: " + sesErr.message);
      currentSessionId = newSession.id;
    }

    let finalUserMessageId = user_message_id;
    if (!finalUserMessageId) {
      const { data: userMsgData, error: userMsgErr } = await supabase
        .from('messages')
        .insert({ session_id: currentSessionId, role: 'user', content: userMessage, parent_id: parent_id })
        .select()
        .single();
      if (userMsgErr) throw new Error("Gagal simpan pesan user: " + userMsgErr.message);
      finalUserMessageId = userMsgData.id;
    }

    const { data: aiMsgData, error: aiMsgErr } = await supabase
      .from('messages')
      .insert({ session_id: currentSessionId, role: 'assistant', content: aiReply, parent_id: finalUserMessageId })
      .select()
      .single();
    if (aiMsgErr) throw new Error("Gagal simpan pesan AI: " + aiMsgErr.message);

    console.log("✅ AAi selesai");
    res.status(200).json({
      reply: aiReply,
      session_id: currentSessionId,
      metadata: searchMetadata,
      message_id: aiMsgData.id,
      user_message_id: finalUserMessageId
    });

  } catch (error) {
    console.error("=== SERVER ERROR ===", error);
    res.status(500).json({ error: error.message });
  }
}