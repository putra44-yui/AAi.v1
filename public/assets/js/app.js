// ══════════════════════════════════════════
// STATE GLOBAL
// ══════════════════════════════════════════
const LAST_SESSION_OWNER_KEY = 'aai_last_session_owner';
const currentUser = JSON.parse(localStorage.getItem('aai_user') || '{}');
if (!currentUser.id) window.location.href = '/login';
clearStoredSessionOnUserMismatch();
if (currentUser.username || currentUser.person_name) {
  document.getElementById('cardUsername').textContent = currentUser.username || currentUser.person_name;
}
if (currentUser.family_role) {
  document.getElementById('cardFamilyRole').textContent = currentUser.family_role;
}

let sessions         = [];
let currentSessionId = null;
let currentSessionMeta = null;
let sessionLoadSerial = 0;
const currentPersona = 'Auto'; // Single adaptive AAi voice; legacy persona preferences ignored.
let currentModelPreference = localStorage.getItem('aai_model_preference') === 'free-auto' ? 'free-auto' : 'main';
// External search requires an affirmative, persisted user choice (off by default).
let currentWebPermission = localStorage.getItem('aai_web_tool_permission') === 'allow' ? 'allow' : 'deny';
const currentMemoryExperimentMode = 'context-heavy';
let currentMessages  = [];
let activeVersionMap = {};
let currentUtterance = null;
let isSpeaking       = false;
let abortController  = null;
let chatMutationRunning = false;
let selectedFiles    = [];
let msgboxState = null;
let pendingFriendSuggestion = null;
const pendingFileJobPollers = new Map();
const REASONING_PREVIEW_ENABLED = false;
let scrollBottomFrame = null;
let stickyCodeHeaderTimer = null;
let suppressAutoScroll = false;
let activeRenderJob = 0;

function isMobileViewport() {
  return window.innerWidth <= 768 || navigator.maxTouchPoints > 0;
}

function getPreferredDisplayName() {
  return String(currentUser.username || currentUser.person_name || 'User').trim();
}

function getWelcomeIllustrationSrc() {
  return '/aai-mascot-studio.png';
}

function clearStoredSessionOnUserMismatch() {
  const storedOwner = localStorage.getItem(LAST_SESSION_OWNER_KEY);
  if (!storedOwner || !currentUser?.id || String(storedOwner) === String(currentUser.id)) return;
  localStorage.removeItem('aai_last_session');
  localStorage.removeItem(LAST_SESSION_OWNER_KEY);
}

function clearStoredSessionState() {
  localStorage.removeItem('aai_last_session');
  localStorage.removeItem(LAST_SESSION_OWNER_KEY);
}

function buildSessionFallbackTitle(rawTitle = '') {
  const normalized = String(rawTitle || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Obrolan baru';
  return normalized.length > 42 ? `${normalized.slice(0, 39).trim()}...` : normalized;
}

function buildTopicSessionTitle(rawMessage = '') {
  const stopwords = new Set([
    'aku', 'saya', 'kamu', 'kau', 'dia', 'kami', 'kita', 'mereka', 'yang', 'dan',
    'atau', 'dari', 'untuk', 'dengan', 'pada', 'dalam', 'jadi', 'bukan', 'tidak',
    'gak', 'nggak', 'enggak', 'ada', 'ini', 'itu', 'tadi', 'sekarang', 'sudah',
    'belum', 'bisa', 'mau', 'ingin', 'perlu', 'kalau', 'karena', 'tapi', 'namun',
    'apakah', 'bagaimana', 'kenapa', 'mengapa', 'apa', 'sih', 'dong', 'deh',
    'ya', 'nih', 'lah', 'loh', 'dulu', 'baru', 'lagi', 'saja', 'aja',
    'tolong', 'coba', 'buat', 'bikin', 'kasih', 'minta', 'bantu',
    'di', 'ke', 'punya', 'jelaskan', 'menjelaskan', 'dijelaskan',
    'membahas', 'bersama', 'sedang', 'sebuah',
    'the', 'a', 'an', 'is', 'are', 'i', 'you', 'we', 'and', 'for', 'with', 'to', 'of', 'in'
  ]);
  const words = (String(rawMessage).match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || [])
    .filter(word => word.length > 1 && !stopwords.has(word.toLowerCase()) &&
      !/^a?(?:wk){2,}w?k?$/i.test(word) && !/^ak(?:wk){2,}$/i.test(word)).slice(0, 5);
  if (!words.length) return 'Obrolan Bersama AAi';
  if (words.length === 1) words.unshift('Tentang');
  while (words.join(' ').length > 42 && words.length > 2) words.pop();
  const title = words.join(' ');
  return buildSessionFallbackTitle(title.charAt(0).toUpperCase() + title.slice(1));
}

function isProvisionalSessionTitle(rawTitle = '') {
  const normalized = String(rawTitle || '').replace(/\s+/g, ' ').trim();
  return !normalized || normalized === 'Memuat sesi...' || normalized === 'Obrolan baru';
}

function buildSessionTitleFromMessages(messages = []) {
  const firstUserMessage = messages.find(message => message.role === 'user' && String(message.content || '').trim());
  return buildTopicSessionTitle(firstUserMessage?.content || '');
}

function upsertSessionSnapshot(nextSession, { makeFirst = false } = {}) {
  const normalizedId = String(nextSession?.id || '').trim();
  if (!normalizedId) return null;

  const mergedSession = {
    ...(nextSession || {}),
    id: normalizedId,
    title: buildSessionFallbackTitle(nextSession?.title),
    updated_at: nextSession?.updated_at || new Date().toISOString()
  };

  const existingIndex = sessions.findIndex(session => session.id === normalizedId);
  if (existingIndex >= 0) {
    const current = { ...sessions[existingIndex], ...mergedSession };
    if (makeFirst && existingIndex > 0) {
      sessions = [current, ...sessions.filter((_, index) => index !== existingIndex)];
    } else {
      sessions[existingIndex] = current;
    }
    return current;
  }

  sessions = makeFirst ? [mergedSession, ...sessions] : [...sessions, mergedSession];
  return mergedSession;
}

function persistCurrentSession(sessionId, {
  force = false,
  title = null,
  makeFirst = false,
  refreshSidebar = false
} = {}) {
  const normalizedId = String(sessionId || '').trim();
  if (!normalizedId) return false;
  if (!force && currentSessionId && currentSessionId !== normalizedId) return false;

  currentSessionId = normalizedId;
  localStorage.setItem('aai_last_session', normalizedId);
  if (currentUser?.id) {
    localStorage.setItem(LAST_SESSION_OWNER_KEY, String(currentUser.id));
  }

  const existing = sessions.find(session => session.id === normalizedId) || null;
  if (title || !existing || makeFirst) {
    const nextSession = upsertSessionSnapshot({
      ...(existing || {}),
      id: normalizedId,
      title: title || existing?.title || 'Obrolan baru',
      compact_checkpoint_at: existing?.compact_checkpoint_at || null,
      updated_at: new Date().toISOString()
    }, { makeFirst });
    if (nextSession) currentSessionMeta = nextSession;
  } else if (existing) {
    currentSessionMeta = existing;
  }

  document.getElementById('topbarTitle').textContent = currentSessionMeta?.title || 'AAi';

  if (refreshSidebar) renderSidebar();
  return true;
}

function getLastUserPromptText() {
  const latestUserMessage = [...currentMessages].reverse()
    .find(message => message.role === 'user' && String(message.content || '').trim());
  if (latestUserMessage) return latestUserMessage.content;

  const chatArea = document.getElementById('chatArea');
  const userRows = chatArea ? Array.from(chatArea.querySelectorAll('.msg-row.user')) : [];
  const lastRow = userRows[userRows.length - 1];
  if (!lastRow) return '';

  return safeDecodeURIComponent(lastRow.getAttribute('data-raw') || lastRow.textContent || '');
}

function scheduleStickyCodeHeadersUpdate() {
  if (!document.querySelector('.code-window')) return;
  if (stickyCodeHeaderTimer) return;
  stickyCodeHeaderTimer = setTimeout(() => {
    stickyCodeHeaderTimer = null;
    requestAnimationFrame(() => {
      updateStickyCodeHeaders();
    });
  }, 80);
}

async function clearRuntimeCaches() {
  if ('caches' in window) {
    try {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map(cacheKey => caches.delete(cacheKey)));
    } catch (error) {
      console.warn('Gagal membersihkan cache runtime:', error);
    }
  }

  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.update()));
    } catch (error) {
      console.warn('Gagal refresh service worker:', error);
    }
  }
}

const PLANNING_COMMAND_PATTERNS = {
  list: /(apa\s+(rencana|perencanaan)\s*(kita)?|tampilkan\s+(rencana|perencanaan)|list\s+rencana)/i,
  save: /^(ingat\s+ini|catat\s+(rencana|ini)|simpan\s+rencana|ingat\s+rencana)\b/i,
  saveFromContext: /^(catat|ingat|simpan)\s+(ya|itu|deh|aja|dong)\s*[.!?]*$/i,
  saveFromContextAlt: /^(ok|oke)\s+(catat|ingat|simpan)\s*[.!?]*$/i,
  delete: /^(hapus|delete)\s+rencana\b/i,
  update: /^(update|ubah|edit)\s+rencana\b/i
};

function getMsgboxElements() {
  return {
    overlay: document.getElementById('msgbox'),
    title: document.getElementById('msgboxTitle'),
    text: document.getElementById('msgboxText'),
    inputWrap: document.getElementById('msgboxInputWrap'),
    input: document.getElementById('msgboxInput'),
    confirmBtn: document.getElementById('msgboxConfirmBtn'),
    cancelBtn: document.getElementById('msgboxCancelBtn')
  };
}

function closeMsgbox(result = null) {
  if (!msgboxState) return;
  const { resolve, elements } = msgboxState;
  elements.overlay.classList.remove('active');
  elements.overlay.setAttribute('aria-hidden', 'true');
  elements.confirmBtn.onclick = null;
  elements.cancelBtn.onclick = null;
  elements.overlay.onclick = null;
  elements.input.onkeydown = null;
  msgboxState = null;
  resolve(result);
}

function openMsgbox(options = {}) {
  const {
    mode = 'alert',
    title = 'Pesan',
    message = '',
    confirmText = 'OK',
    cancelText = 'Batal',
    defaultValue = '',
    placeholder = ''
  } = options;

  return new Promise(resolve => {
    const elements = getMsgboxElements();
    if (!elements.overlay || !elements.title || !elements.text || !elements.confirmBtn || !elements.cancelBtn || !elements.inputWrap || !elements.input) {
      resolve(mode === 'prompt' ? null : false);
      return;
    }

    const isPrompt = mode === 'prompt';
    const isConfirmLike = mode === 'confirm' || isPrompt;

    elements.title.textContent = title;
    elements.text.textContent = message;
    elements.confirmBtn.textContent = confirmText;
    elements.cancelBtn.textContent = cancelText;
    elements.cancelBtn.style.display = isConfirmLike ? 'inline-flex' : 'none';
    elements.inputWrap.style.display = isPrompt ? 'block' : 'none';
    elements.input.value = isPrompt ? String(defaultValue || '') : '';
    elements.input.placeholder = placeholder || '';

    msgboxState = { resolve, mode, elements };

    elements.confirmBtn.onclick = () => {
      if (!msgboxState) return;
      if (isPrompt) {
        closeMsgbox(elements.input.value);
        return;
      }
      closeMsgbox(true);
    };

    const cancelHandler = () => {
      if (!msgboxState) return;
      closeMsgbox(isPrompt ? null : false);
    };

    elements.cancelBtn.onclick = cancelHandler;
    elements.overlay.onclick = event => {
      if (event.target !== elements.overlay) return;
      cancelHandler();
    };

    elements.input.onkeydown = event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        elements.confirmBtn.click();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelHandler();
      }
    };

    document.addEventListener('keydown', function onEsc(event) {
      if (!msgboxState || msgboxState.elements !== elements) {
        document.removeEventListener('keydown', onEsc);
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelHandler();
      document.removeEventListener('keydown', onEsc);
    });

    elements.overlay.classList.add('active');
    elements.overlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      if (!msgboxState || msgboxState.elements !== elements) return;
      if (isPrompt) {
        elements.input.focus();
        elements.input.selectionStart = elements.input.selectionEnd = elements.input.value.length;
      } else {
        elements.confirmBtn.focus();
      }
    }, 20);
  });
}

function showAlertMessage(message, title = 'Informasi') {
  return openMsgbox({ mode: 'alert', title, message, confirmText: 'OK' });
}

function showConfirmMessage(message, title = 'Konfirmasi', confirmText = 'Ya', cancelText = 'Batal') {
  return openMsgbox({ mode: 'confirm', title, message, confirmText, cancelText });
}

function showPromptMessage({
  title = 'Masukkan Nilai',
  message = '',
  defaultValue = '',
  placeholder = '',
  confirmText = 'Simpan',
  cancelText = 'Batal'
} = {}) {
  return openMsgbox({ mode: 'prompt', title, message, defaultValue, placeholder, confirmText, cancelText });
}

function normalizePlanningText(input = '') {
  return String(input || '').replace(/\s+/g, ' ').trim();
}

function splitTitleAndContent(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return { title: '', content: '' };

  const separator = text.match(/\s*\|\s*|\s*:\s*/);
  if (separator) {
    const index = separator.index;
    const sepLength = separator[0].length;
    const title = normalizePlanningText(text.slice(0, index));
    const content = normalizePlanningText(text.slice(index + sepLength));
    return { title, content };
  }

  return { title: normalizePlanningText(text), content: '' };
}

function stripPlanningMarkdown(raw = '') {
  return String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[_*#>~-]/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function countPlanningListItems(raw = '') {
  return String(raw || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^(\d+\.|[-*•])\s+/.test(line)).length;
}

function hasPlanningKeywords(raw = '') {
  const text = stripPlanningMarkdown(raw).toLowerCase();
  const keywords = [
    'rencana', 'plan', 'planning', 'langkah', 'tahap', 'tahapan', 'roadmap', 'prioritas',
    'jadwal', 'timeline', 'milestone', 'checklist', 'todo', 'to do', 'aksi', 'target',
    'deadline', 'eksekusi', 'strategi'
  ];
  return keywords.filter(keyword => text.includes(keyword)).length;
}

function isPlanningRequestText(raw = '') {
  const text = stripPlanningMarkdown(raw).toLowerCase();
  const phrases = [
    'buat rencana', 'bikin rencana', 'susun rencana', 'buat plan', 'bikin plan', 'susun plan',
    'rangkum rencana', 'ringkas rencana', 'jadikan rencana', 'ubah jadi rencana',
    'action plan', 'roadmap', 'langkah-langkah', 'langkah langkah', 'checklist', 'todo',
    'to do', 'prioritas', 'timeline', 'jadwal', 'tahapan', 'strategi'
  ];
  return phrases.some(phrase => text.includes(phrase));
}

function isPlanningLikeContent(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return false;

  const normalized = stripPlanningMarkdown(text).toLowerCase();
  const keywordHits = hasPlanningKeywords(text);
  const listItems = countPlanningListItems(text);
  const hasPlanningHeading = /^(#{1,3}|\*\*)\s*(rencana|plan|roadmap|langkah|prioritas|timeline|jadwal|checklist|tahapan)\b/im.test(text);
  const hasActionLanguage = /(langkah|tahap|prioritas|jadwal|target|deadline|milestone|aksi|eksekusi)/.test(normalized);

  return hasPlanningHeading
    || listItems >= 3
    || (listItems >= 2 && keywordHits >= 1)
    || (keywordHits >= 2 && hasActionLanguage);
}

function extractPlanningTitle(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return 'Rencana dari percakapan';

  const headingMatch = text.match(/^#{1,3}\s+(.+)$/m);
  if (headingMatch) {
    return normalizePlanningText(stripPlanningMarkdown(headingMatch[1])).slice(0, 80) || 'Rencana dari percakapan';
  }

  const boldMatch = text.match(/^\*\*([^*]+)\*\*/m);
  if (boldMatch) {
    return normalizePlanningText(stripPlanningMarkdown(boldMatch[1])).slice(0, 80) || 'Rencana dari percakapan';
  }

  const firstStructuredLine = text
    .split('\n')
    .map(line => line.trim())
    .find(line => /^(\d+\.|[-*•])\s+/.test(line));

  if (firstStructuredLine) {
    const lineTitle = normalizePlanningText(stripPlanningMarkdown(firstStructuredLine.replace(/^(\d+\.|[-*•])\s+/, '')));
    if (lineTitle) return lineTitle.slice(0, 80);
  }

  const fallback = normalizePlanningText(stripPlanningMarkdown(text)).slice(0, 60);
  return fallback ? `${fallback}${fallback.length >= 60 ? '...' : ''}` : 'Rencana dari percakapan';
}

function getPlanningContextCandidate() {
  const recentMessages = currentMessages.slice(-8);
  const lastAssistant = [...recentMessages].reverse().find(message =>
    message.role === 'assistant' && normalizePlanningText(message.content)
  );

  if (!lastAssistant) return null;

  const recentUserMessages = recentMessages
    .filter(message => message.role === 'user')
    .slice(-3);

  const assistantLooksLikePlan = isPlanningLikeContent(lastAssistant.content);
  const userAskedForPlan = recentUserMessages.some(message => isPlanningRequestText(message.content));

  if (!assistantLooksLikePlan && !userAskedForPlan) {
    return null;
  }

  return {
    title: extractPlanningTitle(lastAssistant.content),
    content: lastAssistant.content,
    sourceId: lastAssistant.id || null
  };
}

async function savePlanningItem(title, content) {
  return planningApi('/api/planning-memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: currentUser.id,
      title,
      content: content || ''
    })
  });
}

function parsePlanningCommand(rawText = '') {
  const text = normalizePlanningText(rawText);
  if (!text) return null;

  if (PLANNING_COMMAND_PATTERNS.list.test(text)) {
    return { type: 'list', query: text };
  }

  if (PLANNING_COMMAND_PATTERNS.save.test(text)) {
    const payload = text.replace(PLANNING_COMMAND_PATTERNS.save, '').trim();
    const parsed = splitTitleAndContent(payload);
    return { type: 'save', title: parsed.title, content: parsed.content };
  }

  if (PLANNING_COMMAND_PATTERNS.saveFromContext.test(text) || PLANNING_COMMAND_PATTERNS.saveFromContextAlt.test(text)) {
    return { type: 'saveFromContext' };
  }

  if (PLANNING_COMMAND_PATTERNS.delete.test(text)) {
    const title = normalizePlanningText(text.replace(PLANNING_COMMAND_PATTERNS.delete, ''));
    return { type: 'delete', title };
  }

  if (PLANNING_COMMAND_PATTERNS.update.test(text)) {
    const payload = text.replace(PLANNING_COMMAND_PATTERNS.update, '').trim();
    const [left = '', right = ''] = payload.split(/=>|->/);
    const title = normalizePlanningText(left);
    const next = splitTitleAndContent(right);
    return {
      type: 'update',
      title,
      nextTitle: next.title,
      nextContent: next.content
    };
  }

  return null;
}

