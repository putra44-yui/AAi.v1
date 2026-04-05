// ══════════════════════════════════════════
// STATE GLOBAL
// ══════════════════════════════════════════
const currentUser = JSON.parse(localStorage.getItem('aai_user') || '{}');
if (!currentUser.id) window.location.href = '/login';
if (currentUser.person_name || currentUser.username) {
  document.getElementById('cardUsername').textContent = currentUser.person_name || currentUser.username;
}
if (currentUser.family_role) {
  document.getElementById('cardFamilyRole').textContent = currentUser.family_role;
}

let sessions         = [];
let currentSessionId = null;
let currentSessionMeta = null;
let currentPersona   = localStorage.getItem('aai_persona') || 'Auto';
const currentMemoryExperimentMode = 'context-heavy';
let currentMessages  = [];
let activeVersionMap = {};
let currentUtterance = null;
let isSpeaking       = false;
let abortController  = null;
let selectedFiles    = [];
let msgboxState = null;

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
  modeLabel.textContent = currentPersona || 'Auto';
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
      btn.innerHTML = '⏹';
      btn.title = 'Hentikan';
      btn.classList.add('stop-mode');
      btn.onclick = () => {
        if (abortController) abortController.abort();
      };
    });
    updateMobileSendVisibility(true);
  } else {
    buttons.forEach(btn => {
      btn.innerHTML = '▶';
      btn.title = 'Kirim';
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
function buildStreamBubbleHTML(streamId, timeStr) {
  return `
    <div class="msg-row assistant" id="${streamId}" data-id="" data-plain-text="" data-persona="">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="avatar" style="animation:stickerFloat 3.5s ease-in-out infinite;">
          <img src="/ayaka.gif" alt="Ayaka">
        </div>
        <div style="font-weight:700;font-size:15px;color:var(--blue-dark);font-family:'Cormorant Garamond',serif;">
          AAi <span class="version-tag">V.1</span>
        </div>
      </div>
      <div class="ai-preview" id="preview_${streamId}" style="display:none;">
        <button type="button" class="ai-preview-toggle" onclick="togglePreview(this)">
          <span class="ai-preview-summary-title">🧠 AAI sedang berpikir</span>
          <i class="fas fa-chevron-down ai-preview-chevron"></i>
        </button>
        <div class="ai-preview-body" id="preview_body_${streamId}"></div>
      </div>
      <div class="ai-live-teaser" id="preview_stream_${streamId}" style="display:none;"></div>
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
  let teaserEl = aiRow.querySelector('.ai-live-teaser');
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
  aiRow.setAttribute('data-plain-text', '');
  aiRow.setAttribute('data-preview', '');
  return { bubbleEl, actionsEl };
}

function renderStreamingContent(text) {
  return `<div class="streaming-plain">${escHtml(text)}</div>`;
}

function togglePreview(btn) {
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

function renderStreamErrorUI(streamId, errorMessage) {
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
  const reader    = response.body.getReader();
  const decoder   = new TextDecoder();
  let fullText  = '';
  let buffer    = '';
  let previewData = null;
  let previewTicker = null;
  let previewStepTimer = null;
  let streamError = null;
  let firstToken = true;
  let gotDone   = false;
  let renderScheduled = false;

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
    bubbleEl.innerHTML = finalRender ? formatContent(fullText) : renderStreamingContent(fullText);
    if (finalRender) bubbleEl.classList.remove('stream-cursor');
    else bubbleEl.classList.add('stream-cursor');
    scrollBottom();
  }

  function scheduleStreamingRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      if (!gotDone) flushStreamingRender(false);
    });
  }

  function processLine(line) {
    if (!line.startsWith('data: ')) return;
    const raw = line.slice(6).trim();
    if (raw === '[DONE]') return;

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return; }

    if (parsed.error) throw new Error(parsed.error);

    if (parsed.token) {
      if (firstToken) {
        bubbleEl.innerHTML = '';
        firstToken = false;
        stopPreviewTicker('', true);
      }
      fullText += parsed.token;
      scheduleStreamingRender();
    }

    if (parsed.reasoning) {
      showPreview({
        title: 'AAI',
        streaming_title: 'AAI sedang berpikir',
        reasoning_steps: parsed.reasoning
      }, true);
    } else if (parsed.preview && !parsed.done) {
      showPreview(parsed.preview, true);
    }

    if (parsed.done) {
      gotDone = true;
      flushStreamingRender(true);
      stopPreviewTicker('', true);
      actionsEl.style.display = 'flex';
      streamRow.setAttribute('data-id', parsed.message_id || '');
      streamRow.setAttribute('data-plain-text', encodeURIComponent(fullText));
      streamRow.setAttribute('data-persona', parsed.persona_used || '');
      const finalPreview = previewData || normalizePreview(parsed.preview);
      if (finalPreview) {
        previewData = finalPreview;
        previewBodyEl.innerHTML = renderPreviewBody(finalPreview);
        previewEl.style.display = 'block';
        setPreviewTitle(finalPreview, false);
      }
      streamRow.setAttribute('data-preview', finalPreview ? encodeURIComponent(JSON.stringify(finalPreview)) : '');
      onDone(parsed, fullText, finalPreview);
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

  if (streamError) {
    stopPreviewTicker('', true);
    throw streamError;
  }

  // FALLBACK: jika stream terputus tanpa event `done` tapi sudah ada teks
  if (!gotDone && fullText.trim()) {
    console.warn('[processStream] Stream ended without done event. Fallback triggered.');
    flushStreamingRender(true);
    stopPreviewTicker('', true);
    actionsEl.style.display = 'flex';
    streamRow.setAttribute('data-plain-text', encodeURIComponent(fullText));
    streamRow.setAttribute('data-preview', previewData ? encodeURIComponent(JSON.stringify(previewData)) : '');
    onDone({ done: true, session_id: null, message_id: null, user_message_id: null }, fullText, previewData);
    scrollBottom();
  }

  setTimeout(initStickyCodeHeaders, 600);
}

// ══════════════════════════════════════════
// KIRIM PESAN BARU
// ══════════════════════════════════════════
async function sendMessage(text, files = []) {
  const area = document.getElementById('chatArea');
  const isCompactRequest = /\[COMPACT_CHECKPOINT_REQUEST\]/i.test(text);
  if (!area.querySelector('.msg-row')) area.innerHTML = '';

  appendMessage('user', text, null, { files: files });
  scrollBottom();

  const streamId = 'stream_' + Date.now();
  const timeStr  = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  area.insertAdjacentHTML('beforeend', buildStreamBubbleHTML(streamId, timeStr));
  scrollBottom();

  setSendBtn('stop');
  abortController = new AbortController();

  // Timeout 2 menit untuk respons panjang
  const timeoutId = setTimeout(() => abortController.abort(), 120000);

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
        memory_experiment_mode: currentMemoryExperimentMode,
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
      if (parsed.session_id && !currentSessionId) {
        currentSessionId = parsed.session_id;
        localStorage.setItem('aai_last_session', currentSessionId);
        setTimeout(async () => {
          await loadSessions();
          const s = sessions.find(s => s.id === currentSessionId);
          if (s) document.getElementById('topbarTitle').textContent = s.title;
        }, 2500);
      }
      const userRows = document.getElementById('chatArea').querySelectorAll('.msg-row.user');
      if (userRows.length > 0)
        userRows[userRows.length - 1].setAttribute('data-id', parsed.user_message_id || '');
      const lastAI = [...currentMessages].reverse().find(m => m.role === 'assistant');
      currentMessages.push({
        id: parsed.user_message_id, role: 'user', content: text,
        parent_id: lastAI?.id || null, created_at: new Date().toISOString()
      });
      currentMessages.push({
        id: parsed.message_id, role: 'assistant', content: fullText,
        parent_id: parsed.user_message_id, created_at: new Date().toISOString(),
        preview: preview || null,
        persona: parsed.persona_used || currentPersona
      });

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
    renderStreamErrorUI(streamId, e.message);
  } finally {
    setSendBtn('send');
  }
}

// ══════════════════════════════════════════
// REGENERATE
// ══════════════════════════════════════════
function regenerateAI(btn) {
  const aiRow   = btn.closest('.msg-row.assistant');
  const aiMsgId = aiRow.getAttribute('data-id');
  let rawUser = '', userMsgId = null;

  let el = aiRow.previousElementSibling;
  while (el) {
    if (el.classList.contains('user')) {
      rawUser   = decodeURIComponent(el.getAttribute('data-raw') || '');
      userMsgId = el.getAttribute('data-id') || null;
      break;
    }
    el = el.previousElementSibling;
  }
  if (!userMsgId && aiMsgId) {
    const aiMsg = currentMessages.find(m => m.id === aiMsgId);
    userMsgId = aiMsg?.parent_id || null;
    if (!rawUser) rawUser = currentMessages.find(m => m.id === userMsgId)?.content || '';
  }
  if (rawUser) executeRegenerate(rawUser, userMsgId, aiMsgId, aiRow);
}

async function executeRegenerate(text, userMessageId = null, assistantMessageId = null, aiRow = null) {
  const area = document.getElementById('chatArea');
  const streamId = 'regen_' + Date.now();

  // Reuse existing assistant row for smooth UX during streaming
  if (aiRow) {
    prepareAssistantRowForStreaming(aiRow, streamId);
  } else if (assistantMessageId) {
    const rows = area.querySelectorAll('.msg-row.assistant');
    let found = false;
    for (let r of rows) {
      if (r.getAttribute('data-id') === assistantMessageId) {
        prepareAssistantRowForStreaming(r, streamId);
        found = true;
        break;
      }
    }
    if (!found) {
      const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      area.insertAdjacentHTML('beforeend', buildStreamBubbleHTML(streamId, timeStr));
    }
  } else {
    const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    area.insertAdjacentHTML('beforeend', buildStreamBubbleHTML(streamId, timeStr));
  }
  scrollBottom();

  setSendBtn('stop');
  abortController = new AbortController();
  const frozenPersona =
    aiRow?.getAttribute('data-persona') ||
    (assistantMessageId ? currentMessages.find(m => m.id === assistantMessageId)?.persona : null) ||
    currentPersona;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortController.signal,
      body: JSON.stringify({
        message: text,
        session_id: currentSessionId,
        user_id: currentUser.id,
        persona_name: frozenPersona,
        memory_experiment_mode: currentMemoryExperimentMode,
        consistency_mode: true,
        user_message_id: userMessageId
        // NO assistant_message_id — creates a new sibling for version navigation
      })
    });

    if (!res.ok) {
      let errMsg = `Server error ${res.status}`;
      try { const d = await res.json(); errMsg = d.error || errMsg; }
      catch { try { errMsg = (await res.text()) || errMsg; } catch {} }
      throw new Error(errMsg);
    }

    await processStream(res, streamId, (parsed, fullText, preview) => {
      // Push as new sibling message (not update existing)
      currentMessages.push({
        id: parsed.message_id, role: 'assistant', content: fullText,
        parent_id: userMessageId, created_at: new Date().toISOString(),
        preview: preview || null,
        persona: parsed.persona_used || frozenPersona
      });
      // Select the new version
      if (userMessageId) activeVersionMap[userMessageId] = parsed.message_id;
      renderMessageTree();
    });

    } catch (e) {
    console.error('❌ Regenerate Error:', e);
    renderStreamErrorUI(streamId, e.message);
  } finally {
    setSendBtn('send');
  }
}

// ══════════════════════════════════════════
// TOMBOL "COBA LAGI"
// ══════════════════════════════════════════
function retryLastMessage(btn) {
  const aiRow = btn.closest('.msg-row.assistant');
  const aiMsgId = aiRow.getAttribute('data-id') || null;
  let el = aiRow.previousElementSibling;
  while (el) {
    if (el.classList.contains('user')) {
      const raw       = decodeURIComponent(el.getAttribute('data-raw') || '');
      const userMsgId = el.getAttribute('data-id') || null;
      if (raw) {
        // PENTING: Jangan remove aiRow jika aiMsgId null, agar bisa tetap di sesi yang sama
        // Hanya perbarui eksisting bubble untuk retry
        executeRegenerate(raw, userMsgId, aiMsgId, aiRow);
      }
      return;
    }
    el = el.previousElementSibling;
  }
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
  bubble.innerHTML = bubble.dataset.originalHtml;
}

async function saveEdit(btn, msgId) {
  const bubble = btn.closest('.bubble');
  const row    = btn.closest('.msg-row.user');
  if (!row || !bubble) return;

  const newText = bubble.querySelector('textarea').value.trim();
  if (!newText) return;

  bubble.innerHTML = formatContent(newText);
  row.setAttribute('data-raw', encodeURIComponent(newText));

  let assistantMsgId = null;
  let nextRow = row.nextElementSibling;
  while (nextRow) {
    if (nextRow.classList.contains('assistant')) {
      assistantMsgId = nextRow.getAttribute('data-id') || null;
      break;
    }
    nextRow = nextRow.nextElementSibling;
  }
  if (!assistantMsgId) {
    assistantMsgId = activeVersionMap[msgId]
      || [...currentMessages].reverse().find(m => m.parent_id === msgId && m.role === 'assistant')?.id
      || null;
  }

  try {
    const res = await fetch(`/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        edit_message_id: msgId,
        update_only: true,
        message: newText,
        session_id: currentSessionId,
        user_id: currentUser.id,
        memory_experiment_mode: currentMemoryExperimentMode,
        persona_name: currentPersona
      })
    });
    if (!res.ok) throw new Error('Gagal update');
    const msg = currentMessages.find(m => m.id === msgId);
    if (msg) msg.content = newText;
    renderMessageTree();
    const refreshedAssistantRow = assistantMsgId
      ? document.querySelector(`.msg-row.assistant[data-id="${assistantMsgId}"]`)
      : null;
    executeRegenerate(newText, msgId, assistantMsgId, refreshedAssistantRow);
  } catch (e) {
    await showAlertMessage(`Gagal menyimpan perubahan: ${e.message}`, 'Edit Gagal');
    renderMessageTree();
  }
}

