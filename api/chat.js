export const maxDuration = 300;
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { createClient } from '@supabase/supabase-js';

let Document, Packer, Paragraph, TextRun;
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAIN_MODEL = "qwen/qwen3.6-plus:free";

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
    'Coding':          { temperature: 0.0, max_tokens: 52000,  top_p: 0.85 },
    'Kritikus Brutal': { temperature: 0.3, max_tokens: 3000,  top_p: 0.85 },
    'Santai':          { temperature: 0.8, max_tokens: 1500,  top_p: 0.95 },
    'Rosalia':         { temperature: 0.95, max_tokens: 1000, top_p: 0.95 }, 
    'Auto':            { temperature: 0.7, max_tokens: 3000,  top_p: 0.9  }
  };
  return configs[persona] || configs['Auto'];
}

function getModelName(personaList) {
  const persona = personaList[0];
  return persona === 'Coding' 
    ? "qwen/qwen3.6-plus:free" 
    : "qwen/qwen3.6-plus:free";
}

// ✅ HELPER: Upload Base64 ke Supabase Storage
async function uploadFileToStorage(base64String, fileName, mimeType) {
  const base64 = base64String.split(',')[1];
  const buffer = Buffer.from(base64, 'base64');
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `uploads/${Date.now()}-${safeName}`;
  
  const { error } = await supabase.storage
    .from('aai-files')
    .upload(filePath, buffer, { contentType: mimeType, upsert: false });
  if (error) throw new Error(`Gagal upload: ${error.message}`);
  
  const { data: { publicUrl } } = supabase.storage.from('aai-files').getPublicUrl(filePath);
  return publicUrl;
}



export default async function handler(req, res) {

  // ── GET: Load riwayat sesi ──
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
      return res.status(200).json({ success: true, messages: messages || [] });
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
      persona_name = 'Auto', parent_id = null, user_message_id = null,
      assistant_message_id = null,
      update_only = false,
      edit_message_id = null,
      files = [] // ← Terima array file dari frontend
    } = req.body;

    const userMessage = message?.trim();
    if (!userMessage && !edit_message_id) throw new Error("Pesan tidak boleh kosong");

        // ====================== EDIT PESAN (UPDATE) ======================
    if (edit_message_id) {
      // Update hanya kolom content (tidak ada updated_at di tabel messages)
      const { error: updateErr } = await supabase
        .from('messages')
        .update({ content: userMessage })
        .eq('id', edit_message_id);

      if (updateErr) throw new Error("Gagal update pesan user: " + updateErr.message);

      console.log(`✅ Pesan ${edit_message_id} berhasil di-update`);

      if (update_only) {
        return res.status(200).json({
          success: true,
          message_id: edit_message_id,
          updated_only: true
        });
      }
    }

        // ✅ PROSES FILE + EKSTRAK TEKS (TXT, XLSX, DOCX, GAMBAR)
    let fileContext = '';
    if (files && files.length > 0) {
      console.log(`[Files] Menerima ${files.length} file.`);
      const uploadedUrls = [];
      const textContents = [];

      for (const f of files) {
        if (!f.base64) continue;
        try {
          const url = await uploadFileToStorage(f.base64, f.name, f.type);
          uploadedUrls.push(url);

          const base64Data = f.base64.split(',')[1];
          const buffer = Buffer.from(base64Data, 'base64');

          // 1. Excel (.xlsx, .xls)
          if (f.type.includes('sheet') || f.name.match(/\.xlsx?$/i)) {
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet);
            textContents.push(`📊 ${f.name} (Sheet: ${sheetName}):\n${csv}`);
          }
          // 2. Word (.docx)
          else if (f.type.includes('word') || f.name.match(/\.docx$/i)) {
            const result = await mammoth.extractRawText({ buffer });
            textContents.push(`📝 ${f.name}:\n${result.value}`);
          }
          // 3. Teks biasa (.txt)
          else if (f.type === 'text/plain' || f.name.toLowerCase().endsWith('.txt')) {
            textContents.push(`📄 ${f.name}:\n${buffer.toString('utf-8')}`);
          }
          // 4. Gambar (URL saja, model vision nanti bisa baca)
          else if (f.type.startsWith('image/')) {
            textContents.push(`🖼️ ${f.name}: ${url}`);
          }
        } catch (e) {
          console.error(`⚠️ Gagal ekstrak ${f.name}:`, e.message);
        }
      }

      if (uploadedUrls.length > 0) {
        fileContext += `\n\n📎 File yang dilampirkan (URL):\n${uploadedUrls.map((u, i) => `${i+1}. ${u}`).join('\n')}`;
      }
      if (textContents.length > 0) {
        fileContext += `\n\n📝 KONTEN FILE (WAJIB DIBACA & DIJAWAB):\n${textContents.join('\n\n---\n\n')}`;
      }
    }

    
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

    // 2. Family context (sama seperti sebelumnya)
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

    let targetAssistantMessageId = assistant_message_id || null;
    if (!targetAssistantMessageId && edit_message_id) {
      const { data: existingAssistant } = await supabase
        .from('messages')
        .select('id')
        .eq('session_id', session_id)
        .eq('parent_id', edit_message_id)
        .eq('role', 'assistant')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      targetAssistantMessageId = existingAssistant?.id || null;
    }

    // 3. Chat history
    const apiKey = process.env.OPENROUTER_API_KEY;
    const chatHistoryRows = session_id
      ? ((await supabase.from('messages').select('id, role, content')
          .eq('session_id', session_id).order('created_at', { ascending: true })).data || [])
      : [];

    let historyCutoffIndex = chatHistoryRows.length;
    if (edit_message_id) {
      const editedIndex = chatHistoryRows.findIndex(m => m.id === edit_message_id);
      if (editedIndex >= 0) historyCutoffIndex = editedIndex + 1;
    } else if (targetAssistantMessageId) {
      const assistantIndex = chatHistoryRows.findIndex(m => m.id === targetAssistantMessageId);
      if (assistantIndex >= 0) historyCutoffIndex = assistantIndex;
    }

    const chatHistory = chatHistoryRows
      .slice(0, historyCutoffIndex)
      .filter(m => m.id !== targetAssistantMessageId)
      .map(m => ({ role: m.role, content: m.content }));

    // 4. Persona (sama)
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