async function planningApi(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request gagal (${res.status})`);
  }
  return data;
}

function buildPlanningRecapMarkdown(items = [], query = '') {
  const list = Array.isArray(items) ? items : [];
  const title = query
    ? '### Rencana Terkait Pertanyaanmu'
    : '### Rencana Kita';

  if (!list.length) {
    return `${title}\n\nBelum ada rencana yang tersimpan.`;
  }

  const isShortSummary = list.length <= 3;
  const summaryLabel = isShortSummary
    ? 'Ini ringkasan singkat agar kamu bisa cek cepat. Kalau perlu, minta detail penuh.'
    : 'Ini daftar rencana terbaru yang tersimpan.';

  const lines = list.map((item, idx) => {
    const name = normalizePlanningText(item.title || `Rencana ${idx + 1}`);
    const body = normalizePlanningText(item.content || 'Tanpa catatan tambahan');
    return `${idx + 1}. **${name}**\\n   - ${body}`;
  });

  return `${title}\n\n${summaryLabel}\n\n${lines.join('\n')}`;
}

function shouldAttachSaveSummary(content = '') {
  const text = String(content || '').trim();
  if (!text) return false;

  const lineCount = text.split('\n').map(line => line.trim()).filter(Boolean).length;
  const listCount = countPlanningListItems(text);
  return text.length > 220 || lineCount > 4 || listCount >= 3;
}

function buildInlinePlanSummary(content = '') {
  const text = String(content || '').trim();
  if (!text) return '';

  const lines = text.split('\n').map(line => normalizePlanningText(stripPlanningMarkdown(line))).filter(Boolean);
  const structuredLines = lines
    .filter(line => /^\d+\.|^[-*•]/.test(line) || /^(langkah|tahap|prioritas|aksi|target|jadwal|timeline)/i.test(line))
    .slice(0, 2)
    .map(line => line.replace(/^(\d+\.|[-*•])\s+/, ''));

  if (structuredLines.length) {
    return structuredLines.map((line, idx) => `${idx + 1}. ${line}`).join('\n');
  }

  const plain = normalizePlanningText(stripPlanningMarkdown(text));
  if (!plain) return '';
  return plain.length > 180 ? `${plain.slice(0, 180)}...` : plain;
}

function buildSaveConfirmationMessage(title, content = '') {
  const safeTitle = normalizePlanningText(title || 'Rencana tanpa judul');
  const shouldSummary = shouldAttachSaveSummary(content);
  const summary = shouldSummary ? buildInlinePlanSummary(content) : '';

  if (!summary) {
    return `Baik, sudah saya simpan rencananya: **${safeTitle}**. Kalau mau, nanti kita bisa rapikan lagi jadi versi yang lebih detail.`;
  }

  return [
    `Baik, sudah saya simpan rencananya: **${safeTitle}**.`,
    '',
    'Berikut ringkasan singkatnya supaya cepat dicek:',
    summary
  ].join('\n');
}

async function handlePlanningCommand(rawText) {
  const command = parsePlanningCommand(rawText);
  if (!command) return false;

  appendMessage('user', rawText);
  scrollBottom();

  try {
    if (command.type === 'list') {
      const data = await planningApi(`/api/planning-memory?user_id=${encodeURIComponent(currentUser.id)}`);
      appendMessage('assistant', buildPlanningRecapMarkdown(data.items || [], command.query));
      return true;
    }

    if (command.type === 'save') {
      if (!command.title) {
        const contextualCandidate = getPlanningContextCandidate();
        if (!contextualCandidate) {
          appendMessage('assistant', 'Aku belum melihat rencana yang jelas di konteks terakhir. Kalau memang mau simpan plan, minta aku buat atau rangkum rencana dulu, atau tulis langsung: **ingat ini Judul: isi rencana**.');
          return true;
        }

        const savedFromContext = await savePlanningItem(contextualCandidate.title, contextualCandidate.content);
        const finalTitle = savedFromContext.item?.title || contextualCandidate.title;
        appendMessage('assistant', buildSaveConfirmationMessage(finalTitle, contextualCandidate.content));
        return true;
      }

      const saved = await savePlanningItem(command.title, command.content || '');
      const finalTitle = saved.item?.title || command.title;
      appendMessage('assistant', buildSaveConfirmationMessage(finalTitle, command.content || ''));
      return true;
    }

    if (command.type === 'saveFromContext') {
      const contextualCandidate = getPlanningContextCandidate();
      if (!contextualCandidate) {
        appendMessage('assistant', 'Kalimat itu tidak kusimpan sebagai plan karena konteks terakhir bukan rencana. Kalau mau, suruh aku susun atau rangkum rencana dulu, lalu balas singkat: **catat ya**.');
        return true;
      }

      const saved = await savePlanningItem(contextualCandidate.title, contextualCandidate.content);
      const finalTitle = saved.item?.title || contextualCandidate.title;
      appendMessage('assistant', buildSaveConfirmationMessage(finalTitle, contextualCandidate.content));
      return true;
    }

    if (command.type === 'delete') {
      if (!command.title) {
        appendMessage('assistant', 'Format hapus: **hapus rencana <judul>**');
        return true;
      }

      const data = await planningApi(`/api/planning-memory?user_id=${encodeURIComponent(currentUser.id)}&q=${encodeURIComponent(command.title)}&limit=10`);
      const matches = (data.items || []).filter(item =>
        normalizePlanningText(item.title).toLowerCase() === command.title.toLowerCase()
      );
      const target = matches[0] || (data.items || [])[0];

      if (!target) {
        appendMessage('assistant', `Rencana dengan kata kunci "${command.title}" tidak ditemukan.`);
        return true;
      }

      const approved = await showConfirmMessage(
        `Rencana "${target.title}" akan dihapus permanen. Lanjutkan?`,
        'Hard Delete Rencana',
        'Ya, Hapus',
        'Batal'
      );

      if (!approved) {
        appendMessage('assistant', 'Penghapusan dibatalkan.');
        return true;
      }

      await planningApi(`/api/planning-memory/${encodeURIComponent(target.id)}?user_id=${encodeURIComponent(currentUser.id)}`, {
        method: 'DELETE'
      });

      appendMessage('assistant', `Siap, rencana **${target.title}** sudah saya hapus permanen. Kalau kamu mau, saya bisa bantu susun versi barunya sekarang supaya alurnya tetap rapi.`);
      return true;
    }

    if (command.type === 'update') {
      if (!command.title) {
        appendMessage('assistant', 'Format update: **update rencana <judul lama> => <judul baru>: <catatan baru>**');
        return true;
      }

      const search = await planningApi(`/api/planning-memory?user_id=${encodeURIComponent(currentUser.id)}&q=${encodeURIComponent(command.title)}&limit=10`);
      const target = (search.items || []).find(item =>
        normalizePlanningText(item.title).toLowerCase() === command.title.toLowerCase()
      ) || (search.items || [])[0];

      if (!target) {
        appendMessage('assistant', `Rencana "${command.title}" tidak ditemukan untuk update.`);
        return true;
      }

      const updatedTitle = command.nextTitle || target.title;
      const updatedContent = typeof command.nextContent === 'string' && command.nextContent.trim()
        ? command.nextContent
        : target.content;

      const updated = await planningApi(`/api/planning-memory/${encodeURIComponent(target.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser.id,
          title: updatedTitle,
          content: updatedContent
        })
      });

      appendMessage('assistant', `Rencana berhasil diupdate menjadi **${updated.item?.title || updatedTitle}**.`);
      return true;
    }
  } catch (error) {
    appendMessage('assistant', `Gagal memproses perintah rencana: ${error.message}`);
    return true;
  }

  return false;
}

// ── Inisialisasi suara TTS ──
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  speechSynthesis.getVoices();
}

function logDebug(msg, color = '#2a7a9e') {
  console.log(`%c[AAi] ${msg}`, `color:${color};font-weight:bold`);
}

function updateModeLabel() {
  const modeLabel = document.getElementById('modeLabel');
  if (!modeLabel) return;
  modeLabel.textContent = ''; // Model selection remains in Settings, never on the chat header.
}

function updateCompactStatus(forceValue = null) {
  const pill = document.getElementById('compactStatus');
  if (!pill) return;

  const shouldShow = forceValue === null
    ? Boolean(currentSessionMeta?.compact_checkpoint_at)
    : Boolean(forceValue);

  pill.classList.toggle('show', shouldShow);
}

function updateMobileSendVisibility(forceValue = null) {
  const mobileBtn = document.getElementById('mobileSendBtn');
  const messageInput = document.getElementById('messageInput');
  if (!mobileBtn || !messageInput) return;

  const hasDraft = Boolean(messageInput.value.trim() || selectedFiles.length);
  const shouldShow = forceValue === null
    ? (window.innerWidth <= 768 && (hasDraft || mobileBtn.classList.contains('stop-mode')))
    : Boolean(forceValue);

  mobileBtn.classList.toggle('show', shouldShow);
}

// ══════════════════════════════════════════
// TOMBOL SEND / STOP
// ══════════════════════════════════════════
function setSendBtn(mode) {
  const buttons = [
    document.getElementById('sendBtn'),
    document.getElementById('mobileSendBtn')
  ].filter(Boolean);

  if (mode === 'stop') {
    buttons.forEach(btn => {
      btn.innerHTML = '<i class="fas fa-stop" aria-hidden="true"></i>';
      btn.title = 'Hentikan respons';
      btn.setAttribute('aria-label', 'Hentikan respons');
      btn.classList.add('stop-mode');
      btn.onclick = () => {
        if (abortController) abortController.abort();
      };
    });
    updateMobileSendVisibility(true);
  } else {
    buttons.forEach(btn => {
      btn.innerHTML = '<i class="fas fa-arrow-up" aria-hidden="true"></i>';
      btn.title = 'Kirim pesan';
      btn.setAttribute('aria-label', 'Kirim pesan');
      btn.classList.remove('stop-mode');
      btn.onclick = handleSend;
    });
    updateMobileSendVisibility();
  }
}