// ══════════════════════════════════════════
// KIRIM PESAN DARI EDIT (branched)
// ══════════════════════════════════════════
async function sendMessageBranched(text, parentId = null) {
  const area     = document.getElementById('chatArea');
  appendMessage('user', text);
  scrollBottom();

  const streamId = 'branch_' + Date.now();
  const timeStr  = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  area.insertAdjacentHTML('beforeend', buildStreamBubbleHTML(streamId, timeStr));
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
        session_id: currentSessionId,
        user_id: currentUser.id,
        persona_name: currentPersona,
        memory_experiment_mode: currentMemoryExperimentMode,
        parent_id: parentId
      })
    });

    if (!res.ok) {
      let errMsg = `Server error ${res.status}`;
      try { const d = await res.json(); errMsg = d.error || errMsg; }
      catch { try { errMsg = (await res.text()) || errMsg; } catch {} }
      throw new Error(errMsg);
    }

    await processStream(res, streamId, (parsed, fullText, preview) => {
      currentMessages.push({
        id: parsed.user_message_id, role: 'user', content: text,
        parent_id: parentId, created_at: new Date().toISOString()
      });
      currentMessages.push({
        id: parsed.message_id, role: 'assistant', content: fullText,
        parent_id: parsed.user_message_id, created_at: new Date().toISOString(),
        preview: preview || null,
        persona: parsed.persona_used || currentPersona
      });
      if (parentId) activeVersionMap[parentId] = parsed.user_message_id;
    });

    } catch (e) {
    console.error('❌ Branched Message Error:', e);
    renderStreamErrorUI(streamId, e.message);
  } finally {
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
  } catch (e) {
    logDebug(`Gagal load sessions: ${e.message}`, '#e74c3c');
    sessions = []; renderSidebar();
  }
}