${fileContext}

Persona aktif: ${personaList.join(' + ')}
${combinedSystem}

ATURAN PENTING:
- Gunakan bahasa Indonesia sehari-hari + emoji, respons panjang dan detail.
- Bantu pekerjaan konsep sulit, excel, coding, dll.
- untuk user bernama teguh ketika meminta perbaiki bug, membuat fitur atau coding selain ia bukan bertanya apa penyebabnya atau bukan mode diskusi :
      1.utamakan memberikan coding, dibanding penjelasan panjang untuk hemat token jika user = teguh. 
      2.teguh sedang merancang sistem ai dan ux sebagai pemula, berikan coding terbaik untuk jangka panjang, bukan solusi cepat yang mungkin bikin masalah di kemudian hari.
      3. planingnya memanfaatkan ai yang ada dalam membangun sistem ai, ketika ia sudah punya modal, ia akan mengganti otak nya menjadi versi server lokal.
      4. jika teguh meminta sesuatu fitur atau suatu hal yang tidak begitu penting, berikan penjelasan atau opsi alternatif lebih baik yang berguna untuk masa depan.
- untuk user rosalia :
      1. utamakan bahasa yang lembut, penuh kasih sayang, dan dukungan emosional serta dengan candaan.
      2. bantu dia belajar dunia teknologi dan pemrograman dengan cara yang menyenangkan, tanpa membuatnya merasa kewalahan.