// ══════════════════════════════════════════
// TTS (Text-to-Speech)
// ══════════════════════════════════════════
function speakText(btn, text) {
  if (isSpeaking) {
    speechSynthesis.cancel();
    isSpeaking = false;
    document.querySelectorAll('.tts-btn i').forEach(i => {
      i.className = 'fas fa-volume-up'; i.style.color = 'inherit';
    });
    return;
  }
  const clean = text
    .replace(/```[\s\S]*?```/g, 'blok kode')
    .replace(/`[^`]+`/g, '')
    .replace(/[#*_~>\[\]]/g, '')
    .replace(/https?:\/\/\S+/g, 'tautan')
    .trim();
  currentUtterance = new SpeechSynthesisUtterance(clean);
  currentUtterance.lang  = 'id-ID';
  currentUtterance.rate  = 0.95;
  currentUtterance.pitch = 1.3;
  const voices = speechSynthesis.getVoices();
  const v = voices.find(v => v.lang.startsWith('id') && (v.name.includes('Google') || v.name.includes('Gadis') || v.name.toLowerCase().includes('female')))
         || voices.find(v => v.lang.startsWith('id'))
         || voices.find(v => v.lang.startsWith('en'));
  if (v) currentUtterance.voice = v;
  const icon = btn.querySelector('i');
  icon.className = 'fas fa-stop-circle'; icon.style.color = '#e74c3c'; isSpeaking = true;
  currentUtterance.onend = currentUtterance.onerror = () => {
    isSpeaking = false; icon.className = 'fas fa-volume-up'; icon.style.color = 'inherit';
  };
  speechSynthesis.speak(currentUtterance);
}



function getMessageText() {
  const inp = document.getElementById('messageInput');
  let text = inp.value.trim();
  if (!text) return '';
  return text;
}

// ══════════════════════════════════════════
// SYNTAX HIGHLIGHTING — EXCEL FORMULA
// Menghighlight formula Excel dengan warna token berbeda
// ══════════════════════════════════════════
const EXCEL_FUNCTIONS = [
  'ABS','ACOS','ACOSH','ADDRESS','AND','AREAS','ASIN','ASINH','ATAN','ATAN2','ATANH',
  'AVERAGE','AVERAGEA','AVERAGEIF','AVERAGEIFS','BASE','CEILING','CELL','CHAR','CHOOSE',
  'CLEAN','CODE','COLUMN','COLUMNS','COMBIN','COMPLEX','CONCATENATE','CONCAT','COS','COSH',
  'COUNT','COUNTA','COUNTBLANK','COUNTIF','COUNTIFS','DATE','DATEVALUE','DAY','DAYS','DAYS360',
  'DB','DCOUNT','DDB','DELTA','DEVSQ','DGET','DMAX','DMIN','DPRODUCT','DSTDEV','DSUM',
  'DURATION','EDATE','EOMONTH','ERROR.TYPE','EXACT','EXP','FACT','FALSE','FILTER','FIND',
  'FLOOR','FORECAST','FV','FVSCHEDULE','GETPIVOTDATA','GROWTH','HLOOKUP','HOUR','HYPERLINK',
  'IF','IFERROR','IFNA','IFS','INDEX','INDIRECT','INFO','INT','INTERCEPT','IPMT','IRR','ISBLANK',
  'ISERR','ISERROR','ISEVEN','ISLOGICAL','ISNA','ISNONTEXT','ISNUMBER','ISODD','ISREF','ISTEXT',
  'LARGE','LEFT','LEN','LINEST','LN','LOG','LOG10','LOOKUP','LOWER','MATCH','MAX','MAXA','MAXIFS',
  'MEDIAN','MID','MIN','MINA','MINIFS','MINUTE','MIRR','MOD','MODE','MONTH','MROUND','N','NA',
  'NETWORKDAYS','NOT','NOW','NPER','NPV','NUMBERVALUE','ODD','OFFSET','OR','PERCENTILE',
  'PERCENTRANK','PERIOD','PI','PMT','PPMT','PRODUCT','PROPER','PV','QUARTILE','QUOTIENT',
  'RADIANS','RAND','RANDBETWEEN','RANK','RATE','REPLACE','REPT','RIGHT','ROMAN','ROUND',
  'ROUNDDOWN','ROUNDUP','ROW','ROWS','SEARCH','SECOND','SIGN','SIN','SINH','SLOPE','SMALL',
  'SORT','SORTBY','SQRT','STDEV','STDEVA','SUBSTITUTE','SUM','SUMIF','SUMIFS','SUMPRODUCT',
  'SWITCH','T','TAN','TANH','TEXT','TIME','TIMEVALUE','TODAY','TRANSPOSE','TRIM','TRUE',
  'TRUNC','TYPE','UNIQUE','UPPER','VALUE','VLOOKUP','WEEKDAY','WEEKNUM','WORKDAY','XIRR',
  'XLOOKUP','XMATCH','XNPV','YEAR','YEARFRAC'
].join('|');

function highlightExcel(rawText) {
  // Escape HTML dulu
  let s = rawText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 1. String "teks" → biru muda
  s = s.replace(/"([^"]*)"/g, '<span class="excel-str">"$1"</span>');

  // 2. Error Excel (#REF!, #N/A, #VALUE!, dll)
  s = s.replace(/#(REF!|N\/A|VALUE!|DIV\/0!|NULL!|NUM!|NAME\?|SPILL!|CALC!|GETTING_DATA)/g,
    '<span class="excel-error">#$1</span>');

  // 3. Nama Sheet diikuti tanda seru (Sheet1! atau 'My Sheet'!)
  s = s.replace(/('(?:[^']|'')*'|[A-Za-z_\u00C0-\u024F][A-Za-z0-9_\u00C0-\u024F]*)(!)/g,
    '<span class="excel-sheet">$1$2</span>');

  // 4. Fungsi Excel (sebelum tanda kurung)
  const fnRe = new RegExp('\\b(' + EXCEL_FUNCTIONS + ')(?=\\s*\\()', 'g');
  s = s.replace(fnRe, '<span class="excel-fn">$1</span>');

  // 5. TRUE / FALSE
  s = s.replace(/\b(TRUE|FALSE)\b/g, '<span class="excel-bool">$1</span>');

  // 6. Referensi sel: A1, $B$2, A1:C5, R1C1, dll
  s = s.replace(/\b(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)\b/g,
    '<span class="excel-ref">$1</span>');

  // 7. Angka
  s = s.replace(/(?<![a-zA-Z"])(-?\b\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?%?)\b/g,
    '<span class="excel-num">$1</span>');

  // 8. Operator = + - * / & ^ < > ,
  s = s.replace(/([=+\-*/&^<>,])/g, '<span class="excel-op">$1</span>');

  return s;
}

// ══════════════════════════════════════════
// AUTO-DETECT LANGUAGE
// ══════════════════════════════════════════
const LANG_DOTS = {
  javascript: '#f0db4f', python: '#3572A5', html: '#e34c26',
  css: '#563d7c', sql: '#e38c00', bash: '#89e051',
  java: '#b07219', 'c++': '#f34b7d', typescript: '#2b7489',
  excel: '#1d6f42', json: '#292929', xml: '#0060ac',
  php: '#4F5D95', ruby: '#701516', go: '#00ADD8',
  rust: '#dea584', swift: '#ffac45', kotlin: '#A97BFF',
  dart: '#00B4AB', shell: '#89e051', powershell: '#012456',
  yaml: '#cb171e', markdown: '#083fa1', code: '#8b949e'
};

function detectLanguage(code, hintLang) {
  const c = code.trim();

  // Jika ada hint dari fenced code block
  if (hintLang) {
    const h = hintLang.toLowerCase();
    if (h === 'excel' || h === 'xlsx' || h === 'formula') return 'excel';
    return h;
  }

  // Excel formula: dimulai dengan =FunctionName( atau =CellRef atau array formula {=
  if (/^[{]?=\s*[A-Z]/.test(c) || /^=\s*(SUM|IF|VLOOKUP|INDEX|MATCH|COUNTIF|SUMIF|AVERAGE|MAX|MIN|IFERROR|AND|OR|XLOOKUP|FILTER|SORT|UNIQUE|TEXT|DATE|NOW|TODAY)\s*\(/i.test(c)) {
    return 'excel';
  }
  // Jika banyak baris dimulai dengan =
  const lines = c.split('\n').filter(l => l.trim());
  if (lines.length > 0 && lines.filter(l => /^\s*=/.test(l)).length / lines.length > 0.5) {
    return 'excel';
  }

  // Gunakan hljs auto-detect jika tersedia
  if (typeof hljs !== 'undefined') {
    try {
      const result = hljs.highlightAuto(c, [
        'javascript','typescript','python','html','css','sql','bash','shell',
        'java','cpp','json','xml','yaml','php','ruby','go','rust','swift','kotlin','dart','powershell'
      ]);
      return result.language || 'code';
    } catch { return 'code'; }
  }
  return 'code';
}

function applyHighlight(code, lang) {
  if (lang === 'excel') return highlightExcel(code);
  if (typeof hljs === 'undefined') return escHtml(code);
  try {
    if (lang && lang !== 'code' && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return escHtml(code);
  }
}

// ══════════════════════════════════════════
// HELPER: buat HTML bubble AI saat streaming
// ══════════════════════════════════════════
function titleCaseModelToken(token = '') {
  if (!token) return '';
  if (/^[a-z]{2,4}$/i.test(token)) return token.toUpperCase();
  if (/^[0-9]+[a-z]+$/i.test(token)) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function normalizeAssistantModelLabel(modelName = '', explicitLabel = '') {
  const preferredLabel = String(explicitLabel || '').trim();
  if (preferredLabel) return preferredLabel;

  const normalized = String(modelName || '').trim();
  if (!normalized) return '';

  const shortName = normalized.split('/').pop()?.replace(/:.*$/, '') || normalized;
  return shortName
    .split(/[-_]+/)
    .filter(Boolean)
    .map(titleCaseModelToken)
    .join(' ');
}

function buildAssistantHeaderHTML(versionHtml) {
  return `
    <div style="display:flex;align-items:center;gap:10px;">
      <div class="avatar"><img src="/aai-mascot-studio.png" alt="AAi"></div>
      <div style="font-weight:800;font-size:15px;color:var(--blue-dark);font-family:'Plus Jakarta Sans',sans-serif;">
        AAi ${versionHtml}
      </div>
    </div>`;
}
// Internal model metadata stays available for diagnostics, never shown as a chat byline.
function applyAssistantModelMeta(row, modelName = '', modelLabel = '') {
  if (!row) return;
  row.setAttribute('data-model', String(modelName || '').trim());
  row.setAttribute('data-model-label', String(modelLabel || '').trim());
}

const AAI_ACTIVITY_STORE_KEY = 'aai_activity_trails_v1';

function getStoredActivityTraces() {
  try {
    const raw = JSON.parse(localStorage.getItem(AAI_ACTIVITY_STORE_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

function formatActivityDuration(ms) {
  const seconds = Math.max(1, Math.round(Number(ms || 0) / 1000));
  return seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
}

function saveActivityTrace(messageId, durationMs, steps, preface = '') {
  if (!messageId || !Array.isArray(steps) || !steps.length) return;
  try {
    const traces = getStoredActivityTraces();
    traces[messageId] = { durationMs: Math.max(0, Number(durationMs) || 0), steps: steps.slice(-18), preface: String(preface).slice(0, 240), savedAt: Date.now() };
    const latest = Object.entries(traces).sort((left, right) => (right[1]?.savedAt || 0) - (left[1]?.savedAt || 0)).slice(0, 80);
    localStorage.setItem(AAI_ACTIVITY_STORE_KEY, JSON.stringify(Object.fromEntries(latest)));
  } catch { /* Storage may be disabled; live activity still works. */ }
}

const AAI_ACTIVITY_STEP_ICONS = Object.freeze({
  memory: 'fa-brain',
  assess: 'fa-lightbulb',
  strategy: 'fa-compass',
  tavily: 'fa-search',
  exa: 'fa-globe',
  found: 'fa-book-open',
  unavailable: 'fa-exclamation-circle',
  compose: 'fa-feather-alt'
});

function renderActivitySourceHTML(source) {
  const parsed = parsePublicSourceUrl(source?.url);
  if (!parsed) return '';
  const hostname = parsed.hostname.replace(/^www\./i, '');
  const title = String(source?.title || hostname).replace(/\s+/g, ' ').trim().slice(0, 100);
  // Only the public source hostname is sent to the favicon service.
  const favicon = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostname) + '&sz=32';
  return '<a class="aai-activity-source-link" href="' + escHtml(parsed.href) + '" target="_blank" rel="noopener noreferrer nofollow">'
    + '<span class="aai-activity-source-icon" aria-hidden="true"><i class="fas fa-globe"></i>'
    + '<img class="aai-activity-source-favicon" data-aai-favicon src="' + escHtml(favicon) + '" alt="" width="16" height="16" loading="lazy" referrerpolicy="no-referrer"></span>'
    + '<span class="aai-activity-source-title">' + escHtml(title) + '</span>'
    + '<span class="aai-activity-source-arrow" aria-hidden="true">↗</span></a>';
}

function parsePublicSourceUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    const hostname = parsed.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(parsed.protocol)
      || !hostname
      || hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.local')
      || /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/i.test(hostname)) return null;
    return parsed;
  } catch { return null; }
}

function collectActivitySources(activityTrace) {
  const steps = Array.isArray(activityTrace?.steps) ? activityTrace.steps : [];
  const seen = new Set();
  const sources = [];
  for (const step of steps) {
    if (step?.step !== 'sources' || !Array.isArray(step.sources)) continue;
    for (const source of step.sources) {
      const parsed = parsePublicSourceUrl(source?.url);
      if (!parsed || seen.has(parsed.href)) continue;
      seen.add(parsed.href);
      sources.push({ ...source, url: parsed.href });
      if (sources.length >= 5) return sources;
    }
  }
  return sources;
}

function renderMessageSourceCardHTML(source) {
  const parsed = parsePublicSourceUrl(source?.url);
  if (!parsed) return '';
  const hostname = parsed.hostname.replace(/^www\./i, '');
  const title = String(source?.title || hostname).replace(/\s+/g, ' ').trim().slice(0, 140);
  const snippet = String(source?.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const image = parsePublicSourceUrl(source?.image);
  const favicon = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostname) + '&sz=32';
  const thumbnailHtml = image
    ? '<img class="aai-source-thumb" data-source-image src="' + escHtml(image.href) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
    : '<span class="aai-source-thumb-placeholder" aria-hidden="true"><i class="fas fa-newspaper"></i></span>';
  const cardState = image ? 'has-thumbnail' : 'has-placeholder';
  return '<a class="aai-source-card ' + cardState + '" href="' + escHtml(parsed.href) + '" target="_blank" rel="noopener noreferrer nofollow">'
    + thumbnailHtml
    + '<span class="aai-source-card-content">'
    + '<span class="aai-source-card-heading">'
    + '<span class="aai-source-favicon-wrap" aria-hidden="true"><i class="fas fa-globe"></i>'
    + '<img class="aai-source-favicon" data-aai-favicon src="' + escHtml(favicon) + '" alt="" width="18" height="18" loading="lazy" referrerpolicy="no-referrer"></span>'
    + '<span class="aai-source-card-title">' + escHtml(title) + '</span>'
    + '<i class="fas fa-arrow-up-right-from-square aai-source-card-arrow" aria-hidden="true"></i>'
    + '</span>'
    + (snippet ? '<span class="aai-source-card-snippet">' + escHtml(snippet) + '</span>' : '')
    + '<span class="aai-source-card-domain">' + escHtml(hostname) + '</span>'
    + '</span></a>';
}

function buildMessageSourcePreviewHTML(activityTrace) {
  const cards = collectActivitySources(activityTrace)
    .map(renderMessageSourceCardHTML).filter(Boolean).join('');
  if (!cards) return '';
  return '<section class="aai-source-preview" aria-label="Sumber yang ditemukan">'
    + '<div class="aai-source-preview-heading">Sumber yang ditemukan</div>'
    + '<div class="aai-source-preview-list">' + cards + '</div>'
    + '</section>';
}

function wireSourcePreviewImages(root = document) {
  root.querySelectorAll('.aai-source-thumb[data-source-image]').forEach(image => {
    if (image.dataset.fallbackBound) return;
    image.dataset.fallbackBound = '1';
    image.addEventListener('error', () => {
      const card = image.closest('.aai-source-card');
      const placeholder = document.createElement('span');
      placeholder.className = 'aai-source-thumb-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      const icon = document.createElement('i');
      icon.className = 'fas fa-newspaper';
      placeholder.appendChild(icon);
      image.replaceWith(placeholder);
      card?.classList.remove('has-thumbnail');
      card?.classList.add('has-placeholder');
    }, { once: true });
  });
  root.querySelectorAll('img[data-aai-favicon]').forEach(image => {
    if (image.dataset.fallbackBound) return;
    image.dataset.fallbackBound = '1';
    image.addEventListener('error', () => {
      image.hidden = true;
    }, { once: true });
  });
}

function renderActivityStepHTML(entry) {
  const step = entry && typeof entry === 'object' ? entry.step : '';
  const message = entry && typeof entry === 'object' ? entry.message : entry;
  // Older saved activity traces may still name a backend search provider.
  const displayMessage = step === 'tavily' ? 'Mencari sumber dari web...'
    : step === 'exa' ? 'Hasil awal belum cukup; mencari sumber lain...' : message;
  const safeText = escHtml(String(displayMessage || '').slice(0, 220));
  const sourceLinks = Array.isArray(entry?.sources)
    ? entry.sources.slice(0, 5).map(renderActivitySourceHTML).filter(Boolean).join('')
    : '';
  // Model-authored reports are conversation, not mechanical tool status.
  // Apply this to saved traces too so past sessions get the same presentation.
  if (step === 'strategy') {
    return '<li class="aai-activity-step aai-activity-report"><span class="aai-activity-step-text">' + safeText + '</span></li>';
  }
  if (step === 'sources') {
    const icon = AAI_ACTIVITY_STEP_ICONS[step] || 'fa-book-open';
    const milestone = '<li class="aai-activity-step"><span class="aai-activity-step-icon" aria-hidden="true"><i class="fas ' + icon + '"></i></span>'
      + '<span class="aai-activity-step-text">' + safeText + '</span></li>';
    const links = sourceLinks
      ? '<li class="aai-activity-sources"><div class="aai-activity-source-links">' + sourceLinks + '</div></li>'
      : '';
    return milestone + links;
  }
  const icon = AAI_ACTIVITY_STEP_ICONS[step] || 'fa-circle';
  return '<li class="aai-activity-step"><span class="aai-activity-step-icon" aria-hidden="true"><i class="fas ' + icon + '"></i></span>'
    + '<span class="aai-activity-step-text">' + safeText + '</span></li>';
}

function buildStoredActivityPanelHTML(messageId, persistedTrace = null) {
  if (!messageId) return '';
  // Server-saved steps travel with the session across browsers and phones.
  // Older conversations can still use their device-local traces.
  const trace = persistedTrace && typeof persistedTrace === 'object'
    && Array.isArray(persistedTrace.steps) && persistedTrace.steps.length
    ? persistedTrace : getStoredActivityTraces()[messageId];
  if (!trace || !Array.isArray(trace.steps) || !trace.steps.length) return '';
  const label = 'Memproses selama ' + formatActivityDuration(trace.durationMs);
  const intro = typeof trace.preface === 'string' && trace.preface.trim()
    ? '<p class="aai-preface">' + escHtml(trace.preface) + '</p>'
    : '';
  return `<details class="aai-activity is-complete aai-saved-activity">
    <summary><span class="aai-activity-title">${escHtml(label)}</span><i class="fas fa-chevron-down" aria-hidden="true"></i></summary>
    ${intro}
    <ul class="aai-activity-list">${trace.steps.map(renderActivityStepHTML).join('')}</ul>
  </details>`;
}

function buildStreamBubbleHTML(streamId, timeStr) {
  const previewPanelHtml = REASONING_PREVIEW_ENABLED
    ? `<div class="ai-preview" id="preview_${streamId}" style="display:none;">
        <button type="button" class="ai-preview-toggle" onclick="togglePreview(this)">
          <span class="ai-preview-summary-title">🧠 AAI sedang berpikir</span>
          <i class="fas fa-chevron-down ai-preview-chevron"></i>
        </button>
        <div class="ai-preview-body" id="preview_body_${streamId}"></div>
      </div>`
    : '';
  const teaserHtml = REASONING_PREVIEW_ENABLED
    ? `<div class="ai-live-teaser" id="preview_stream_${streamId}" style="display:none;"></div>`
    : '';
  const activityHtml = `<details class="aai-activity" id="activity_${streamId}" data-started-at="${Date.now()}" hidden>
    <summary><span class="aai-activity-title">Memproses...</span><i class="fas fa-chevron-down" aria-hidden="true"></i></summary>
    <p class="aai-preface" id="preface_${streamId}" hidden></p>
    <ul class="aai-activity-list" id="activity_list_${streamId}"></ul>
  </details>`;

  return `
    <div class="msg-row assistant" id="${streamId}" data-chat-date="${getChatMessageDate().key}" data-id="" data-plain-text="" data-persona="" data-model="" data-model-label="">
      ${buildAssistantHeaderHTML('')}
      ${previewPanelHtml}
      ${teaserHtml}
      ${activityHtml}
      <div class="bubble stream-cursor" id="bubble_${streamId}">
        <div style="display:flex;gap:5px;align-items:center;padding:6px 0;opacity:0.8;">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
      <div class="msg-actions" id="actions_${streamId}" style="display:none;">
        <button title="Copy" onclick="copyFullAI(this)"><i class="far fa-copy"></i></button>
        <button title="Ulangi" onclick="regenerateAI(this)"><i class="fas fa-sync-alt"></i></button>
        <button class="tts-btn" title="Dengarkan"
          onclick="speakText(this, decodeURIComponent(this.closest('.msg-row').dataset.plainText))">
          <i class="fas fa-volume-up"></i>
        </button>
        <span style="font-size:11px;opacity:.65;">${timeStr}</span>
      </div>
    </div>`;
}

function normalizeAssistantRowLayout(aiRow) {
  let actionsEl = aiRow.querySelector('.msg-actions');
  if (actionsEl && actionsEl.parentElement !== aiRow) {
    aiRow.appendChild(actionsEl);
  }

  let directActionsEl = Array.from(aiRow.children)
    .find(child => child.classList && child.classList.contains('msg-actions')) || actionsEl;
  const directSourcesEl = Array.from(aiRow.children)
    .find(child => child.classList && child.classList.contains('sources-container')) || null;

  let bubbleEl = aiRow.querySelector('.bubble');
  if (bubbleEl && bubbleEl.parentElement !== aiRow) {
    aiRow.insertBefore(bubbleEl, directSourcesEl || directActionsEl || null);
  }
  bubbleEl = Array.from(aiRow.children)
    .find(child => child.classList && child.classList.contains('bubble')) || bubbleEl;

  const previewEl = aiRow.querySelector('.ai-preview');
  if (previewEl) {
    aiRow.insertBefore(previewEl, bubbleEl || directSourcesEl || directActionsEl || null);
  }

  const teaserEl = aiRow.querySelector('.ai-live-teaser');
  if (teaserEl) {
    aiRow.insertBefore(teaserEl, bubbleEl || directSourcesEl || directActionsEl || null);
  }

  directActionsEl = Array.from(aiRow.children)
    .find(child => child.classList && child.classList.contains('msg-actions')) || actionsEl;
  if (directActionsEl && directActionsEl !== aiRow.lastElementChild) {
    aiRow.appendChild(directActionsEl);
  }

  return {
    bubbleEl,
    actionsEl: directActionsEl
  };
}

function prepareAssistantRowForStreaming(aiRow, streamId) {
  const { bubbleEl, actionsEl } = normalizeAssistantRowLayout(aiRow);
  if (!bubbleEl || !actionsEl) return null;

  aiRow.id = streamId;
  bubbleEl.id = `bubble_${streamId}`;
  actionsEl.id = `actions_${streamId}`;
  actionsEl.style.display = 'none';
  bubbleEl.classList.add('stream-cursor');
  bubbleEl.innerHTML = `
    <div style="display:flex;gap:5px;align-items:center;padding:6px 0;opacity:0.8;">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>`;

  let previewEl = aiRow.querySelector('.ai-preview');
  let teaserEl = aiRow.querySelector('.ai-live-teaser');
  if (REASONING_PREVIEW_ENABLED) {
    if (!previewEl) {
      previewEl = document.createElement('div');
      previewEl.className = 'ai-preview';
      previewEl.innerHTML = `
        <button type="button" class="ai-preview-toggle" onclick="togglePreview(this)">
          <span class="ai-preview-summary-title">🧠 AAI sedang berpikir</span>
          <i class="fas fa-chevron-down ai-preview-chevron"></i>
        </button>
        <div class="ai-preview-body"></div>`;
    }
    aiRow.insertBefore(previewEl, bubbleEl);
    previewEl.id = `preview_${streamId}`;
    previewEl.style.display = 'none';
    previewEl.classList.remove('is-open');
    const previewTitleEl = previewEl.querySelector('.ai-preview-summary-title');
    if (previewTitleEl) {
      previewTitleEl.textContent = '🧠 AAI sedang berpikir';
    }
    if (!teaserEl) {
      teaserEl = document.createElement('div');
      teaserEl.className = 'ai-live-teaser';
    }
    aiRow.insertBefore(teaserEl, bubbleEl);
    const bodyEl = previewEl.querySelector('.ai-preview-body');
    if (teaserEl) {
      teaserEl.id = `preview_stream_${streamId}`;
      teaserEl.innerHTML = '';
      teaserEl.style.display = 'none';
    }
    if (bodyEl) {
      bodyEl.id = `preview_body_${streamId}`;
      bodyEl.innerHTML = '';
    }
  } else {
    previewEl?.remove();
    teaserEl?.remove();
  }
  aiRow.setAttribute('data-plain-text', '');
  aiRow.setAttribute('data-preview', '');
  return { bubbleEl, actionsEl };
}

function ensureStreamingMarkdownNode(bubbleEl) {
  if (!bubbleEl) return null;

  let root = bubbleEl.querySelector('.aai-streaming-markdown[data-stream-live="true"]');
  if (root) return root;

  // Keep completed blocks mounted. Only the unfinished tail is re-rendered.
  bubbleEl.textContent = '';
  root = document.createElement('div');
  root.className = 'aai-streaming-markdown';
  root.setAttribute('data-stream-live', 'true');
  root.innerHTML = '<div class="aai-streaming-committed"></div><div class="aai-streaming-live"></div>';
  bubbleEl.appendChild(root);
  return root;
}

// Blank lines end stable Markdown blocks; never split an open fenced code block.
function findStableStreamMarkdownBoundary(text) {
  let boundary = 0;
  let fence = '';
  let fenceWidth = 0;
  let lineStart = 0;
  while (lineStart < text.length) {
    const newline = text.indexOf('\n', lineStart);
    if (newline < 0) break;
    const line = text.slice(lineStart, newline).replace(/\r$/, '');
    const marker = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
    if (marker) {
      const kind = marker[1][0];
      if (!fence) {
        fence = kind;
        fenceWidth = marker[1].length;
      } else if (kind === fence && marker[1].length >= fenceWidth && !marker[2].trim()) {
        fence = '';
      }
    }
    if (!fence && !line.trim()) boundary = newline + 1;
    lineStart = newline + 1;
  }
  return boundary;
}

function safeDecodeURIComponent(input = '') {
  try {
    return decodeURIComponent(String(input || '').trim());
  } catch {
    return String(input || '').trim();
  }
}

function extractFriendSuggestionTags(rawText = '') {
  const text = String(rawText || '');
  const suggestions = [];

  const cleanText = text.replace(/\[SUGGEST-FRIEND:([\s\S]*?)\]/gi, (_, payloadRaw) => {
    const payload = String(payloadRaw || '');
    const nameMatch = /\bname\s*=\s*([^;\]]+)/i.exec(payload);
    const introMatch = /\bintro_msg\s*=\s*([^;\]]+)/i.exec(payload);

    if (nameMatch) {
      const name = safeDecodeURIComponent(nameMatch[1]);
      const intro = introMatch ? safeDecodeURIComponent(introMatch[1]) : '';
      if (name) suggestions.push({ name, intro });
    }

    return '';
  });

  return {
    cleanText: cleanText
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd(),
    suggestions
  };
}

function togglePreview(btn) {
  if (!REASONING_PREVIEW_ENABLED) return;
  const panel = btn.closest('.ai-preview');
  if (!panel) return;
  panel.classList.toggle('is-open');
}

function getFriendlyProviderErrorMessage(rawMessage) {
  const msg = String(rawMessage || 'Terjadi kesalahan saat memproses respons AI.');
  const normalized = msg.toLowerCase();

  const isRateLimited =
    normalized.includes('429') ||
    normalized.includes('rate-limited') ||
    normalized.includes('temporarily rate-limited') ||
    normalized.includes('provider returned error');

  if (isRateLimited) {
    return 'OpenRouter sedang padat (limit sementara). Coba lagi dalam 20-60 detik.';
  }

  return msg;
}

function renderStreamErrorUI(streamId, errorMessage, retryMeta = null) {
  const bubbleEl = document.getElementById(`bubble_${streamId}`);
  if (!bubbleEl) return;

  bubbleEl.classList.remove('stream-cursor');
  const friendly = getFriendlyProviderErrorMessage(errorMessage);
  bubbleEl.innerHTML = `
    <span style="color:#e74c3c;">⚠️ ${escHtml(friendly)}</span>
    <button onclick="retryLastMessage(this)"
      style="margin-left:12px;background:var(--blue-light);border:none;padding:6px 12px;
             border-radius:12px;cursor:pointer;font-size:13px;color:var(--blue-dark);display:flex;align-items:center;gap:6px;">
      <i class="fas fa-sync"></i> Coba lagi
    </button>`;

  const actionsEl = document.getElementById(`actions_${streamId}`);
  if (actionsEl) actionsEl.style.display = 'flex';

  const aiRow = bubbleEl.closest('.msg-row.assistant');
  if (!aiRow || !retryMeta) return;

  const sessionId = retryMeta.session_id || retryMeta.sessionId || null;
  const userMessageId = retryMeta.user_message_id || retryMeta.userMessageId || null;

  if (sessionId) {
    aiRow.setAttribute('data-retry-session-id', sessionId);
    persistCurrentSession(sessionId, {
      title: sessions.find(session => session.id === sessionId)?.title || buildTopicSessionTitle(getLastUserPromptText()),
      makeFirst: !sessions.some(session => session.id === sessionId),
      refreshSidebar: !sessions.some(session => session.id === sessionId)
    });
  }

  if (userMessageId) {
    aiRow.setAttribute('data-retry-user-message-id', userMessageId);
    let prev = aiRow.previousElementSibling;
    while (prev) {
      if (prev.classList.contains('user')) {
        if (!(prev.getAttribute('data-id') || '').trim()) {
          prev.setAttribute('data-id', userMessageId);
        }
        break;
      }
      prev = prev.previousElementSibling;
    }
  }
}

function clearFileJobPoller(jobId) {
  const timer = pendingFileJobPollers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    pendingFileJobPollers.delete(jobId);
  }
}

function updateAssistantMessageContent(messageId, content) {
  if (!messageId) return;

  const normalizedContent = String(content || '').trim();
  const current = currentMessages.find(message => message.id === messageId);
  if (current) current.content = normalizedContent;

  const row = document.querySelector(`.msg-row.assistant[data-id="${messageId}"]`);
  if (!row) return;

  const bubble = row.querySelector('.bubble');
  if (bubble) {
    bubble.classList.remove('stream-cursor');
    bubble.innerHTML = formatContent(normalizedContent);
    wireSourcePreviewImages(row);
  }

  row.setAttribute('data-plain-text', encodeURIComponent(normalizedContent));
}

async function fetchFileJobStatus(jobId) {
  const res = await fetch(`/api/file-jobs?job_id=${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function triggerFileJobProcessing(jobId) {
  const res = await fetch('/api/file-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId })
  });

  if (!res.ok && res.status !== 500) {
    throw new Error(`HTTP ${res.status}`);
  }

  return res.json().catch(() => null);
}

function scheduleFileJobPoll(jobId, messageId, attempt = 0) {
  clearFileJobPoller(jobId);

  const delay = attempt < 5 ? 1500 : 3000;
  const timer = setTimeout(async () => {
    try {
      const payload = await fetchFileJobStatus(jobId);
      const job = payload?.job;
      if (!job) throw new Error('Job payload kosong');

      if (job.status === 'ready' || job.status === 'failed') {
        clearFileJobPoller(jobId);
        if (job.content) {
          updateAssistantMessageContent(messageId || job.message_id, job.content);
        }
        return;
      }

      scheduleFileJobPoll(jobId, messageId || job.message_id, attempt + 1);
    } catch (error) {
      console.error('[FileJobPoll] Error:', error.message);
      if (attempt < 8) {
        scheduleFileJobPoll(jobId, messageId, attempt + 1);
      } else {
        clearFileJobPoller(jobId);
      }
    }
  }, delay);

  pendingFileJobPollers.set(jobId, timer);
}

function startFileJobLifecycle(job, messageId = null) {
  const jobId = job?.id;
  if (!jobId) return;
  if (pendingFileJobPollers.has(jobId)) return;

  triggerFileJobProcessing(jobId)
    .catch(error => console.error('[FileJob] Trigger error:', error.message));

  scheduleFileJobPoll(jobId, messageId || job.message_id || null, 0);
}

async function resumePendingFileJobsForCurrentSession() {
  if (!currentSessionId) return;

  try {
    const res = await fetch(`/api/file-jobs?session_id=${encodeURIComponent(currentSessionId)}&active_only=true`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    for (const job of jobs) {
      startFileJobLifecycle(job, job.message_id || null);
    }
  } catch (error) {
    console.error('[FileJobResume] Error:', error.message);
  }
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function buildLegacyReasoningSteps(preview = {}) {
  const steps = [];
  const interpretasi = String(preview?.interpretasi || '').trim();
  const usedContext = asArray(preview?.checklist_konteks?.dipakai).slice(0, 1);
  const missingContext = asArray(preview?.checklist_konteks?.kurang).slice(0, 1);
  const potentials = asArray(preview?.potensi_ambigu).slice(0, 1);
  const assumptions = asArray(preview?.asumsi).slice(0, 1);

  if (interpretasi) steps.push(interpretasi);
  if (usedContext.length) steps.push(`Aku sempat memakai konteks ini saat membaca pesan: ${usedContext[0]}`);
  if (potentials.length) steps.push(`Ada bagian yang sempat kubaca hati-hati: ${potentials[0]}`);
  if (assumptions.length) steps.push(`Tanpa detail tambahan, sementara aku berpegangan pada ini: ${assumptions[0]}`);
  if (missingContext.length) steps.push(`Kalau mau lebih presisi, bagian ini tadinya masih kurang jelas: ${missingContext[0]}`);

  return [...new Set(steps.map(step => String(step || '').trim()).filter(Boolean))].slice(0, 5);
}

function normalizePreview(preview) {
  if (Array.isArray(preview)) {
    const reasoningSteps = asArray(preview).map(step => String(step || '').trim()).filter(Boolean);
    if (!reasoningSteps.length) return null;
    return {
      title: 'AAI',
      streaming_title: 'AAI sedang berpikir',
      reasoning_steps: reasoningSteps
    };
  }

  if (!preview || typeof preview !== 'object') return null;
  const explicitSteps = asArray(preview.reasoning_steps).map(step => String(step || '').trim()).filter(Boolean);
  const reasoningSteps = explicitSteps.length ? explicitSteps : buildLegacyReasoningSteps(preview);
  if (!reasoningSteps.length) return null;

  return {
    title: String(preview.title || 'AAI').trim() || 'AAI',
    streaming_title: String(preview.streaming_title || 'AAI sedang berpikir').trim() || 'AAI sedang berpikir',
    reasoning_steps: reasoningSteps
  };
}

function toTeaserSnippet(text, maxWords = 8) {
  const words = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (!words.length) return '';

  return `${words.slice(0, maxWords).join(' ')}...`;
}

function renderPreviewList(items, fallbackText) {
  if (!items.length) return `<ul><li>${escHtml(fallbackText)}</li></ul>`;
  return `<ul>${items.map(item => `<li>${escHtml(String(item))}</li>`).join('')}</ul>`;
}

function renderPreviewBody(preview) {
  const data = normalizePreview(preview);
  if (!data) return '';
  const reasoningItems = data.reasoning_steps.length
    ? data.reasoning_steps
    : ['AAI sedang merangkai jawaban dari konteks yang tersedia.'];

  return `
    <div class="ai-preview-block">
      <div class="ai-preview-block-title">Yang dipikirkan AAI</div>
      <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;color:var(--text);">
        ${reasoningItems.map(step => `<li style="margin-bottom:8px;">${escHtml(String(step))}</li>`).join('')}
      </ol>
    </div>`;
}

function buildPreviewPanelHTML(preview, isOpen = false) {
  if (!REASONING_PREVIEW_ENABLED) return '';
  const normalized = normalizePreview(preview);
  if (!normalized) return '';

  return `
    <div class="ai-preview${isOpen ? ' is-open' : ''}">
      <button type="button" class="ai-preview-toggle" onclick="togglePreview(this)">
        <span class="ai-preview-summary-title">🧠 ${escHtml(normalized.title || 'AAI')}</span>
        <i class="fas fa-chevron-down ai-preview-chevron"></i>
      </button>
      <div class="ai-preview-body">${renderPreviewBody(normalized)}</div>
    </div>`;
}

function buildPreviewTeaserQueue(preview) {
  const data = normalizePreview(preview);
  if (!data) return [];

  return data.reasoning_steps
    .map(item => toTeaserSnippet(item, 12))
    .filter(Boolean)
    .slice(0, 8);
}

function buildHistoryPreviewTeaser(preview) {
  return buildPreviewTeaserQueue(preview)[0] || 'Ringkasan siap...';
}

async function ensureSessionVisibleInSidebar(sessionId) {
  const normalizedId = String(sessionId || '').trim();
  if (!normalizedId) return false;

  const updateTitle = session => {
    document.getElementById('topbarTitle').textContent = session?.title || 'AAi';
    return true;
  };

  const existing = sessions.find(item => item.id === normalizedId);
  if (existing) return updateTitle(existing);

  await loadSessions();

  const refreshed = sessions.find(item => item.id === normalizedId);
  if (refreshed) return updateTitle(refreshed);

  const optimistic = upsertSessionSnapshot({
    id: normalizedId,
    title: buildTopicSessionTitle(getLastUserPromptText()),
    updated_at: new Date().toISOString()
  }, { makeFirst: true });

  if (optimistic) {
    if (currentSessionId === normalizedId) {
      currentSessionMeta = optimistic;
      updateCompactStatus();
    }
    renderSidebar();
    return updateTitle(optimistic);
  }

  return false;
}

// ══════════════════════════════════════════
// HELPER: proses stream SSE
// ══════════════════════════════════════════
async function processStream(response, streamId, onDone) {
  const bubbleEl  = document.getElementById(`bubble_${streamId}`);
  const actionsEl = document.getElementById(`actions_${streamId}`);
  const streamRow = document.getElementById(streamId);
  const previewEl = document.getElementById(`preview_${streamId}`);
  const previewBodyEl = document.getElementById(`preview_body_${streamId}`);
  const previewStreamEl = document.getElementById(`preview_stream_${streamId}`);
  const activityEl = document.getElementById(`activity_${streamId}`);
  const activityListEl = document.getElementById(`activity_list_${streamId}`);
  const activityTitleEl = activityEl?.querySelector('.aai-activity-title');
  const prefaceEl = document.getElementById(`preface_${streamId}`);
  const activityStartedAt = Number(activityEl?.dataset.startedAt) || Date.now();
  const activityTimeline = [];
  let activityTimer = null;
  const updateActivityClock = (completed = false) => {
    if (!activityTitleEl) return;
    const duration = formatActivityDuration(Date.now() - activityStartedAt);
    activityTitleEl.textContent = completed ? 'Memproses selama ' + duration : 'Memproses... ' + duration;
  };
  const reader    = response.body.getReader();
  const decoder   = new TextDecoder();
  let fullText  = '';
  let buffer    = '';
  let previewData = null;
  let previewTicker = null;
  let streamSessionId = null;
  let streamUserMessageId = null;
  let sessionSynced = false;
  let hasFriendSuggestionEvent = false;

  async function syncSessionFromStream(parsed) {
    if (!parsed?.session_id) return;
    streamSessionId = parsed.session_id;
    const knownSession = sessions.find(item => item.id === parsed.session_id) || null;
    const shouldRefreshTitle = !knownSession || isProvisionalSessionTitle(knownSession.title);
    const synced = persistCurrentSession(parsed.session_id, {
      title: parsed.session_title || (shouldRefreshTitle ? buildTopicSessionTitle(getLastUserPromptText()) : null),
      makeFirst: !knownSession,
      refreshSidebar: shouldRefreshTitle || !knownSession
    });

    if (synced || currentSessionId === parsed.session_id) {
      sessionSynced = true;
    }

    if (!knownSession) {
      void ensureSessionVisibleInSidebar(parsed.session_id);
    }
  }
  let previewStepTimer = null;
  let streamError = null;
  let firstToken = true;
  let gotDone   = false;
  let renderScheduled = false;
  let streamingNode = null;
  let streamingCommittedLength = 0;
  let renderTimer = null;
  let renderFrame = null;
  let lastRenderAt = 0;
  const STREAM_RENDER_INTERVAL_MS = 105;
  let streamScrollFrame = null;
  let lastStreamScrollAt = 0;
  const STREAM_SCROLL_INTERVAL_MS = 90;

  function clearStreamingRenderSchedule() {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    if (renderFrame) {
      cancelAnimationFrame(renderFrame);
      renderFrame = null;
    }
    renderScheduled = false;
  }

  function scheduleStreamScroll(force = false) {
    if (force) {
      if (streamScrollFrame) {
        cancelAnimationFrame(streamScrollFrame);
        streamScrollFrame = null;
      }
      lastStreamScrollAt = 0;
      scrollBottom(true);
      return;
    }

    const now = Date.now();
    if (now - lastStreamScrollAt < STREAM_SCROLL_INTERVAL_MS) return;
    if (streamScrollFrame) return;

    streamScrollFrame = requestAnimationFrame(() => {
      streamScrollFrame = null;
      lastStreamScrollAt = Date.now();
      scrollBottom();
    });
  }

  function clearPreviewAnimation() {
    if (previewTicker) {
      clearInterval(previewTicker);
      previewTicker = null;
    }
    if (previewStepTimer) {
      clearTimeout(previewStepTimer);
      previewStepTimer = null;
    }
  }

  function startPreviewTicker(lines) {
    if (!previewStreamEl) return;
    clearPreviewAnimation();

    const queue = Array.isArray(lines) ? lines.filter(Boolean) : [];
    if (!queue.length) {
      previewStreamEl.textContent = 'Sedang mengelola jawaban...';
      previewStreamEl.style.display = 'block';
      return;
    }

    let lineIndex = 0;
    previewStreamEl.style.display = 'block';

    function runLine() {
      if (!previewStreamEl) return;

      const teaserText = queue[lineIndex] || '';
      let charIndex = 0;
      previewStreamEl.textContent = '';

      previewTicker = setInterval(() => {
        if (charIndex < teaserText.length) {
          charIndex += 1;
          previewStreamEl.textContent = teaserText.slice(0, charIndex);
          return;
        }

        clearInterval(previewTicker);
        previewTicker = null;

        previewStepTimer = setTimeout(() => {
          if (!previewStreamEl) return;

          previewStreamEl.textContent = '';
          lineIndex += 1;

          if (lineIndex < queue.length) {
            previewStepTimer = setTimeout(runLine, 100);
          } else {
            previewStreamEl.textContent = 'Sedang mengelola jawaban...';
            previewStepTimer = null;
          }
        }, 420);
      }, 20);
    }

    runLine();
  }

  function stopPreviewTicker(finalText = '', hideTeaser = true) {
    clearPreviewAnimation();
    if (previewStreamEl) {
      previewStreamEl.textContent = finalText;
      if (hideTeaser) previewStreamEl.style.display = 'none';
    }
  }

  function setPreviewTitle(preview, isStreaming = false) {
    if (!previewEl) return;
    const titleEl = previewEl.querySelector('.ai-preview-summary-title');
    if (!titleEl) return;

    const normalized = normalizePreview(preview);
    const titleText = normalized
      ? (isStreaming ? normalized.streaming_title : normalized.title)
      : (isStreaming ? 'AAI sedang berpikir' : 'AAI');

    titleEl.textContent = `🧠 ${titleText}`;
  }

  function showPreview(preview, isStreaming = true) {
    if (!REASONING_PREVIEW_ENABLED) return;
    if (!previewEl || !previewBodyEl) return;
    const normalized = normalizePreview(preview);
    if (!normalized) return;
    previewData = normalized;
    previewBodyEl.innerHTML = renderPreviewBody(normalized);
    previewEl.style.display = 'block';
    previewEl.classList.remove('is-open');
    setPreviewTitle(normalized, isStreaming);
    startPreviewTicker(buildPreviewTeaserQueue(normalized));
    scrollBottom();
  }

  function flushStreamingRender(finalRender = false) {
    if (!bubbleEl) return;

    if (finalRender) {
      clearStreamingRenderSchedule();
      bubbleEl.innerHTML = formatContent(fullText);
      bubbleEl.classList.remove('stream-cursor');
      streamingNode = null;
      streamingCommittedLength = 0;
    } else {
      streamingNode = streamingNode || ensureStreamingMarkdownNode(bubbleEl);
      if (streamingNode) {
        const committedEl = streamingNode.querySelector('.aai-streaming-committed');
        const liveEl = streamingNode.querySelector('.aai-streaming-live');
        const pending = fullText.slice(streamingCommittedLength);
        const boundary = findStableStreamMarkdownBoundary(pending);
        if (boundary > 0 && committedEl) {
          committedEl.insertAdjacentHTML('beforeend', formatContent(pending.slice(0, boundary)));
          streamingCommittedLength += boundary;
        }
        if (liveEl) {
          const tailText = fullText.slice(streamingCommittedLength);
          // Lightweight, sanitized Markdown. No syntax highlighting per token.
          // Failure must never stop the SSE reader or lose the accumulated reply.
          try {
            liveEl.innerHTML = tailText ? formatContent(tailText, { streaming: true }) : '';
          } catch (error) {
            console.warn('[AAi stream] Markdown preview failed:', error);
            liveEl.textContent = tailText;
          }
        }
      }
      bubbleEl.classList.add('stream-cursor');
    }

    scheduleStreamScroll(finalRender);
  }

  function scheduleStreamingRender() {
    if (renderScheduled) return;

    const runRender = () => {
      renderScheduled = false;
      lastRenderAt = Date.now();
      if (!gotDone) flushStreamingRender(false);
    };

    renderScheduled = true;
    const elapsed = Date.now() - lastRenderAt;
    const waitMs = Math.max(0, STREAM_RENDER_INTERVAL_MS - elapsed);

    if (waitMs === 0) {
      renderFrame = requestAnimationFrame(() => {
        renderFrame = null;
        runRender();
      });
      return;
    }

    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderFrame = requestAnimationFrame(() => {
        renderFrame = null;
        runRender();
      });
    }, waitMs);
  }

  function processLine(line) {
    if (!line.startsWith('data: ')) return;
    const raw = line.slice(6).trim();
    if (raw === '[DONE]') return;

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return; }

    // Init event hanya untuk sinkronisasi session, skip processing
    if (parsed.phase === 'init') {
      if (parsed.session_id) syncSessionFromStream(parsed);
      if (parsed.user_message_id) {
        streamUserMessageId = parsed.user_message_id;
        const unsavedUserRows = Array.from(document.querySelectorAll('#chatArea .msg-row.user'))
          .filter(row => !(row.getAttribute('data-id') || '').trim());
        const pendingUserRow = unsavedUserRows[unsavedUserRows.length - 1];
        if (pendingUserRow) pendingUserRow.setAttribute('data-id', parsed.user_message_id);
      }
      return;
    }

    if (parsed.phase === 'preface') {
      if (prefaceEl && typeof parsed.message === 'string') {
        prefaceEl.textContent = parsed.message.slice(0, 240);
        prefaceEl.hidden = false;
        scrollBottom();
      }
      return;
    }

    // A streamed first-pass answer can turn into a real tool request.
    // Move its public opening into the compact process panel, then start a
    // clean final reply after the tool result arrives.
    if (parsed.phase === 'tool_switch') {
      clearStreamingRenderSchedule();
      fullText = '';
      firstToken = true;
      streamingNode = null;
      streamingCommittedLength = 0;
      if (bubbleEl) {
        bubbleEl.classList.add('stream-cursor');
        bubbleEl.innerHTML = '<div style="display:flex;gap:5px;align-items:center;padding:6px 0;opacity:0.8;">'
          + '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
      }
      if (activityEl) {
        activityEl.hidden = false;
        activityEl.open = true;
        if (!activityTimer) activityTimer = setInterval(() => updateActivityClock(), 1000);
        updateActivityClock();
      }
      if (prefaceEl && typeof parsed.message === 'string' && parsed.message.trim()) {
        prefaceEl.textContent = parsed.message.slice(0, 240);
        prefaceEl.hidden = false;
      }
      scrollBottom();
      return;
    }

    if (parsed.phase === 'progress') {
      if (activityEl && activityListEl && typeof parsed.message === 'string') {
        activityEl.hidden = false;
        activityEl.open = true;
        const step = {
          step: String(parsed.step || ''),
          message: parsed.message.slice(0, 220),
          ...(Array.isArray(parsed.sources)
            ? { sources: parsed.sources.slice(0, 5).map(source => ({
                url: String(source?.url || '').slice(0, 600),
                title: String(source?.title || '').slice(0, 140),
                ...(typeof source?.snippet === 'string' ? { snippet: source.snippet.slice(0, 420) } : {}),
                ...(typeof source?.image === 'string' ? { image: source.image.slice(0, 1200) } : {})
              })) } : {})
        };
        activityListEl.insertAdjacentHTML('beforeend', renderActivityStepHTML(step));
        wireSourcePreviewImages(activityListEl);
        activityTimeline.push(step);
        if (activityTimeline.length > 18) activityTimeline.shift();
        if (!activityTimer) activityTimer = setInterval(() => updateActivityClock(), 1000);
        updateActivityClock();
        scrollBottom();
      }
      return;
    }

    if (parsed.session_id) {
      syncSessionFromStream(parsed);
    }

    if (parsed.user_message_id) {
      streamUserMessageId = parsed.user_message_id;
      const userRows = document.getElementById('chatArea').querySelectorAll('.msg-row.user');
      if (userRows.length > 0 && !(userRows[userRows.length - 1].getAttribute('data-id') || '').trim()) {
        userRows[userRows.length - 1].setAttribute('data-id', parsed.user_message_id);
      }
    }

    if (parsed.error) {
      const err = new Error(parsed.error);
      err.streamMeta = {
        session_id: parsed.session_id || streamSessionId || currentSessionId || null,
        user_message_id: parsed.user_message_id || streamUserMessageId || null
      };
      throw err;
    }

    // ── FRIEND SUGGESTION EVENT HANDLER ──
    if (parsed.type === 'friend-suggestion') {
      hasFriendSuggestionEvent = true;
      const friendName = parsed.friend_name || 'Teman baru';
      const introMsg = parsed.intro_message || '';
      console.log('[Friend Suggestion] Detected:', { friendName, introMsg });
      // Show the modal after a brief delay
      setTimeout(() => {
        showFriendSuggestionModal(friendName, introMsg);
      }, 300);
      return; // Don't process other events for this suggestion
    }

    if (parsed.token) {
      if (firstToken) {
        streamingNode = null;
        streamingCommittedLength = 0;
        firstToken = false;
        stopPreviewTicker('', true);
      }
      fullText += parsed.token;
      scheduleStreamingRender();
    }

    if (REASONING_PREVIEW_ENABLED && parsed.reasoning) {
      showPreview({
        title: 'AAI',
        streaming_title: 'AAI sedang berpikir',
        reasoning_steps: parsed.reasoning
      }, true);
    } else if (REASONING_PREVIEW_ENABLED && parsed.preview && !parsed.done) {
      showPreview(parsed.preview, true);
    }

    if (parsed.done) {
      if (!parsed.message_id || !parsed.user_message_id) {
        throw new Error('Server tidak mengirim ID jawaban yang tersimpan. Coba lagi.');
      }
      if (parsed.final_text && (!fullText.trim() || parsed.replace_stream_text || parsed.file_job)) {
        fullText = String(parsed.final_text || '').trim();
        firstToken = false;
      }

      const friendTagResult = extractFriendSuggestionTags(fullText);
      fullText = friendTagResult.cleanText;

      // Fallback: kalau event SSE friend-suggestion tidak terkirim, tetap munculkan modal dari tag yang terdeteksi di teks.
      if (!hasFriendSuggestionEvent && friendTagResult.suggestions.length > 0) {
        const firstSuggestion = friendTagResult.suggestions[0];
        setTimeout(() => {
          showFriendSuggestionModal(firstSuggestion.name || 'Teman baru', firstSuggestion.intro || '');
        }, 250);
      }

      gotDone = true;
      if (activityTimer) clearInterval(activityTimer);
      if (activityEl && !activityEl.hidden) {
        activityEl.open = false;
        activityEl.classList.add('is-complete');
        updateActivityClock(true);
        saveActivityTrace(parsed.message_id, Date.now() - activityStartedAt, activityTimeline, prefaceEl?.textContent || '');
      }
      flushStreamingRender(true);
      const liveSourcePreviewHtml = buildMessageSourcePreviewHTML({ steps: activityTimeline });
      if (liveSourcePreviewHtml && bubbleEl && !streamRow.querySelector('.aai-source-preview')) {
        bubbleEl.insertAdjacentHTML('afterend', liveSourcePreviewHtml);
      }
      wireSourcePreviewImages(streamRow);
      stopPreviewTicker('', true);
      actionsEl.style.display = 'flex';
      streamRow.setAttribute('data-id', parsed.message_id || '');
      streamRow.setAttribute('data-plain-text', encodeURIComponent(fullText));
      streamRow.setAttribute('data-persona', parsed.persona_used || '');
      applyAssistantModelMeta(streamRow, parsed.model_used || '', parsed.model_label || '');
      const finalPreview = REASONING_PREVIEW_ENABLED
        ? (previewData || normalizePreview(parsed.preview))
        : null;
      if (finalPreview) {
        previewData = finalPreview;
        previewBodyEl.innerHTML = renderPreviewBody(finalPreview);
        previewEl.style.display = 'block';
        setPreviewTitle(finalPreview, false);
      }
      streamRow.setAttribute('data-preview', finalPreview ? encodeURIComponent(JSON.stringify(finalPreview)) : '');
      onDone(parsed, fullText, finalPreview);
      if (parsed.file_job?.id) {
        startFileJobLifecycle(parsed.file_job, parsed.message_id || null);
      }
      scrollBottom();
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        processLine(line);
      }
    }

    // Flush sisa buffer
    buffer += decoder.decode();
    if (buffer.trim()) {
      const lines = buffer.split('\n');
      for (const line of lines) {
        processLine(line);
      }
    }
  } catch (e) {
    console.error('[processStream] Error:', e.message);
    streamError = e;
  }

  if (activityTimer) clearInterval(activityTimer);
  if (streamError) {
    stopPreviewTicker('', true);
    throw streamError;
  }

  // A response is durable only after the server sends the done event with both IDs.
  // A partial stream must remain retryable, never enter the message tree as a phantom answer.
  if (!gotDone) {
    const error = new Error('Koneksi terputus sebelum jawaban tersimpan. Silakan coba lagi.');
    error.streamMeta = {
      session_id: streamSessionId || currentSessionId || null,
      user_message_id: streamUserMessageId || null
    };
    throw error;
  }

  setTimeout(scheduleStickyCodeHeadersUpdate, 180);
}