async function loadSession(id) {
  currentSessionId = id;
  localStorage.setItem('aai_last_session', id);
  const session = sessions.find(s => s.id === id);
  currentSessionMeta = session || null;
  updateCompactStatus();
  document.getElementById('topbarTitle').textContent = session?.title || 'AAi';
  currentMessages  = [];
  activeVersionMap = {};
  document.getElementById('chatArea').innerHTML = `
    <div style="padding:60px;text-align:center;color:var(--text-muted);">
      <i class="fas fa-spinner fa-spin" style="font-size:28px;"></i>
      <p style="margin-top:12px;">Memuat percakapan...</p>
    </div>`;
  try {
    const res = await fetch(`/api/chat?session_id=${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.messages)) {
      currentMessages = data.messages;
      renderMessageTree();
    } else throw new Error("Format data tidak valid");
    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
    renderSidebar();
  } catch (e) {
    logDebug(`Error load session: ${e.message}`, '#e74c3c');
    document.getElementById('chatArea').innerHTML =
      `<div style="padding:40px;text-align:center;color:#e74c3c;">⚠️ Gagal memuat: ${e.message}</div>`;
  }
}

function renderSidebar() {
  const container = document.getElementById('sessionList');
  container.innerHTML = '';
  if (!sessions.length) {
    container.innerHTML = `<p style="padding:24px;text-align:center;color:var(--text-muted);font-size:14px;">Belum ada obrolan.<br>Mulai yang baru di atas 👆</p>`;
    return;
  }
  sessions.forEach(s => {
    const item = document.createElement('div');
    item.className = `session-item ${s.id === currentSessionId ? 'active' : ''}`;
    item.innerHTML = `
      <div style="flex:1;display:flex;align-items:center;gap:12px;overflow:hidden;">
        <div style="width:9px;height:9px;background:#5ab4d4;border-radius:50%;flex-shrink:0;"></div>
        <span style="flex:1;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(s.title || 'Obrolan')}</span>
      </div>
      <div class="session-actions">
        <button class="action-btn" title="Edit"
          data-sid="${s.id}" data-title="${escHtml(s.title || '')}"
          onclick="event.stopImmediatePropagation();renameSession(this.dataset.sid, this.dataset.title)">✏️</button>
        <button class="action-btn" title="Hapus"
          onclick="event.stopImmediatePropagation();deleteSession('${s.id}')">🗑️</button>
      </div>`;
    item.onclick = (e) => { if (e.target.tagName !== 'BUTTON') loadSession(s.id); };
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
    await fetch(`/api/sessions/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() })
    });
  } catch { loadSessions(); }
}