- Jangan gunakan panggilan gw, lu, gue, lo. Utamakan nama, "kamu" atau sayang.
- Jawab langsung dan lengkap. DILARANG memotong jawaban di tengah.
- Jika ada URL gambar/file di atas, sebutkan bahwa file berhasil diterima dan berikan link jika relevan.
- Jika user melampirkan file/teks, WAJIB konfirmasi dulu: "File [nama] berhasil dibaca. Berikut ringkasannya:" sebelum menjawab pertanyaan utama.
- Jika user minta buat file, WAJIB gunakan format: [FILE_START:nama_file.ext] (isi konten) [FILE_END]. Gunakan .txt untuk teks, .xlsb untuk tabel (pisahkan kolom dengan tanda #, BUKAN koma), .docx untuk dokumen.
- Setelah generate, AI tidak perlu menjelaskan proses teknis. Langsung berikan link download.
- Jangan abaikan konten lampiran. Gunakan sebagai konteks utama jika relevan.
- Jika user minta macro/VBA, WAJIB buat 2 file terpisah:
  1. [FILE_START:data_nama.xlsb] (data tabel, pisah kolom dengan #) [FILE_END]
  2. [FILE_START:macro_nama.bas] (kode VBA lengkap, tanpa markdown) [FILE_END]
- Setelah generate, AI tidak perlu menjelaskan proses teknis. Langsung berikan link download + instruksi singkat: "Alt+F11 → File → Import Module → pilih .bas → Run".`
    };

    // Buat sesi baru jika belum ada
    let currentSessionId = session_id;
    if (!currentSessionId) {
      const quickTitle = userMessage.length > 25 ? userMessage.substring(0, 25) + "..." : userMessage;
      const { data: newSession } = await supabase
        .from('sessions').insert({ user_id: user.id, title: quickTitle }).select().single();
      currentSessionId = newSession.id;
      generateTitle(apiKey, userMessage, currentSessionId);
    }

    // Simpan pesan user (kecuali kalau edit)
    let finalUserMessageId = edit_message_id || user_message_id;
    if (!edit_message_id && !finalUserMessageId) {
      let effectiveParentId = parent_id;
      if (!effectiveParentId) {
        const { data: lastMsg } = await supabase.from('messages').select('id')
          .eq('session_id', currentSessionId).order('created_at', { ascending: false })
          .limit(1).maybeSingle();
        effectiveParentId = lastMsg?.id || null;
      }

      const { data: userMsgData } = await supabase.from('messages').insert({
        session_id: currentSessionId, role: 'user',
        content: userMessage, parent_id: effectiveParentId
      }).select().single();
      finalUserMessageId = userMsgData.id;
    }

    // ── STREAMING ──
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const modelConfig = getModelConfig(personaList);

        // ── OPENROUTER CALL + DETAILED LOGGING ──
    console.log(`[OpenRouter] Mengirim request ke model: ${MAIN_MODEL}`);

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
  messages: [
    systemPrompt,
    ...chatHistory,
    {
      role: "user",
      content: `${userMessage}${fileContext ? `\n\n📎 LAMPIRAN FILE:\n${fileContext}` : ''}`
    }
  ],
  stream: true,
  temperature: modelConfig.temperature,
  max_tokens: modelConfig.max_tokens,
  top_p: modelConfig.top_p
})
    });

    console.log(`[OpenRouter] Status response: ${aiResponse.status} ${aiResponse.statusText}`);

    if (!aiResponse.ok) {
      let errorDetail = 'Unknown error';
      try {
        const errData = await aiResponse.json();
        errorDetail = JSON.stringify(errData, null, 2);
        console.error(`[OpenRouter] ERROR DETAIL:`, errData);
      } catch (e) {
        errorDetail = await aiResponse.text();
        console.error(`[OpenRouter] Raw error text:`, errorDetail);
      }

      res.write(`data: ${JSON.stringify({ error: `Provider returned error - ${aiResponse.status} ${errorDetail}` })}\n\n`);
      res.end();
      return;
    }

    const reader = aiResponse.body.getReader();
    const decoder = new TextDecoder();
    let fullReply = '';
    let buffer = '';
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {}
    }, 10000);

    function processSSEBuffer(buf) {
      const lines = buf.split('\n');
      const remainder = lines.pop() || '';
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
            res.flush?.();
          }
        } catch {}
      }
      return remainder;
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = processSSEBuffer(buffer);
      }
      // Flush decoder + sisa buffer
      buffer += decoder.decode();
      if (buffer.trim()) processSSEBuffer(buffer + '\n');
    } catch (streamErr) {
      console.error("Stream error:", streamErr.message);
    } finally {
      clearInterval(heartbeat);
    }

    // Simpan AI response ke DB — LANGSUNG setelah stream selesai, SEBELUM file processing
    if (fullReply.trim()) {
      // 1. Simpan dulu ke DB (raw reply, biar cepat)
      let aiMsgData;
      if (targetAssistantMessageId) {
        const { data: updatedAssistant, error: updateAssistantErr } = await supabase
          .from('messages')
          .update({
            content: fullReply,
            parent_id: finalUserMessageId || edit_message_id
          })
          .eq('id', targetAssistantMessageId)
          .select()
          .single();

        if (updateAssistantErr) throw updateAssistantErr;
        aiMsgData = updatedAssistant;
      } else {
        const { data: insertedAssistant, error: insertAssistantErr } = await supabase
          .from('messages')
          .insert({
            session_id: currentSessionId,
            role: 'assistant',
            content: fullReply,
            parent_id: finalUserMessageId || edit_message_id
          })
          .select()
          .single();

        if (insertAssistantErr) throw insertAssistantErr;
        aiMsgData = insertedAssistant;
      }

      await supabase.from('sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', currentSessionId);

      // 2. Kirim event `done` ke client SEGERA
      res.write(`data: ${JSON.stringify({
        done: true,
        session_id: currentSessionId,
        message_id: aiMsgData?.id,
        user_message_id: finalUserMessageId
      })}\n\n`);
      res.flush?.();

      // 3. File processing di background (setelah client sudah dapat `done`)
      try {
        const fileRegex = /\[FILE_START:(.+?)\]([\s\S]*?)\[FILE_END\]/g;
        let match;
        let processedReply = fullReply;
        let hasFiles = false;

        while ((match = fileRegex.exec(fullReply)) !== null) {
          hasFiles = true;
          const filename = match[1].trim();
          let content = match[2].trim();
          const ext = filename.split('.').pop().toLowerCase();

          let buffer;
          try {
            if (ext === 'txt') {
              buffer = Buffer.from(content, 'utf-8');
            } 
            else if (ext === 'bas' || ext === 'vba') {
              buffer = Buffer.from(content, 'utf-8');
            } 
            else if (ext === 'xlsb' || ext === 'xlsx' || ext === 'xls') {
              const rows = content.split('\n').map(row => row.split('#').map(c => c.trim()));
              const ws = XLSX.utils.aoa_to_sheet(rows);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, 'Data');
              buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsb' });
            } 
            else if (ext === 'docx') {
              const docx = await import('docx');
              Document = docx.Document;
              Packer = docx.Packer;
              Paragraph = docx.Paragraph;
              TextRun = docx.TextRun;
              const paragraphs = content.split('\n').map(line =>
                new Paragraph({ children: [new TextRun({ text: line, font: 'Arial', size: 24 })] })
              );
              const doc = new Document({ sections: [{ children: paragraphs }] });
              buffer = await Packer.toBuffer(doc);
            } else {
              buffer = Buffer.from(content, 'utf-8');
            }

            const filePath = `generations/${Date.now()}-${filename}`;
            const mimeMap = {
              'xlsb': 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
              'bas': 'text/plain',
              'vba': 'text/plain',
              'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            };

            const { error } = await supabase.storage.from('aai-files').upload(filePath, buffer, {
              contentType: mimeMap[ext] || 'text/plain',
              upsert: false
            });

            if (!error) {
              const { data: { publicUrl } } = supabase.storage.from('aai-files').getPublicUrl(filePath);
              processedReply = processedReply.replace(match[0], `📥 **[Download ${filename}](${publicUrl})**`);
            } else {
              processedReply = processedReply.replace(match[0], `⚠️ Gagal upload: ${error.message}`);
            }
          } catch (e) {
            console.error(`⚠️ Gagal generate ${filename}:`, e.message);
            processedReply = processedReply.replace(match[0], `⚠️ Error: ${e.message}`);
          }
        }

        // Update DB dengan versi yang sudah diproses (file links)
        if (hasFiles && aiMsgData?.id) {
          await supabase.from('messages')
            .update({ content: processedReply })
            .eq('id', aiMsgData.id);
        }
      } catch (fileErr) {
        console.error("File processing error:", fileErr.message);
      }
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Respons kosong dari model.' })}\n\n`);
    }

    res.end();

  } catch (error) {
    console.error("=== ERROR ===", error.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
}

async function generateTitle(apiKey, userMessage, sessionId) {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "qwen/qwen3.6-plus:free", // ← Hardcode biar nggak error
        messages: [{ role: "user", content: `Buatkan judul obrolan yang sangat singkat (1-3 kata saja) untuk pesan ini: "${userMessage}". Balas HANYA dengan judul, tanpa tanda kutip, tanpa titik, tanpa basa-basi.` }],
        temperature: 0.3, max_tokens: 20
      })
    });
    const d = await r.json();
    const title = d.choices?.[0]?.message?.content?.replace(/["'.]/g, '').trim();
    if (title) {
      await supabase.from('sessions').update({ title }).eq('id', sessionId);
    }
  } catch {}
}