// ══════════════════════════════════════════
// KIRIM PESAN BARU
// ══════════════════════════════════════════
async function sendMessage(text, files = []) {
  if (chatMutationRunning) return;
  chatMutationRunning = true;
  const area = document.getElementById('chatArea');
  const isCompactRequest = /\[COMPACT_CHECKPOINT_REQUEST\]/i.test(text);
  if (!area.querySelector('.msg-row')) area.innerHTML = '';

  const selectedBranch = buildActiveBranch();
  const parentMessageId = selectedBranch.length ? selectedBranch[selectedBranch.length - 1].id : null;
  const requestLoadSerial = sessionLoadSerial;
  appendMessage('user', text, null, { files: files });
  scrollBottom();

  const streamId = 'stream_' + Date.now();
  const timeStr  = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  area.insertAdjacentHTML('beforeend', buildStreamBubbleHTML(streamId, timeStr));
  scrollBottom();

  setSendBtn('stop');
  abortController = new AbortController();

  // Beri waktu untuk respons streaming, termasuk saat model uji sedang sibuk.
  const timeoutId = setTimeout(() => abortController.abort(), 240000);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortController.signal,
      body: JSON.stringify({
        message: text,
        session_id: currentSessionId,
        user_id: currentUser.id,
        persona_name: currentPersona,
        model_preference: currentModelPreference,
        web_permission: currentWebPermission,
        memory_experiment_mode: currentMemoryExperimentMode,
        parent_id: parentMessageId,
        files: files
      })
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      let errMsg = `Server error ${res.status}`;
      try { const d = await res.json(); errMsg = d.error || errMsg; }
      catch { try { errMsg = (await res.text()) || errMsg; } catch {} }
      throw new Error(errMsg);
    }

    await processStream(res, streamId, (parsed, fullText, preview) => {
      const resolvedSessionId = parsed.session_id || currentSessionId;
      if (requestLoadSerial !== sessionLoadSerial) return; // User has opened another session.
      if (resolvedSessionId) {
        const knownSession = sessions.find(session => session.id === resolvedSessionId) || null;
        const shouldRefreshTitle = !knownSession || isProvisionalSessionTitle(knownSession.title);
        persistCurrentSession(resolvedSessionId, {
          title: parsed.session_title || (shouldRefreshTitle ? buildTopicSessionTitle(text) : null),
          makeFirst: !knownSession,
          refreshSidebar: shouldRefreshTitle || !knownSession
        });
        void ensureSessionVisibleInSidebar(resolvedSessionId);
      }
      const userRows = document.getElementById('chatArea').querySelectorAll('.msg-row.user');
      if (userRows.length > 0)
        userRows[userRows.length - 1].setAttribute('data-id', parsed.user_message_id || '');
      currentMessages.push({
        id: parsed.user_message_id, role: 'user', content: text,
        parent_id: parentMessageId, created_at: new Date().toISOString()
      });
      currentMessages.push({
        id: parsed.message_id, role: 'assistant', content: fullText,
        parent_id: parsed.user_message_id, created_at: new Date().toISOString(),
        preview: preview || null,
        persona: parsed.persona_used || currentPersona,
        model_used: parsed.model_used || '',
        model_label: parsed.model_label || '',
        fallback_used: !!parsed.fallback_used
      });
      if (parentMessageId) {
        const hasSibling = currentMessages.some(message =>
          message.role === 'user' && message.parent_id === parentMessageId &&
          message.id !== parsed.user_message_id
        );
        activeVersionMap[parentMessageId] = parsed.user_message_id;
        saveActiveVersions();
        if (hasSibling) renderMessageTree();
      }

      if (isCompactRequest) {
        currentSessionMeta = {
          ...(currentSessionMeta || {}),
          id: parsed.session_id || currentSessionId || currentSessionMeta?.id || null,
          compact_checkpoint_at: new Date().toISOString()
        };
        updateCompactStatus(true);
      }
    });

    } catch (e) {
    console.error('❌ SendMessage Error:', e);
    clearTimeout(timeoutId);
    renderStreamErrorUI(streamId, e.message, e.streamMeta || null);
  } finally {
    chatMutationRunning = false;
    setSendBtn('send');
  }
}