let sessionToDelete = null;
function deleteSession(id) { sessionToDelete = id; document.getElementById('deleteModal').classList.add('active'); }
function closeDeleteModal() { sessionToDelete = null; document.getElementById('deleteModal').classList.remove('active'); }
document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
  if (!sessionToDelete) return;
  const id = sessionToDelete; closeDeleteModal();
  try {
    const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    if (res.ok) { if (currentSessionId === id) newChat(); loadSessions(); }
  } catch (e) { console.error("Gagal hapus:", e); }
});

function newChat() {
  currentSessionId = null;
  currentSessionMeta = null;
  localStorage.removeItem('aai_last_session');
  currentMessages  = [];
  activeVersionMap = {};
  document.getElementById('chatArea').innerHTML = `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;text-align:center;padding:0 40px;">
      <div class="avatar" style="width:280px;height:280px;margin-bottom:24px;animation:stickerFloat 2.5s ease-in-out infinite;background:transparent;">
        <img src="/ayaka1.gif" alt="Ayaka" style="width:100%;height:100%;object-fit:contain;">
      </div>
      <h2 style="font-family:'Cormorant Garamond',serif;font-size:36px;color:var(--text);">Halo, ${currentUser.username}! 👋</h2>
      <p style="max-width:320px;color:var(--text-muted);font-size:16px;">AAi siap bantu kamu hari ini.</p>
    </div>`;
  document.getElementById('topbarTitle').textContent = 'AAi';
  updateCompactStatus(false);
  updateMobileSendVisibility(false);
  renderSidebar();
}