// ══════════════════════════════════════════
// REGENERATE
// ══════════════════════════════════════════
function getRegenerationTarget(aiRow) {
  if (!aiRow) return null;
  const assistantId = aiRow.getAttribute('data-id') || null;
  const assistant = currentMessages.find(message => message.id === assistantId);
  const userMessageId = aiRow.getAttribute('data-retry-user-message-id') ||
    assistant?.parent_id || null;
  const userMessage = currentMessages.find(message => message.id === userMessageId);
  const userRow = Array.from(document.querySelectorAll('#chatArea .msg-row.user'))
    .find(row => row.getAttribute('data-id') === userMessageId);
  const rawUser = userMessage?.content ||
    (userRow ? safeDecodeURIComponent(userRow.getAttribute('data-raw') || '') : '');

  // Only an ID tied to the persisted user message is safe for regeneration.
  if (!userMessageId || !rawUser) return null;
  return { text: rawUser, userMessageId, assistantId };
}

function regenerateAI(btn) {
  const aiRow = btn.closest('.msg-row.assistant');
  const target = getRegenerationTarget(aiRow);
  if (!target) {
    void showAlertMessage('Pesan asli belum tersinkron. Muat ulang sesi dan coba lagi.', 'Tidak Bisa Mengulang');
    return;
  }
  void executeRegenerate(target.text, target.userMessageId, target.assistantId, aiRow);
}

async function executeRegenerate(text, userMessageId = null, assistantMessageId = null, aiRow = null) {
  if (!userMessageId || !currentSessionId) {
    await showAlertMessage('Sesi atau pesan induk belum tersimpan. Muat ulang sesi.', 'Tidak Bisa Mengulang');
    return;
  }
  if (chatMutationRunning) return;
  chatMutationRunning = true;

  const area = document.getElementById('chatArea');
  const streamId = 'regen_' + Date.now();
  const requestLoadSerial = sessionLoadSerial;
  const pinnedSessionId = aiRow?.getAttribute('data-retry-session-id') || null;
  const effectiveSessionId = pinnedSessionId || currentSessionId;
  const frozenPersona =
    aiRow?.getAttribute('data-persona') ||
    (assistantMessageId ? currentMessages.find(m => m.id === assistantMessageId)?.persona : null) ||
    currentPersona;

  // Keep the saved response visible while the next version is generated.
  // Only an unsaved error bubble may be reused.
  const reuseFailedBubble = Boolean(aiRow && !aiRow.getAttribute('data-id'));
  if (reuseFailedBubble) {
    prepareAssistantRowForStreaming(aiRow, streamId);
  } else {
    const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const html = buildStreamBubbleHTML(streamId, timeStr);
    const userRow = Array.from(area.querySelectorAll('.msg-row.user'))
      .find(row => row.getAttribute('data-id') === userMessageId);
    if (aiRow) aiRow.insertAdjacentHTML('afterend', html);
    else if (userRow) userRow.insertAdjacentHTML('afterend', html);
    else area.insertAdjacentHTML('beforeend', html);
  }

  const streamRow = document.getElementById(streamId);
  if (streamRow) {
    streamRow.setAttribute('data-retry-session-id', effectiveSessionId);
    streamRow.setAttribute('data-retry-user-message-id', userMessageId);
  }
  scrollBottom();
  setSendBtn('stop');
  abortController = new AbortController();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortController.signal,
      body: JSON.stringify({
        message: text,
        session_id: effectiveSessionId,
        user_id: currentUser.id,
        persona_name: frozenPersona,
        model_preference: currentModelPreference,
        web_permission: currentWebPermission,
        memory_experiment_mode: currentMemoryExperimentMode,
        user_message_id: userMessageId
      })
    });

    if (!res.ok) {
      let errMsg = 'Server error ' + res.status;
      try { const body = await res.json(); errMsg = body.error || errMsg; } catch {}
      throw new Error(errMsg);
    }

    await processStream(res, streamId, (parsed, fullText, preview) => {
      if (requestLoadSerial !== sessionLoadSerial || currentSessionId !== effectiveSessionId) return;
      if (!currentMessages.some(m => m.id === userMessageId)) {
        const branch = buildActiveBranch();
        const parent = branch.length ? branch[branch.length - 1].id : null;
        currentMessages.push({
          id: userMessageId, role: 'user', content: text,
          parent_id: parent, created_at: new Date().toISOString()
        });
      }
      const knownSession = sessions.find(session => session.id === effectiveSessionId) || null;
      if (parsed.session_title || !knownSession || isProvisionalSessionTitle(knownSession.title)) {
        persistCurrentSession(effectiveSessionId, {
          title: parsed.session_title || buildTopicSessionTitle(text),
          makeFirst: !knownSession,
          refreshSidebar: true
        });
      }

      currentMessages.push({
        id: parsed.message_id, role: 'assistant', content: fullText,
        parent_id: userMessageId, created_at: new Date().toISOString(),
        preview: preview || null,
        persona: parsed.persona_used || frozenPersona,
        model_used: parsed.model_used || '',
        model_label: parsed.model_label || '',
        fallback_used: !!parsed.fallback_used
      });
      activeVersionMap[userMessageId] = parsed.message_id;
      saveActiveVersions();
      renderMessageTree();
    });
  } catch (error) {
    console.error('❌ Regenerate Error:', error);
    if (requestLoadSerial === sessionLoadSerial) {
      renderStreamErrorUI(streamId, error.message, {
        session_id: effectiveSessionId,
        user_message_id: userMessageId
      });
    }
  } finally {
    chatMutationRunning = false;
    setSendBtn('send');
  }
}

// ══════════════════════════════════════════
// TOMBOL "COBA LAGI"
// ══════════════════════════════════════════
function retryLastMessage(btn) {
  regenerateAI(btn);
}

// ══════════════════════════════════════════
// EDIT PESAN USER
// ══════════════════════════════════════════
async function editUserMsg(btn) {
  const row    = btn.closest('.msg-row.user');
  const bubble = row.querySelector('.bubble');
  const raw    = decodeURIComponent(row.dataset.raw || bubble.innerText);
  const msgId  = row.dataset.id;

  if (!msgId) {
    await showAlertMessage('Pesan ini belum punya ID database. Refresh dulu lalu coba edit lagi.', 'Tidak Bisa Edit');
    return;
  }

  row.classList.add('editing');
  bubble.classList.add('is-editing');
  bubble.dataset.originalHtml = bubble.innerHTML;
  bubble.innerHTML = `
    <textarea class="edit-textarea" id="edt_${msgId}">${escHtml(raw)}</textarea>
    <div class="edit-actions">
      <button class="btn-edit-cancel" onclick="cancelEdit(this)">Batal</button>
      <button class="btn-edit-save" onclick="saveEdit(this, '${msgId}')">Kirim ▶</button>
    </div>`;

  const ta = document.getElementById(`edt_${msgId}`);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = ta.value.length;
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(bubble.querySelector('.btn-edit-save'), msgId); }
    if (e.key === 'Escape') cancelEdit(bubble.querySelector('.btn-edit-cancel'));
  });
}

function cancelEdit(btn) {
  const bubble = btn.closest('.bubble');
  const row = bubble?.closest('.msg-row.user');
  bubble.innerHTML = bubble.dataset.originalHtml;
  bubble.classList.remove('is-editing');
  row?.classList.remove('editing');
}

async function saveEdit(btn, msgId) {
  const bubble = btn.closest('.bubble');
  const row = btn.closest('.msg-row.user');
  if (!row || !bubble || chatMutationRunning) return;

  const newText = bubble.querySelector('textarea')?.value.trim() || '';
  const originalMessage = currentMessages.find(message => message.id === msgId && message.role === 'user');
  if (!originalMessage) {
    await showAlertMessage('Pesan asli belum ditemukan. Muat ulang sesi lalu coba lagi.', 'Edit Gagal');
    return;
  }
  if (!newText) return;
  if (newText === originalMessage.content.trim()) {
    cancelEdit(btn);
    return;
  }

  // The edit becomes another user-message version, preserving the original
  // prompt and all its following answers in the history tree.
  bubble.innerHTML = buildUserMessageBodyHTML(newText);
  bubble.classList.remove('is-editing');
  row.classList.remove('editing');
  row.setAttribute('data-raw', encodeURIComponent(newText));
  refreshUserMessageCollapse(row);

  await sendMessageBranched(newText, originalMessage.parent_id, msgId, row);
}