// ══════════════════════════════════════════
// MESSAGE TREE
// ══════════════════════════════════════════
function buildActiveBranch() {
  if (!currentMessages.length) return [];
  const allIds = new Set(currentMessages.map(m => m.id));
  let current = currentMessages.find(m => !m.parent_id || !allIds.has(m.parent_id));
  if (!current) current = [...currentMessages].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
  if (!current) return [];
  const branch = [current];
  while (true) {
    const children = currentMessages.filter(m => m.parent_id === current.id);
    if (!children.length) break;
    const selectedId = activeVersionMap[current.id];
    current = (selectedId && children.find(c => c.id === selectedId)) || children[children.length - 1];
    branch.push(current);
  }
  return branch;
}

function switchVersion(id) {
  const msg = currentMessages.find(m => m.id === id);
  if (!msg?.parent_id) return;
  activeVersionMap[msg.parent_id] = id;
  renderMessageTree(); scrollBottom();
}

function renderMessageTree() {
  const area   = document.getElementById('chatArea');
  const branch = buildActiveBranch();
  if (!branch.length) { logDebug('Branch kosong, skip render', '#e67e22'); return; }
  area.innerHTML = '';
  branch.forEach(m => {
    const siblings = currentMessages.filter(s => s.parent_id === m.parent_id && s.role === m.role);
    const idx      = siblings.findIndex(s => s.id === m.id);
    const extra = m.role === 'assistant'
      ? { preview: m.preview || null, persona: m.persona || '' }
      : null;
    appendMessage(m.role, m.content, m.created_at, null, m.id, {
      total: siblings.length, current: idx + 1, siblings: siblings.map(s => s.id)
    }, extra);
  });
  scrollBottom();
  setTimeout(initStickyCodeHeaders, 400);
}