// ══════════════════════════════════════════
// KIRIM PESAN DARI EDIT (branched)
// ══════════════════════════════════════════
async function sendMessageBranched(text, parentId = null, editedMessageId = null, editedRow = null) {
  if (chatMutationRunning) return;
  chatMutationRunning = true;

  const streamId = 'branch_' + Date.now();
  const area = document.getElementById('chatArea');
  const editedSessionId = currentSessionId;
  const requestLoadSerial = sessionLoadSerial;
  const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const streamHtml = buildStreamBubbleHTML(streamId, timeStr);
  if (editedRow) editedRow.insertAdjacentHTML('afterend', streamHtml);
  else area.insertAdjacentHTML('beforeend', streamHtml);

  setSendBtn('stop');
  abortController = new AbortController();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortController.signal,
      body: JSON.stringify({
        message: text,
        session_id: editedSessionId,
        user_id: currentUser.id,
        persona_name: currentPersona,
        model_preference: currentModelPreference,
        web_permission: currentWebPermission,
        memory_experiment_mode: currentMemoryExperimentMode,
        parent_id: parentId,
        branch_root: parentId === null
      })
    });

    if (!res.ok) {
      let errMsg = 'Server error ' + res.status;
      try { const body = await res.json(); errMsg = body.error || errMsg; } catch {}
      throw new Error(errMsg);
    }

    await processStream(res, streamId, (parsed, fullText, preview) => {
      if (requestLoadSerial !== sessionLoadSerial || currentSessionId !== editedSessionId) return;
      currentMessages.push({
        id: parsed.user_message_id, role: 'user', content: text,
        parent_id: parentId, created_at: new Date().toISOString()
      });
      currentMessages.push({
        id: parsed.message_id, role: 'assistant', content: fullText,
        parent_id: parsed.user_message_id, created_at: new Date().toISOString(),
        preview: preview || null,
        persona: parsed.persona_used || currentPersona,
        model_used: parsed.model_used || '',
        model_label: parsed.model_label || '',
        fallback_used: !!parsed.fallback_used
      });
      activeVersionMap[parentId || '__root__'] = parsed.user_message_id;
      activeVersionMap[parsed.user_message_id] = parsed.message_id;
      saveActiveVersions();
      renderMessageTree();
    });
  } catch (error) {
    console.error('❌ Branched Message Error:', error);
    if (requestLoadSerial !== sessionLoadSerial || currentSessionId !== editedSessionId) return;

    const pendingId = error.streamMeta?.user_message_id || null;
    if (pendingId) {
      // The Worker already saved the edited user version. Keep it available
      // for retry instead of sending another duplicate user message.
      if (!currentMessages.some(message => message.id === pendingId)) {
        currentMessages.push({
          id: pendingId, role: 'user', content: text,
          parent_id: parentId, created_at: new Date().toISOString()
        });
      }
      activeVersionMap[parentId || '__root__'] = pendingId;
      saveActiveVersions();
      renderMessageTree();
      const errorRowId = 'edit_retry_' + Date.now();
      const renderJob = activeRenderJob;
      const showRetryAfterRender = () => {
        if (renderJob !== activeRenderJob) return;
        const editedUserRow = Array.from(area.querySelectorAll('.msg-row.user'))
          .find(item => item.getAttribute('data-id') === pendingId);
        if (!editedUserRow) {
          requestAnimationFrame(showRetryAfterRender);
          return;
        }
        editedUserRow.insertAdjacentHTML('afterend', buildStreamBubbleHTML(errorRowId, timeStr));
        renderStreamErrorUI(errorRowId, error.message, {
          session_id: editedSessionId, user_message_id: pendingId
        });
      };
      requestAnimationFrame(showRetryAfterRender);
    } else {
      renderMessageTree();
      await showAlertMessage('Edit belum tersimpan: ' + error.message, 'Edit Gagal');
    }
  } finally {
    chatMutationRunning = false;
    setSendBtn('send');
  }
}

// ══════════════════════════════════════════
// SESSIONS
// ══════════════════════════════════════════
async function loadSessions() {
  try {
    const res  = await fetch(`/api/sessions?user_id=${currentUser.id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    sessions = Array.isArray(data) ? data : (data.sessions || []);
    if (currentSessionId) {
      currentSessionMeta = sessions.find(s => s.id === currentSessionId) || currentSessionMeta;
      updateCompactStatus();
    }
    renderSidebar();
    return sessions;
  } catch (e) {
    logDebug(`Gagal load sessions: ${e.message}`, '#e74c3c');
    if (!sessions.length) renderSidebar();
    return sessions;
  }
}

async function loadSession(id, options = {}) {
  const {
    allowMissingSidebar = false,
    suppressErrorState = false,
    titleHint = ''
  } = options;
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return false;
  const thisLoad = ++sessionLoadSerial;

  const existingSession = sessions.find(s => s.id === normalizedId) || null;
  persistCurrentSession(normalizedId, {
    force: true,
    title: existingSession?.title || titleHint || (allowMissingSidebar ? 'Memuat sesi...' : null),
    makeFirst: allowMissingSidebar && !existingSession,
    refreshSidebar: allowMissingSidebar && !existingSession
  });

  const session = sessions.find(s => s.id === normalizedId) || existingSession || null;
  currentSessionMeta = session || null;
  updateCompactStatus();
  document.getElementById('topbarTitle').textContent = session?.title || 'AAi';
  currentMessages  = [];
  activeVersionMap = restoreActiveVersions(normalizedId);
  document.getElementById('chatArea').innerHTML = `
    <div style="padding:60px;text-align:center;color:var(--text-muted);">
      <i class="fas fa-spinner fa-spin" style="font-size:28px;"></i>
      <p style="margin-top:12px;">Memuat percakapan...</p>
    </div>`;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: normalizedId,
        user_id: currentUser.id,
        action: 'load_session'
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // A slower response from a previously selected session must not replace
    // the messages of the session the user has already switched to.
    if (thisLoad !== sessionLoadSerial || currentSessionId !== normalizedId) return false;
    if (Array.isArray(data.messages) && (!data.status || data.status === 'active')) {
      currentMessages = data.messages;
      // loadSessions() may have finished while this request was in flight.
      // Never let an optimistic 'Memuat sesi...' title override the DB title
      // or the actual first user message after a reload.
      const latestSession = sessions.find(item => item.id === normalizedId) || session || null;
      const actualTitle = [latestSession?.title, session?.title, titleHint]
        .find(value => !isProvisionalSessionTitle(value)) || buildSessionTitleFromMessages(data.messages);
      const syncedSession = upsertSessionSnapshot({
        ...(latestSession || {}),
        id: normalizedId,
        title: actualTitle,
        compact_checkpoint_at: latestSession?.compact_checkpoint_at || null,
        updated_at: new Date().toISOString()
      }, { makeFirst: allowMissingSidebar && !existingSession });
      if (syncedSession) {
        currentSessionMeta = syncedSession;
        document.getElementById('topbarTitle').textContent = syncedSession.title || 'AAi';
        updateCompactStatus();
      }
      renderMessageTree();
      resumePendingFileJobsForCurrentSession();
    } else throw new Error("Format data tidak valid");
    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
    renderSidebar();
    return true;
  } catch (e) {
    if (thisLoad !== sessionLoadSerial) return false;
    logDebug(`Error load session: ${e.message}`, '#e74c3c');
    if (!suppressErrorState) {
      document.getElementById('chatArea').innerHTML =
        `<div style="padding:40px;text-align:center;color:#e74c3c;">⚠️ Gagal memuat: ${e.message}</div>`;
    }
    return false;
  }
}

function renderSidebar() {
  const container = document.getElementById('sessionList');
  container.innerHTML = '';
  if (!sessions.length) {
    container.innerHTML = '<p class="session-empty">Belum ada percakapan.<br>Mulai dengan tombol di atas.</p>';
    return;
  }
  sessions.forEach(s => {
    const item = document.createElement('div');
    item.className = `session-item ${s.id === currentSessionId ? 'active' : ''}`;
    item.setAttribute('tabindex', '0');
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', 'Buka percakapan: ' + (s.title || 'Obrolan'));
    item.innerHTML = `
      <div class="session-leading">
        <span class="session-mark" aria-hidden="true"><i class="far fa-comment-dots"></i></span>
        <span class="session-title">${escHtml(s.title || 'Obrolan')}</span>
      </div>
      <div class="session-actions">
        <button type="button" class="action-btn" aria-label="Ubah judul percakapan" title="Ubah judul"
          data-sid="${s.id}" data-title="${escHtml(s.title || '')}"
          onclick="event.stopImmediatePropagation();renameSession(this.dataset.sid, this.dataset.title)"><i class="fas fa-pen"></i></button>
        <button type="button" class="action-btn danger" aria-label="Hapus percakapan" title="Hapus"
          onclick="event.stopImmediatePropagation();deleteSession('${s.id}')"><i class="far fa-trash-alt"></i></button>
      </div>`;
    item.onclick = (e) => { if (!e.target.closest('button')) loadSession(s.id); };
    item.onkeydown = (e) => {
      if (e.target === item && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        loadSession(s.id);
      }
    };
    container.appendChild(item);
  });
}

async function renameSession(id, oldTitle) {
  const newTitle = await showPromptMessage({
    title: 'Rename Session',
    message: 'Masukkan judul baru untuk sesi ini.',
    defaultValue: oldTitle,
    placeholder: 'Contoh: Debug login flow'
  });
  if (newTitle === null) return;
  if (!newTitle.trim() || newTitle === oldTitle) return;
  const idx = sessions.findIndex(s => s.id === id);
  if (idx !== -1) { sessions[idx].title = newTitle.trim(); renderSidebar(); }
  if (currentSessionId === id) document.getElementById('topbarTitle').textContent = newTitle.trim();
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim(), user_id: currentUser.id })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch { await loadSessions(); }
}

let sessionToDelete = null;
function deleteSession(id) { sessionToDelete = id; document.getElementById('deleteModal').classList.add('active'); }
function closeDeleteModal() { sessionToDelete = null; document.getElementById('deleteModal').classList.remove('active'); }
document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
  if (!sessionToDelete) return;
  const id = sessionToDelete; closeDeleteModal();
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}?user_id=${encodeURIComponent(currentUser.id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (currentSessionId === id) newChat();
    await loadSessions();
  } catch (e) { console.error("Gagal hapus:", e); }
});

function useWelcomePrompt(promptText) {
  const input = document.getElementById('messageInput');
  if (!input) return;
  input.value = promptText;
  autoResize(input);
  updateMobileSendVisibility();
  input.focus();
}

function newChat(options = {}) {
  const { preserveStoredSession = false } = options;
  currentSessionId = null;
  setHistoryDrawerOpen(false);
  sessionLoadSerial += 1;
  currentSessionMeta = null;
  activeRenderJob += 1;
  if (!preserveStoredSession) clearStoredSessionState();
  currentMessages = [];
  activeVersionMap = {};
  document.getElementById('chatArea').innerHTML = `
    <section class="aai-welcome" aria-label="Selamat datang di AAi">
      <div class="aai-welcome-art">
        <div class="aai-crystal-halo"></div>
        <span class="aai-floating-star star-a">✦</span><span class="aai-floating-star star-b">✧</span>
        <img src="${getWelcomeIllustrationSrc()}" alt="Maskot cewek AAi dengan kristal bertuliskan AAi di dadanya" />
        <span class="aai-art-signature"><i class="fas fa-gem"></i> Meet your creative companion</span>
      </div>
      <div class="aai-welcome-copy">
        <span class="aai-kicker"><i class="fas fa-sun"></i> HI, WELCOME TO AAi WORLD</span>
        <h1>Halo, <span>${escHtml(getPreferredDisplayName())}!</span><br>Yuk, bikin hal <em>indah.</em></h1>
        <p>Ada cerita, pertanyaan, atau ide kecil? AAi siap menemanimu mengubahnya jadi sesuatu yang istimewa. ✨</p>
        <div class="aai-prompt-heading"><span class="aai-prompt-sparkle">✦</span> MAU MULAI DARI MANA?</div>
        <div class="aai-prompt-grid">
          <button class="aai-prompt" type="button" onclick="useWelcomePrompt('Bantu aku merapikan ide yang sedang kupikirkan')"><i class="far fa-lightbulb"></i><span>Rapikan ide</span><i class="fas fa-arrow-right aai-prompt-arrow"></i></button>
          <button class="aai-prompt" type="button" onclick="useWelcomePrompt('Ajari aku topik baru dengan penjelasan sederhana')"><i class="fas fa-book-open"></i><span>Belajar hal baru</span><i class="fas fa-arrow-right aai-prompt-arrow"></i></button>
          <button class="aai-prompt" type="button" onclick="useWelcomePrompt('Bantu aku menyusun langkah kerja yang jelas')"><i class="fas fa-list-check"></i><span>Susun rencana</span><i class="fas fa-arrow-right aai-prompt-arrow"></i></button>
          <button class="aai-prompt" type="button" onclick="useWelcomePrompt('Yuk ngobrol santai sebentar')"><i class="far fa-comment-dots"></i><span>Ngobrol santai</span><i class="fas fa-arrow-right aai-prompt-arrow"></i></button>
        </div>
      </div>
    </section>`;
  document.getElementById('topbarTitle').textContent = 'AAi · Ayaka & Ayato';
  updateCompactStatus(false);
  updateMobileSendVisibility(false);
  renderSidebar();
}
// ══════════════════════════════════════════
// MESSAGE TREE
// ══════════════════════════════════════════
function activeVersionStorageKey(sessionId) {
  return 'aai_versions_' + String(currentUser.id) + '_' + String(sessionId || '');
}

function restoreActiveVersions(sessionId) {
  try {
    const stored = JSON.parse(localStorage.getItem(activeVersionStorageKey(sessionId)) || '{}');
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function saveActiveVersions() {
  if (!currentSessionId) return;
  try {
    localStorage.setItem(activeVersionStorageKey(currentSessionId), JSON.stringify(activeVersionMap));
  } catch (error) {
    console.warn('[AAi versions] Penyimpanan pilihan versi dilewati:', error);
  }
}

function buildActiveBranch() {
  if (!currentMessages.length) return [];
  const allIds = new Set(currentMessages.map(m => m.id));
  const roots = currentMessages.filter(m => !m.parent_id || !allIds.has(m.parent_id));
  const chosenRootId = activeVersionMap.__root__;
  let current = roots.find(m => m.id === chosenRootId) || null;
  if (!current) {
    current = roots.reduce((oldest, m) => {
      if (!oldest) return m;
      return new Date(m.created_at) < new Date(oldest.created_at) ? m : oldest;
    }, null);
  }
  if (!current) return [];

  // Pre-compute descendant counts so we can prefer the deepest live branch
  // at any fork (handles orphaned checkpoint AI responses from race conditions)
  const childrenMap = {};
  currentMessages.forEach(m => { if (m.parent_id) { (childrenMap[m.parent_id] = childrenMap[m.parent_id] || []).push(m); } });
  const descCount = {};
  function countDesc(id) {
    if (descCount.hasOwnProperty(id)) return descCount[id];
    const kids = childrenMap[id] || [];
    descCount[id] = kids.reduce((s, c) => s + 1 + countDesc(c.id), 0);
    return descCount[id];
  }
  currentMessages.forEach(m => countDesc(m.id));

  const branch = [current];
  while (true) {
    const children = currentMessages.filter(m => m.parent_id === current.id);
    if (!children.length) break;
    const selectedId = activeVersionMap[current.id];
    if (selectedId && children.find(c => c.id === selectedId)) {
      current = children.find(c => c.id === selectedId);
    } else {
      // Prefer the child leading to the deepest chain; tiebreak: most recently created
      current = children.reduce((best, c) => {
        const cD = descCount[c.id] || 0, bD = descCount[best.id] || 0;
        if (cD !== bD) return cD > bD ? c : best;
        return new Date(c.created_at) >= new Date(best.created_at) ? c : best;
      });
    }
    branch.push(current);
  }
  return branch;
}

function switchVersion(id) {
  const msg = currentMessages.find(m => m.id === id);
  if (!msg) return;
  activeVersionMap[msg.parent_id || '__root__'] = id;
  saveActiveVersions();
  renderMessageTree(); scrollBottom();
}

function renderEmptySessionState() {
  const area = document.getElementById('chatArea');
  area.innerHTML = `
    <div class="empty-session">
      <div class="empty-session-icon"><i class="far fa-comments"></i></div>
      <h3>Mulai percakapanmu</h3>
      <p>Sesi ini belum berisi pesan. Tulis sesuatu di bawah untuk memulai.</p>
    </div>`;
}

function renderMessageTree() {
  const area   = document.getElementById('chatArea');
  const branch = buildActiveBranch();
  const renderJob = ++activeRenderJob;
  if (!branch.length) {
    suppressAutoScroll = false;
    renderEmptySessionState();
    scheduleStickyCodeHeadersUpdate();
    logDebug('Branch kosong, render state sesi kosong', '#e67e22');
    return;
  }
  closeUserMessageMenu();
  area.innerHTML = '';
  suppressAutoScroll = true;
  const renderChunkSize = isMobileViewport() ? 8 : 18;
  const renderChunk = (startIndex = 0) => {
    if (renderJob !== activeRenderJob) return;

    const endIndex = Math.min(startIndex + renderChunkSize, branch.length);
    for (let index = startIndex; index < endIndex; index += 1) {
      const message = branch[index];
      const siblings = currentMessages.filter(s => s.parent_id === message.parent_id && s.role === message.role);
      const currentIndex = siblings.findIndex(s => s.id === message.id);
      const extra = message.role === 'assistant'
        ? {
            preview: message.preview || null,
            persona: message.persona || '',
            model: message.model_used || '',
            modelLabel: message.model_label || '',
            activityTrace: message.activity_trace || null
          }
        : null;
      appendMessage(message.role, message.content, message.created_at, null, message.id, {
        total: siblings.length,
        current: currentIndex + 1,
        siblings: siblings.map(s => s.id)
      }, extra);
    }

    if (endIndex < branch.length) {
      requestAnimationFrame(() => renderChunk(endIndex));
      return;
    }

    if (renderJob !== activeRenderJob) return;
    suppressAutoScroll = false;
    scrollBottom();
    scheduleStickyCodeHeadersUpdate();
  };

  requestAnimationFrame(() => renderChunk(0));
}


// Date headers are visual separators inside the active conversation, never new sessions.
function getChatMessageDate(timestamp = null) {
  const parsed = timestamp ? new Date(timestamp) : new Date();
  const date = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  return {
    key,
    label: date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
    time: date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  };
}

function ensureChatDateDivider(area, dateMeta) {
  let previous = area.lastElementChild;
  while (previous && !previous.classList.contains('msg-row')) {
    previous = previous.previousElementSibling;
  }
  if (previous?.dataset.chatDate === dateMeta.key) return;
  area.insertAdjacentHTML('beforeend',
    '<div class="chat-date-divider" role="separator" aria-label="' + dateMeta.label +
    '" data-chat-date="' + dateMeta.key + '"><time datetime="' + dateMeta.key +
    '">' + dateMeta.label + '</time></div>');
}

// Summarize only the visible presentation; the original message is never truncated.
function buildUserMessageBodyHTML(content) {
  return '<div class="user-message-content">' + formatContent(content) + '</div>' +
    '<button type="button" class="user-message-expand" aria-expanded="false" hidden onclick="toggleUserMessageExpansion(this)">' +
    '<span>Tampilkan lebih banyak</span><i class="fas fa-chevron-down" aria-hidden="true"></i></button>';
}

function refreshUserMessageCollapse(row) {
  if (!row || row.classList.contains('editing')) return;
  const content = row.querySelector('.user-message-content');
  const toggle = row.querySelector('.user-message-expand');
  if (!content || !toggle) return;
  const expanded = content.classList.contains('is-expanded');
  content.classList.remove('is-collapsed');
  const lineHeight = parseFloat(getComputedStyle(content).lineHeight) ||
    parseFloat(getComputedStyle(content).fontSize) * 1.66;
  const previewHeight = Math.round(lineHeight * 6);
  content.style.setProperty('--user-message-preview-height', previewHeight + 'px');
  const overflowing = content.scrollHeight > previewHeight + 3;
  toggle.hidden = !overflowing;
  if (!overflowing) {
    content.classList.remove('is-expanded');
    toggle.setAttribute('aria-expanded', 'false');
  } else if (!expanded) {
    content.classList.add('is-collapsed');
  }
}

function toggleUserMessageExpansion(button) {
  const content = button.closest('.bubble')?.querySelector('.user-message-content');
  if (!content) return;
  const expand = !content.classList.contains('is-expanded');
  content.classList.toggle('is-expanded', expand);
  content.classList.toggle('is-collapsed', !expand);
  button.setAttribute('aria-expanded', String(expand));
  button.querySelector('span').textContent = expand ? 'Tampilkan lebih sedikit' : 'Tampilkan lebih banyak';
  button.querySelector('i').className = expand ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
}

let userMessageCollapseFrame = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(userMessageCollapseFrame);
  userMessageCollapseFrame = requestAnimationFrame(() => {
    document.querySelectorAll('#chatArea > .msg-row.user').forEach(refreshUserMessageCollapse);
  });
});

// ══════════════════════════════════════════
// APPEND MESSAGE
// ══════════════════════════════════════════
function appendMessage(role, content, timestamp = null, metadata = null, messageId = null, versionInfo = null, extra = null) {
  const area = document.getElementById('chatArea');
  const chatDate = getChatMessageDate(timestamp);
  const time = chatDate.time;

  let html = '';

  if (role === 'assistant') {
    const previewBlock = extra?.preview ? buildPreviewPanelHTML(extra.preview) : '';
    const modelName = String(extra?.model || '').trim();
    const modelLabel = normalizeAssistantModelLabel(modelName, extra?.modelLabel || '');
    const persistedTrace = extra?.activityTrace;
    const localTrace = messageId ? getStoredActivityTraces()[messageId] : null;
    const activityTrace = persistedTrace && Array.isArray(persistedTrace.steps) && persistedTrace.steps.length
      ? persistedTrace : localTrace || persistedTrace || null;
    const sourcePreviewHtml = buildMessageSourcePreviewHTML(activityTrace);

    let sourcesHtml = '';
    if (metadata?.sources?.length) {
      sourcesHtml = `
        <div class="sources-container">
          <div class="source-label"><i class="fas fa-search"></i> Referensi</div>
          <div class="source-grid">
            ${metadata.sources.map(s => `<a href="${s.link}" target="_blank" class="source-item"><i class="fas fa-link"></i> ${s.title}</a>`).join('')}
          </div>
          ${metadata.image ? `<img src="${metadata.image}" class="source-img" alt="Referensi">` : ''}
        </div>`;
    }
    let versionHtml = ``;
    if (versionInfo?.total > 1) {
      const prev = versionInfo.current > 1 ? versionInfo.siblings[versionInfo.current - 2] : null;
      const next = versionInfo.current < versionInfo.total ? versionInfo.siblings[versionInfo.current] : null;
      versionHtml = `
        <span class="version-tag" style="display:flex;align-items:center;gap:6px;background:#e2e8f0;color:var(--text);padding:2px 8px;border-radius:12px;">
          <button style="border:none;background:none;cursor:${prev?'pointer':'default'};opacity:${prev?'1':'0.3'};padding:0 4px;"
            ${prev ? `onclick="switchVersion('${prev}')"` : ''}>◀</button>
          <span>${versionInfo.current} / ${versionInfo.total}</span>
          <button style="border:none;background:none;cursor:${next?'pointer':'default'};opacity:${next?'1':'0.3'};padding:0 4px;"
            ${next ? `onclick="switchVersion('${next}')"` : ''}>▶</button>
        </span>`;
    }
    html = `
    <div class="msg-row assistant" data-chat-date="${chatDate.key}" data-id="${messageId||''}" data-plain-text="${encodeURIComponent(content)}" data-preview="${extra?.preview ? encodeURIComponent(JSON.stringify(extra.preview)) : ''}" data-persona="${escHtml(extra?.persona || '')}" data-model="${escHtml(modelName)}" data-model-label="${escHtml(modelLabel)}">
      ${buildAssistantHeaderHTML(versionHtml, modelName, modelLabel)}
      ${previewBlock}
      ${buildStoredActivityPanelHTML(messageId, extra?.activityTrace)}
      <div class="bubble">${formatContent(content)}</div>
      ${sourcePreviewHtml}
      ${sourcesHtml}
      <div class="msg-actions">
        <button title="Copy" onclick="copyFullAI(this)"><i class="far fa-copy"></i></button>
        <button title="Ulangi" onclick="regenerateAI(this)"><i class="fas fa-sync-alt"></i></button>
        <button class="tts-btn" title="Dengarkan"
          onclick="speakText(this, decodeURIComponent(this.closest('.msg-row').dataset.plainText))">
          <i class="fas fa-volume-up"></i>
        </button>
        <span style="font-size:11px;opacity:.65;">${time}</span>
      </div>
    </div>`;

      } else {
    let filesHtml = '';
    if (metadata && metadata.files && Array.isArray(metadata.files) && metadata.files.length > 0) {
      filesHtml = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">`;
      metadata.files.forEach(f => {
        const isImage = f.type && f.type.startsWith('image/');
        const name = f.name || 'file';
        if (isImage && f.base64) {
          const safeSrc = f.base64.replace(/"/g, '&quot;');
          filesHtml += `<img src="${safeSrc}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;border:2px solid var(--blue-light);background:#fff;cursor:pointer;" alt="${name}" onclick="window.open('${safeSrc}','_blank')">`;
        } else {
          const icon = f.type?.includes('word') ? '📝' : f.type?.includes('sheet') ? '📊' : f.type?.includes('pdf') ? '📕' : '📄';
          filesHtml += `<div style="display:flex;align-items:center;gap:5px;background:#fff;padding:5px 8px;border-radius:8px;font-size:12px;border:1px solid var(--blue-light);color:var(--text);">
            <span style="font-size:16px;">${icon}</span>
            <span style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
          </div>`;
        }
      });
      filesHtml += `</div>`;
    }

    html = `
    <div class="msg-row user" data-chat-date="${chatDate.key}" data-raw="${encodeURIComponent(content)}" data-id="${messageId||''}">
      <div class="user-bubble-wrap">
        <div class="bubble" tabindex="0" role="group" aria-haspopup="menu" aria-label="Pesan pengguna. Tekan lama, klik kanan, atau Enter untuk opsi pesan" title="Tekan lama untuk Edit atau Salin">${buildUserMessageBodyHTML(content)}</div>
        ${filesHtml}
        <div class="user-actions user-message-meta">
          <span class="user-message-time">${time}</span>
        </div>
      </div>
    </div>`;
  }

  ensureChatDateDivider(area, chatDate);
  area.insertAdjacentHTML('beforeend', html);
  if (role === 'assistant') wireSourcePreviewImages(area.lastElementChild);
  if (role === 'user') refreshUserMessageCollapse(area.lastElementChild);
  if (!suppressAutoScroll) {
    scrollBottom();
  }
}

// ══════════════════════════════════════════
// COPY
// ══════════════════════════════════════════
async function copyUserMsg(target) {
  const row = target.closest('.msg-row.user');
  if (!row) return false;
  const raw = decodeURIComponent(row.dataset.raw || row.querySelector('.bubble')?.innerText || '');
  await navigator.clipboard.writeText(raw);
  const icon = target.matches('button') ? target.querySelector('i') : null;
  if (icon) {
    icon.className = 'fas fa-check';
    setTimeout(() => { icon.className = 'far fa-copy'; }, 2000);
  }
  return true;
}
function copyFullAI(btn) {
  navigator.clipboard.writeText(btn.closest('.assistant').querySelector('.bubble').innerText);
  const i = btn.querySelector('i'); i.className = 'fas fa-check'; i.style.color = '#5ab4d4';
  setTimeout(() => { i.className = 'far fa-copy'; i.style.color = 'inherit'; }, 2000);
}


/* User messages: long-press on touch, right-click on desktop, Enter via keyboard. */
let userMessageMenu = null;
let activeUserMessageRow = null;
let userMessagePressTimer = null;
let userMessagePress = null;

function closeUserMessageMenu() {
  if (userMessageMenu) userMessageMenu.hidden = true;
  activeUserMessageRow = null;
}

function showUserCopyFeedback(success) {
  const feedback = document.createElement('div');
  feedback.className = 'aai-user-copy-feedback';
  feedback.setAttribute('role', 'status');
  feedback.textContent = success ? '✓ Pesan disalin' : 'Gagal menyalin pesan';
  document.body.appendChild(feedback);
  setTimeout(() => feedback.remove(), 1800);
}

function ensureUserMessageMenu() {
  if (userMessageMenu) return userMessageMenu;
  const menu = document.createElement('div');
  menu.className = 'aai-user-message-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Opsi pesan pengguna');
  menu.hidden = true;

  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.setAttribute('role', 'menuitem');
  editButton.dataset.action = 'edit';
  editButton.innerHTML = '<i class="fas fa-pen" aria-hidden="true"></i><span>Edit</span>';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.setAttribute('role', 'menuitem');
  copyButton.dataset.action = 'copy';
  copyButton.innerHTML = '<i class="far fa-copy" aria-hidden="true"></i><span>Salin</span>';

  menu.append(editButton, copyButton);
  document.body.appendChild(menu);

  menu.addEventListener('click', event => {
    const actionButton = event.target.closest('button[data-action]');
    if (!actionButton) return;
    const row = activeUserMessageRow;
    closeUserMessageMenu();
    if (!row || !row.isConnected) return;
    const bubble = row.querySelector('.bubble');
    if (!bubble) return;
    if (actionButton.dataset.action === 'edit') {
      void editUserMsg(bubble);
    } else if (actionButton.dataset.action === 'copy') {
      void copyUserMsg(bubble).then(showUserCopyFeedback).catch(() => showUserCopyFeedback(false));
    }
  });
  userMessageMenu = menu;
  return menu;
}

function openUserMessageMenu(row, pointX) {
  if (!row || row.classList.contains('editing')) return;
  const bubble = row.querySelector('.bubble');
  if (!bubble || bubble.classList.contains('is-editing')) return;
  const menu = ensureUserMessageMenu();
  activeUserMessageRow = row;
  menu.hidden = false;

  const bubbleBounds = bubble.getBoundingClientRect();
  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  const inset = 10;
  const centerX = Number.isFinite(pointX) ? pointX : bubbleBounds.left + bubbleBounds.width / 2;
  const left = Math.min(Math.max(centerX - menuWidth / 2, inset), Math.max(inset, innerWidth - menuWidth - inset));
  let top = bubbleBounds.top - menuHeight - 9;
  if (top < inset) top = bubbleBounds.bottom + 9;
  top = Math.min(Math.max(top, inset), Math.max(inset, innerHeight - menuHeight - inset));

  menu.style.left = Math.round(left) + 'px';
  menu.style.top = Math.round(top) + 'px';
  menu.querySelector('button')?.focus({ preventScroll: true });
}

function cancelUserMessagePress() {
  if (userMessagePressTimer !== null) clearTimeout(userMessagePressTimer);
  userMessagePressTimer = null;
  userMessagePress = null;
}

function getUserMessageBubble(target) {
  return target instanceof Element ? target.closest('.msg-row.user .bubble') : null;
}

document.addEventListener('pointerdown', event => {
  if (userMessageMenu && !userMessageMenu.contains(event.target)) closeUserMessageMenu();
  cancelUserMessagePress();
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
  const bubble = getUserMessageBubble(event.target);
  if (!bubble || bubble.classList.contains('is-editing')) return;
  if (event.target.closest('a, button, input, textarea, select')) return;
  userMessagePress = { pointerId: event.pointerId, bubble, x: event.clientX, y: event.clientY };
  userMessagePressTimer = setTimeout(() => {
    const press = userMessagePress;
    cancelUserMessagePress();
    if (press?.bubble.isConnected) openUserMessageMenu(press.bubble.closest('.msg-row.user'), press.x);
  }, 540);
});

document.addEventListener('pointermove', event => {
  if (!userMessagePress || userMessagePress.pointerId !== event.pointerId) return;
  if (Math.hypot(event.clientX - userMessagePress.x, event.clientY - userMessagePress.y) > 12) {
    cancelUserMessagePress();
  }
}, { passive: true });

document.addEventListener('pointerup', cancelUserMessagePress);
document.addEventListener('pointercancel', cancelUserMessagePress);

document.addEventListener('contextmenu', event => {
  const bubble = getUserMessageBubble(event.target);
  if (!bubble || bubble.classList.contains('is-editing')) return;
  event.preventDefault();
  cancelUserMessagePress();
  openUserMessageMenu(bubble.closest('.msg-row.user'), event.clientX);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    const bubble = activeUserMessageRow?.querySelector('.bubble');
    closeUserMessageMenu();
    bubble?.focus({ preventScroll: true });
    return;
  }
  const bubble = getUserMessageBubble(event.target);
  if (!bubble || event.target !== bubble || bubble.classList.contains('is-editing')) return;
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault();
    openUserMessageMenu(bubble.closest('.msg-row.user'));
  }
});

document.addEventListener('scroll', () => { if (activeUserMessageRow) closeUserMessageMenu(); }, true);
window.addEventListener('resize', () => { if (activeUserMessageRow) closeUserMessageMenu(); });

// ══════════════════════════════════════════
// MARKED RENDERER — dengan hljs + Excel
// ══════════════════════════════════════════
const renderer = new marked.Renderer();

renderer.code = function(code, language) {
  // Marked v2 vs v4 compat
  const rawLang = (typeof code === 'object' ? (code.lang || '') : (language || ''));
  const text    = typeof code === 'object' ? (code.text || code) : code;

  // Auto-detect bahasa
  const lang = detectLanguage(String(text), rawLang ? rawLang.toLowerCase() : '');

  // Syntax highlighting
  const highlighted = applyHighlight(String(text), lang);

  // Warna titik di header sesuai bahasa
  const dotColor = LANG_DOTS[lang] || LANG_DOTS['code'];

  return `<div class="code-window">
  <div class="code-header">
    <span class="code-header-lang">
      <span class="lang-dot" style="background:${dotColor};color:${dotColor};"></span>
      ${lang ? lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase() : 'Code'}
    </span>
    <div class="code-header-actions">
      <button class="copy-code-btn" type="button" data-action="toggle-code-window">
        <i class="fas fa-chevron-up"></i> <span class="btn-text">Minimize</span>
      </button>
      <button class="copy-code-btn" type="button" data-action="copy-code-window">
        <i class="fas fa-copy"></i> Copy
      </button>
    </div>
  </div>
  <div class="code-scroll-area">
    <pre class="hljs-pre"><code class="hljs">${highlighted}</code></pre>
</div>
</div>`;
};

// In-flight code fences stay lightweight; full syntax highlight runs once after completion.
const streamingMarkdownRenderer = new marked.Renderer();
streamingMarkdownRenderer.code = function(code) {
  const raw = typeof code === 'object' ? (code.text || '') : code;
  return '<pre class="aai-stream-code"><code>' + escHtml(String(raw || '')) + '</code></pre>';
};

marked.setOptions({ renderer, breaks: true });

document.addEventListener('click', event => {
  const actionBtn = event.target.closest('.code-window [data-action]');
  if (!actionBtn) return;

  const action = actionBtn.getAttribute('data-action');
  if (action === 'toggle-code-window') {
    event.preventDefault();
    toggleCodeWindow(actionBtn);
    return;
  }

  if (action === 'copy-code-window') {
    event.preventDefault();
    copyCodeWindow(actionBtn);
  }
});

function copyCodeWindow(btn) {
  const pre = btn.closest('.code-window').querySelector('pre');
  navigator.clipboard.writeText(pre.textContent);
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-check"></i> Copied!'; btn.style.color = '#a5d6ff';
  setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
}

function toggleCodeWindow(btn) {
  const codeWindow = btn.closest('.code-window');
  const scrollArea = codeWindow.querySelector('.code-scroll-area');
  const pre        = codeWindow.querySelector('pre');
  const icon       = btn.querySelector('i');
  const span       = btn.querySelector('.btn-text');

  const isMin = codeWindow.classList.toggle('minimized');

  if (isMin) {
    pre.classList.add('minimized');
    scrollArea.style.maxHeight = '0px';
    icon.className = 'fas fa-chevron-down';
    span.textContent = 'Expand';
    codeWindow.classList.remove('scrolled');
  } else {
    pre.classList.remove('minimized');
    scrollArea.style.maxHeight = '';
    codeWindow.classList.remove('minimized');
    icon.className = 'fas fa-chevron-up';
    span.textContent = 'Minimize';
  }

  requestAnimationFrame(scheduleStickyCodeHeadersUpdate);
}
function formatContent(text, { streaming = false } = {}) {
  if (!text) return "<em style='color:#e74c3c;'>⚠️ Respons kosong.</em>";
  let preppedText = String(text || '')
    .replace(/\[SUGGEST-FRIEND:[\s\S]*?\]/gi,
      '<span style="display:inline-block;font-size:11px;line-height:1.2;padding:2px 7px;border-radius:999px;background:rgba(90,180,212,.14);color:#1f5f85;font-weight:600;">Teman baru terdeteksi</span>')
    .replace(/\[MEMORY(?::[\s\S]*?)?\]/gi,
      '<span style="display:inline-block;font-size:11px;line-height:1.2;padding:2px 7px;border-radius:999px;background:rgba(46,125,50,.14);color:#2e7d32;font-weight:700;">&lt;memory&gt;</span>')
    .replace(/\[MEMORY_FORGET(?::[\s\S]*?)?\]/gi,
      '<span style="display:inline-block;font-size:11px;line-height:1.2;padding:2px 7px;border-radius:999px;background:rgba(46,125,50,.14);color:#2e7d32;font-weight:700;">&lt;memory&gt;</span>')
    .replace(/\[type=pattern;category=[^\]]*;key=[^\]]*;value=[^\]]*\]/gi, '');

  let html = marked.parse(preppedText, streaming ? { renderer: streamingMarkdownRenderer, breaks: true } : undefined);
  html = html.replace(/Sumber:\s*(https?:\/\/[^\s<]+)/gi,
    `<div class="source-card">🌐 <a href="$1" target="_blank" rel="noopener noreferrer" style="color:#2a7a9e">$1</a></div>`);

  if (typeof DOMPurify === 'undefined') {
    const fallbackText = String(text || '')
      .replace(/\[SUGGEST-FRIEND:[\s\S]*?\]/gi, 'Teman baru terdeteksi')
      .replace(/\[MEMORY(?::[\s\S]*?)?\]/gi, '<memory>')
      .replace(/\[MEMORY_FORGET(?::[\s\S]*?)?\]/gi, '<memory>')
      .replace(/\[type=pattern;category=[^\]]*;key=[^\]]*;value=[^\]]*\]/gi, '');
    return `<div class="streaming-plain">${escHtml(fallbackText).replace(/\n/g, '<br>')}</div>`;
  }

  const safeHtml = DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-action', 'target', 'rel', 'style']
  });
  return makeReadableMarkdownTables(compactExternalLinks(safeHtml));
}