// ══════════════════════════════════════════
// APPEND MESSAGE
// ══════════════════════════════════════════
function appendMessage(role, content, timestamp = null, metadata = null, messageId = null, versionInfo = null, extra = null) {
  const area = document.getElementById('chatArea');
  const time = timestamp
    ? new Date(timestamp).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' })
    : new Date().toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });

  let html = '';

  if (role === 'assistant') {
    const previewBlock = extra?.preview ? buildPreviewPanelHTML(extra.preview) : '';

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
    let versionHtml = `<span class="version-tag">V.1</span>`;
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
    <div class="msg-row assistant" data-id="${messageId||''}" data-plain-text="${encodeURIComponent(content)}" data-preview="${extra?.preview ? encodeURIComponent(JSON.stringify(extra.preview)) : ''}" data-persona="${escHtml(extra?.persona || '')}">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="avatar" style="animation:stickerFloat 3.5s ease-in-out infinite;">
          <img src="/ayaka.gif" alt="Ayaka">
        </div>
        <div style="font-weight:700;font-size:15px;color:var(--blue-dark);font-family:'Cormorant Garamond',serif;"> ${versionHtml}</div>
      </div>
      ${previewBlock}
      <div class="bubble">${formatContent(content)}</div>
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
    <div class="msg-row user" data-raw="${encodeURIComponent(content)}" data-id="${messageId||''}">
      <div class="user-bubble-wrap">
        <div class="bubble">${formatContent(content)}</div>
        ${filesHtml}
        <div class="user-actions">
          <span style="font-size:11px;opacity:.65;margin-right:auto;">${time}</span>
          <button title="Edit" onclick="editUserMsg(this)"><i class="fas fa-pen"></i></button>
          <button title="Copy" onclick="copyUserMsg(this)"><i class="far fa-copy"></i></button>
        </div>
      </div>
    </div>`;
  }

  area.insertAdjacentHTML('beforeend', html);
  scrollBottom();
}

// ══════════════════════════════════════════
// COPY
// ══════════════════════════════════════════
function copyUserMsg(btn) {
  navigator.clipboard.writeText(btn.closest('.user').querySelector('.bubble').innerText);
  const i = btn.querySelector('i'); i.className = 'fas fa-check';
  setTimeout(() => i.className = 'far fa-copy', 2000);
}
function copyFullAI(btn) {
  navigator.clipboard.writeText(btn.closest('.assistant').querySelector('.bubble').innerText);
  const i = btn.querySelector('i'); i.className = 'fas fa-check'; i.style.color = '#5ab4d4';
  setTimeout(() => { i.className = 'far fa-copy'; i.style.color = 'inherit'; }, 2000);
}

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

  requestAnimationFrame(initStickyCodeHeaders);
}
function formatContent(text) {
  if (!text) return "<em style='color:#e74c3c;'>⚠️ Respons kosong.</em>";
  let html = marked.parse(text);
  html = html.replace(/Sumber:\s*(https?:\/\/[^\s<]+)/gi,
    `<div class="source-card">🌐 <a href="$1" target="_blank" rel="noopener noreferrer" style="color:#2a7a9e">$1</a></div>`);

  if (typeof DOMPurify === 'undefined') {
    return `<div class="streaming-plain">${escHtml(text).replace(/\n/g, '<br>')}</div>`;
  }

  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-action', 'target', 'rel', 'style']
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function scrollBottom() {
  const a = document.getElementById('chatArea'); a.scrollTop = a.scrollHeight;
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
  const personas = [
    { val: 'Auto',            label: '✨ Auto' },
    { val: 'Santai',          label: '😌 Santai' },
    { val: 'Coding',          label: '💻 Coding Expert' },
    { val: 'Kritikus Brutal', label: '🔥 Kritikus' },
    { val: 'Rosalia',         label: '🌹 Rosalia' }
  ];
  let html = `<div class="settings-header">Persona AI</div>`;
  personas.forEach(p => {
    html += `<button class="settings-item ${currentPersona===p.val?'active':''}" onclick="selectPersonaUI('${p.val}')">
      <span>${p.label}</span><i class="fas fa-check check"></i>
    </button>`;
  });

  document.getElementById('settingsMenu').innerHTML = html;
}
function selectPersonaUI(val) {
  currentPersona = val;
  localStorage.setItem('aai_persona', val);
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
    sendBtn.innerHTML = originalHTML;
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('open');
    return;
  }

  document.body.classList.toggle('desktop-sidebar-hidden');
}
document.addEventListener('click', e => {
  if (window.innerWidth > 768) return;
  const sidebar   = document.getElementById('sidebar');
  const hamburger = document.querySelector('.hamburger');
  if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !hamburger.contains(e.target))
    sidebar.classList.remove('open');
});
window.addEventListener('resize', () => {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  if (window.innerWidth > 768) {
    sidebar.classList.remove('open');
    return;
  }

  document.body.classList.remove('desktop-sidebar-hidden');
});
async function logout() {
  const shouldLogout = await showConfirmMessage('Yakin mau keluar?', 'Konfirmasi Logout', 'Keluar', 'Batal');
  if (!shouldLogout) return;
  localStorage.removeItem('aai_user');
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
    chatArea.addEventListener('scroll', updateStickyCodeHeaders, { passive: true });
    chatArea.dataset.codeStickyBound = 'true';
  }

  updateStickyCodeHeaders();
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

function initComposerUI() {
  const messageInput = document.getElementById('messageInput');
  if (messageInput && !messageInput.dataset.aaiBound) {
    messageInput.addEventListener('input', updateMobileSendVisibility);
    messageInput.dataset.aaiBound = 'true';
  }

  updateModeLabel();
  updateCompactStatus();
  updateMobileSendVisibility();
}





// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
async function initApp() {
  initComposerUI();
  await loadSessions();
  const last = localStorage.getItem('aai_last_session');
  if (last && sessions.find(s => s.id === last)) loadSession(last);
  else newChat();
}
document.addEventListener('DOMContentLoaded', initApp);
document.addEventListener('DOMContentLoaded', initStickyCodeHeaders);
window.addEventListener('resize', () => {
  initStickyCodeHeaders();
  updateMobileSendVisibility();
});
setTimeout(initStickyCodeHeaders, 600);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch(err => console.error('SW register gagal:', err));
  });
}