// Keep URLs in href but display concise, human-readable source names.
function compactExternalLinks(sanitizedHtml) {
  if (!sanitizedHtml.includes('<a ')) return sanitizedHtml;
  const fragment = document.createElement('template');
  fragment.innerHTML = sanitizedHtml;
  fragment.content.querySelectorAll('a[href]').forEach(link => {
    let url;
    try { url = new URL(link.getAttribute('href'), location.href); } catch { return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === location.origin) return;
    const hostname = url.hostname.replace(/^www\./i, '');
    const visible = (link.textContent || '').trim();
    const looksLikeUrl = /^(?:https?:\/\/|www\.)/i.test(visible);
    const isNumericCitation = /^(?:\[?\d{1,3}\]?|sumber\s*\d{1,3})$/i.test(visible);
    if (looksLikeUrl || isNumericCitation || !visible) {
      let conciseName = hostname;
      if (/(^|\.)nodejs\.org$/i.test(hostname)) conciseName = 'Node.js';
      else if (/(^|\.)github\.com$/i.test(hostname)) conciseName = 'GitHub';
      else if (/(^|\.)wikipedia\.org$/i.test(hostname)) conciseName = 'Wikipedia';
      else if (/(^|\.)risingstack\.com$/i.test(hostname)) conciseName = 'RisingStack';
      else if (/(^|\.)supabase\.com$/i.test(hostname)) conciseName = 'Supabase';
      else if (/(^|\.)openai\.com$/i.test(hostname)) conciseName = 'OpenAI';
      link.textContent = conciseName;
    }
    link.classList.add('aai-source-link');
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    link.setAttribute('aria-label', (link.textContent || hostname).trim() + ' — buka situs eksternal');

    if (!link.querySelector('.aai-inline-source-icon') && !link.querySelector('img')) {
      const iconWrap = document.createElement('span');
      iconWrap.className = 'aai-inline-source-icon';
      iconWrap.setAttribute('aria-hidden', 'true');
      const fallback = document.createElement('i');
      fallback.className = 'fas fa-globe';
      const favicon = document.createElement('img');
      favicon.className = 'aai-inline-source-favicon';
      favicon.setAttribute('data-aai-favicon', '');
      favicon.src = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostname) + '&sz=32';
      favicon.alt = '';
      favicon.width = 14;
      favicon.height = 14;
      favicon.loading = 'lazy';
      favicon.referrerPolicy = 'no-referrer';
      iconWrap.append(fallback, favicon);
      link.prepend(iconWrap);
    }
  });
  return fragment.innerHTML;
}

// Wide Markdown tables are readable cards; no horizontal five-column squinting.
function makeReadableMarkdownTables(sanitizedHtml) {
  if (!sanitizedHtml.includes('<table')) return sanitizedHtml;
  const fragment = document.createElement('template');
  fragment.innerHTML = sanitizedHtml;
  fragment.content.querySelectorAll('table').forEach(table => {
    const headings = Array.from(table.querySelectorAll('thead th')).map(th =>
      (th.textContent || '').trim().slice(0, 90)
    );
    if (headings.length < 4) return;
    table.classList.add('aai-table-cards');
    table.querySelectorAll('tbody tr').forEach(row => {
      Array.from(row.children).forEach((cell, index) => {
        if (!cell.matches('td, th')) return;
        cell.setAttribute('data-label', headings[index] || 'Detail');
      });
    });
  });
  return fragment.innerHTML;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function scrollBottom(force = false) {
  const chatArea = document.getElementById('chatArea');
  if (!chatArea) return;

  const applyScroll = () => {
    scrollBottomFrame = null;
    chatArea.scrollTop = chatArea.scrollHeight;
  };

  if (force) {
    if (scrollBottomFrame) cancelAnimationFrame(scrollBottomFrame);
    applyScroll();
    return;
  }

  if (scrollBottomFrame) return;
  scrollBottomFrame = requestAnimationFrame(applyScroll);
}

// ══════════════════════════════════════════
// SETTINGS / PERSONA
// ══════════════════════════════════════════
function toggleSettingsMenu() {
  const menu = document.getElementById('settingsMenu');
  menu.classList.toggle('show');
  if (menu.classList.contains('show')) renderSettingsMenu();
}
function renderSettingsMenu() {
  let html = '<div class="settings-header">Model AI · pilih manual</div>';
  const models = [
    { val: 'main', label: '⚡ Qwen · utama' },
    { val: 'free-auto', label: '🪄 Model gratis · otomatis (OpenRouter)' }
  ];
  models.forEach(m => {
    html += `<button class="settings-item ${currentModelPreference===m.val?'active':''}" onclick="selectModelUI('${m.val}')">
      <span>${m.label}</span><i class="fas fa-check check"></i>
    </button>`;
  });
  html += '<p class="model-test-note">Pilihan model disimpan di perangkat ini. Rute gratis dipilih otomatis oleh OpenRouter; ketersediaan dapat berubah.</p>';
  document.getElementById('settingsMenu').innerHTML = html;
}
function selectModelUI(val) {
  if (val !== 'main' && val !== 'free-auto') return;
  currentModelPreference = val;
  localStorage.setItem('aai_model_preference', val);
  updateModeLabel();
  renderSettingsMenu();
}


document.addEventListener('click', e => {
  const w = document.querySelector('.settings-wrapper');
  if (w && !w.contains(e.target)) document.getElementById('settingsMenu').classList.remove('show');
});

// ══════════════════════════════════════════
// ✅ FIX 1: ENTER KEY — HP = ganti baris, Desktop = kirim
// ══════════════════════════════════════════
function handleKey(e) {
  if (e.key !== 'Enter' || e.shiftKey) return;

  const inp = document.getElementById('messageInput');
  const val = inp.value;
  const pos = inp.selectionStart;

  // Cari baris aktif saat ini
  const lineStart  = val.lastIndexOf('\n', pos - 1) + 1;
  const currentLine = val.substring(lineStart, pos);

  // Cocokkan pola "1. teks" atau "12. teks"
  const match = currentLine.match(/^(\d+)\.\s(.*)/);
  if (match) {
    e.preventDefault();
    if (match[2].trim() === '') {
      // Item kosong → batalkan list, hapus "N. " di baris ini
      inp.value = val.substring(0, lineStart) + val.substring(pos);
      inp.selectionStart = inp.selectionEnd = lineStart;
    } else {
      // Lanjutkan penomoran
      const next = parseInt(match[1]) + 1;
      const ins  = '\n' + next + '. ';
      inp.value = val.substring(0, pos) + ins + val.substring(pos);
      inp.selectionStart = inp.selectionEnd = pos + ins.length;
    }
    autoResize(inp);
    return;
  }

  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (!isTouchDevice) {
    e.preventDefault();
    handleSend();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

// ── File Upload Logic ──
document.getElementById('fileInput').addEventListener('change', function(e) {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    if (!selectedFiles.find(f => f.name === file.name && f.size === file.size)) {
      selectedFiles.push(file);
    }
  });
  renderFilePreview();
  this.value = '';
});

function renderFilePreview() {
  const container = document.getElementById('filePreview');
  container.innerHTML = '';
  selectedFiles.forEach((file, index) => {
    const div = document.createElement('div');
    div.className = 'file-preview-item';
    const isImage = file.type.startsWith('image/');
    div.innerHTML = `
      ${isImage
        ? `<img src="${URL.createObjectURL(file)}" alt="preview">`
        : `<i class="fas fa-file-alt file-icon"></i>`
      }
      <div class="file-name">${file.name}</div>
      <span class="remove-file" onclick="removeFile(${index})">×</span>
    `;
    container.appendChild(div);
  });
  updateMobileSendVisibility();
}

function removeFile(index) {
  const file = selectedFiles[index];
  if (file && file.type.startsWith('image/')) {
    const img = document.querySelectorAll('.file-preview-item img')[index];
    if (img) URL.revokeObjectURL(img.src);
  }
  selectedFiles.splice(index, 1);
  renderFilePreview();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
  });
}

async function handleSend() {
  const inp = document.getElementById('messageInput');
  const text = inp.value.trim();
  if (!text && selectedFiles.length === 0) return;

  const sendBtn = document.getElementById('sendBtn');
  const originalHTML = sendBtn.innerHTML;
  sendBtn.disabled = true;
  sendBtn.innerHTML = '⏳';

  try {
    if (selectedFiles.length === 0) {
      const handled = await handlePlanningCommand(text);
      if (handled) {
        inp.value = '';
        autoResize(inp);
        updateMobileSendVisibility();
        return;
      }
    }

    const oversized = selectedFiles.find(f => f.size > 2 * 1024 * 1024);
    if (oversized) throw new Error(`File "${oversized.name}" >2MB. Kompres dulu ya.`);

    const filesPayload = await Promise.all(selectedFiles.map(async f => ({
      name: f.name, type: f.type, base64: await fileToBase64(f)
    })));

    inp.value = ''; autoResize(inp); updateMobileSendVisibility();
    const previewContainer = document.getElementById('filePreview');
    previewContainer.classList.add('fading-out');

    sendMessage(text, filesPayload);

    setTimeout(() => {
      selectedFiles = [];
      renderFilePreview();
      previewContainer.classList.remove('fading-out');
    }, 300);

  } catch (err) {
    console.error('❌ Gagal kirim:', err);
    await showAlertMessage(err.message || 'Terjadi kesalahan.', 'Pengiriman Gagal');
    document.getElementById('filePreview').classList.remove('fading-out');
  } finally {
    sendBtn.disabled = false;
    if (!sendBtn.classList.contains('stop-mode')) sendBtn.innerHTML = originalHTML;
  }
}

function setHistoryDrawerOpen(isOpen) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('open', Boolean(isOpen));
  const toggle = document.querySelector('.hamburger');
  if (toggle) toggle.setAttribute('aria-expanded', String(Boolean(isOpen)));
  document.body.classList.toggle('aai-drawer-visible', Boolean(isOpen));
}
function toggleSidebar() {
  setHistoryDrawerOpen(!document.getElementById('sidebar')?.classList.contains('open'));
}
document.addEventListener('click', (event) => {
  const drawer = document.getElementById('sidebar');
  if (!drawer?.classList.contains('open')) return;
  if (event.target.closest('.aai-drawer-backdrop')) return;
  if (event.target.closest('.hamburger') || event.target.closest('.aai-drawer-close')) return;
  if (event.target.closest('.session-item')) setHistoryDrawerOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setHistoryDrawerOpen(false);
});
async function logout() {
  const shouldLogout = await showConfirmMessage('Yakin mau keluar?', 'Konfirmasi Logout', 'Keluar', 'Batal');
  if (!shouldLogout) return;
  clearStoredSessionState();
  localStorage.removeItem('aai_user');
  await clearRuntimeCaches();
  window.location.href = '/login';
}

// === STICKY HEADER + TRANSPARENT BACKGROUND ===
function updateStickyCodeHeaders() {
  const chatArea = document.getElementById('chatArea');
  if (!chatArea) return;

  const chatRect = chatArea.getBoundingClientRect();
  document.querySelectorAll('.code-window').forEach(codeWindow => {
    const header = codeWindow.querySelector('.code-header');
    if (!header || codeWindow.classList.contains('minimized')) {
      codeWindow.classList.remove('scrolled');
      return;
    }

    const headerRect = header.getBoundingClientRect();
    const windowRect = codeWindow.getBoundingClientRect();
    const isPinned = headerRect.top <= chatRect.top + 1;
    const hasVisibleBody = windowRect.bottom > chatRect.top + headerRect.height + 12;

    codeWindow.classList.toggle('scrolled', isPinned && hasVisibleBody);
  });
}

function initStickyCodeHeaders() {
  const chatArea = document.getElementById('chatArea');
  if (!chatArea) return;

  if (!chatArea.dataset.codeStickyBound) {
    chatArea.addEventListener('scroll', scheduleStickyCodeHeadersUpdate, { passive: true });
    chatArea.dataset.codeStickyBound = 'true';
  }

  scheduleStickyCodeHeadersUpdate();
}

// ══════════════════════════════════════════
// COMPACT CHECKPOINT
// ══════════════════════════════════════════
async function sendCompactCheckpoint() {
  if (!currentSessionId) {
    await showAlertMessage('Mulai obrolan terlebih dahulu.', 'Compact Belum Bisa Dipakai');
    return;
  }
  sendMessage('[COMPACT_CHECKPOINT_REQUEST]');
}

function syncWebToolPermissionUI() {
  const button = document.getElementById('webPermissionBtn');
  if (!button) return;
  const enabled = currentWebPermission === 'allow';
  button.setAttribute('aria-checked', String(enabled));
  button.classList.toggle('is-on', enabled);
  const status = document.getElementById('webPermissionStatus');
  if (status) status.textContent = enabled
    ? 'Aktif · AAi boleh memakai Tavily/Exa bila perlu'
    : 'Nonaktif · AAi menjawab tanpa pencarian web';
  const indicator = button.querySelector('.composer-web-switch i');
  if (indicator) indicator.className = enabled ? 'fas fa-toggle-on' : 'fas fa-toggle-off';
}

function toggleWebToolPermission() {
  currentWebPermission = currentWebPermission === 'allow' ? 'deny' : 'allow';
  localStorage.setItem('aai_web_tool_permission', currentWebPermission);
  syncWebToolPermissionUI();
}

function closeComposerMenu({ restoreFocus = false } = {}) {
  const menu = document.getElementById('composerActionMenu');
  const button = document.getElementById('composerPlusBtn');
  if (!menu || !button) return;
  menu.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  if (restoreFocus) button.focus({ preventScroll: true });
}

function toggleComposerMenu() {
  const menu = document.getElementById('composerActionMenu');
  const button = document.getElementById('composerPlusBtn');
  if (!menu || !button) return;
  const willOpen = menu.hidden;
  if (!willOpen) {
    closeComposerMenu({ restoreFocus: true });
    return;
  }
  menu.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  syncWebToolPermissionUI();
  menu.querySelector('button')?.focus({ preventScroll: true });
}

function runComposerAction(action) {
  if (action === 'web-permission') {
    toggleWebToolPermission();
    return; // Keep the menu open so the explicit permission state is visible.
  }
  closeComposerMenu();
  if (action === 'upload') {
    document.getElementById('fileInput')?.click();
  } else if (action === 'compact') {
    void sendCompactCheckpoint();
  }
}

function initComposerUI() {
  const messageInput = document.getElementById('messageInput');
  if (messageInput && !messageInput.dataset.aaiBound) {
    messageInput.addEventListener('input', updateMobileSendVisibility);
    messageInput.dataset.aaiBound = 'true';
  }

  const menu = document.getElementById('composerActionMenu');
  if (menu && !menu.dataset.aaiMenuBound) {
    menu.dataset.aaiMenuBound = 'true';
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('.composer-plus-wrap')) closeComposerMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault();
        closeComposerMenu({ restoreFocus: true });
      }
    });
    menu.addEventListener('keydown', event => {
      const buttons = Array.from(menu.querySelectorAll('button'));
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const offset = event.key === 'ArrowDown' ? 1 : -1;
        buttons[(index + offset + buttons.length) % buttons.length]?.focus();
      }
    });
  }

  updateModeLabel();
  updateCompactStatus();
  updateMobileSendVisibility();
  syncWebToolPermissionUI();
}





// ══════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// FRIEND SUGGESTION HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

function showFriendSuggestionModal(friendName, introMessage) {
  const modal = document.getElementById('friendSuggestionModal');
  if (!modal) return;

  pendingFriendSuggestion = { friendName, introMessage };

  const titleEl = modal.querySelector('#friendSugTitle');
  const descEl = modal.querySelector('#friendSugDesc');
  const contextEl = modal.querySelector('#friendSugContext');

  if (titleEl) titleEl.textContent = 'Kenali Teman Baru';
  if (descEl) descEl.textContent = `${friendName} ingin diperkenalkan. Simpan ke memori aku supaya lebih mengenalnya ke depan? 😊`;
  if (contextEl) contextEl.textContent = introMessage || '(Tidak ada konteks perkenalan)';

  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
}

function rejectFriendSuggestion() {
  const modal = document.getElementById('friendSuggestionModal');
  if (modal) {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  }
  pendingFriendSuggestion = null;
}

async function confirmFriendSuggestion() {
  if (!pendingFriendSuggestion) {
    rejectFriendSuggestion();
    return;
  }

  const { friendName, introMessage } = pendingFriendSuggestion;
  const modal = document.getElementById('friendSuggestionModal');

  try {
    // Call the confirm-and-save API
    const res = await fetch('/api/friends/confirm-and-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.id,
        friend_name: friendName,
        relationship_type: 'teman',
        intro_message: introMessage
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Gagal menyimpan teman');
    }

    const result = await res.json();

    // Hide modal
    if (modal) {
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
    }

    // Show success message
    await showAlertMessage(
      `Baik, saya sudah ingat ${friendName} sebagai teman kamu. Senang berkenalan! 🤝`,
      'Teman Tersimpan'
    );

    pendingFriendSuggestion = null;

  } catch (err) {
    console.error('Error confirming friend:', err);
    await showAlertMessage(
      `Gagal menyimpan teman: ${err.message}`,
      'Kesalahan'
    );
  }
}

// INIT
// ══════════════════════════════════════════
async function restoreLastSession(lastSessionId) {
  const normalizedId = String(lastSessionId || '').trim();
  if (!normalizedId) return false;

  const restored = await loadSession(normalizedId, {
    allowMissingSidebar: true,
    suppressErrorState: true,
    titleHint: 'Memuat sesi...'
  });

  if (!restored) {
    currentSessionId = null;
    currentSessionMeta = null;
    clearStoredSessionState();
    return false;
  }

  await ensureSessionVisibleInSidebar(normalizedId);
  return true;
}

async function bootstrapSessionState() {
  const last = String(localStorage.getItem('aai_last_session') || '').trim();
  const restorePromise = last ? restoreLastSession(last) : Promise.resolve(false);
  const sessionsPromise = loadSessions();

  const restored = await restorePromise;
  await sessionsPromise;

  if (restored) {
    await ensureSessionVisibleInSidebar(last);
    return;
  }

  if (last) {
    const fallbackSession = sessions.find(session => session.id !== last) || sessions[0] || null;
    if (fallbackSession) {
      await loadSession(fallbackSession.id, {
        suppressErrorState: true,
        titleHint: fallbackSession.title || ''
      });
      return;
    }

    newChat();
    return;
  }

  renderSidebar();
}

function initApp() {
  initComposerUI();
  newChat({ preserveStoredSession: true });
  requestAnimationFrame(() => {
    void bootstrapSessionState();
  });
}
document.addEventListener('DOMContentLoaded', initApp);
document.addEventListener('DOMContentLoaded', initStickyCodeHeaders);
window.addEventListener('storage', event => {
  if (event.key === 'aai_user' && !event.newValue) {
    window.location.href = '/login';
  }
});
window.addEventListener('resize', () => {
  scheduleStickyCodeHeadersUpdate();
  updateMobileSendVisibility();
});
setTimeout(scheduleStickyCodeHeadersUpdate, 600);

// PWA registration and updates are handled by /assets/js/pwa.js.
