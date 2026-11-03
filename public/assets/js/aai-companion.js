/* AAi Companion browser prototype. Same document, same session, same SSE stream.
   Cross-app Android overlay belongs to the native phase, not this web view. */
(function () {
  'use strict';
  const core = window.AAiCompanionCore;
  if (!core) return;
  const el = id => document.getElementById(id);
  const stage = el('aaiCompanionStage');
  const widget = el('aaiCompanionWidget');
  const mascot = el('aaiCompanionMascot');
  const bubble = el('aaiCompanionBubble');
  const speech = el('aaiCompanionSpeech');
  const prev = el('aaiCompanionPrev');
  const next = el('aaiCompanionNext');
  const pageLabel = el('aaiCompanionPage');
  const modeButton = el('aaiCompanionSwitch');
  const settings = el('aaiCompanionSettings');
  const settingsButton = el('aaiCompanionSettingsButton');
  const showComposer = el('aaiCompanionShowComposer');
  const showPreview = el('aaiCompanionShowPreview');
  const lowMotion = el('aaiCompanionLowMotion');
  const flyButton = el('aaiCompanionFly');
  const useMicro = el('aaiCompanionUseMicro');
  const nativeButton = el('aaiCompanionAndroidOverlay');
  const nativePlugin = window.Capacitor?.Plugins?.AAiCompanion || null;
  if (nativeButton && nativePlugin) nativeButton.hidden=false;
  const preview = el('aaiCompanionPreview');
  const previewText = el('aaiCompanionPreviewText');
  const reveal = el('aaiCompanionReveal');
  const full = el('aaiCompanionFull');
  if (!stage || !widget || !mascot || !bubble || !speech || !modeButton) return;

  let ownerId = '';
  try { ownerId = JSON.parse(localStorage.getItem('aai_user') || '{}').id || ''; } catch {}
  const key = 'aai_companion_prefs_v1_' + String(ownerId || 'local');
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch {}
  const prefs = {
    active: saved.active === true,
    composer: saved.composer !== false,
    preview: saved.preview !== false,
    lowMotion: saved.lowMotion === true,
    micro: saved.micro === true,
    x: Number.isFinite(saved.x) ? saved.x : .5,
    y: Number.isFinite(saved.y) ? saved.y : .25,
  };
  const state = {
    pages: [], index: 0, fullText: '', streaming: false, shownFromServer: false,
    status: '', recent: [], tapHistory: [], currentRequestId: null, renderScheduled: false,
    gesture: null, reactionAbort: null, reactionSequence: 0, alphaMap: null, emotion:'idle',
    microAvailable:true, lastMicroAt:0, nativeOn:false, nativeLastUpdate:0,
  };
  const persist = () => { try { localStorage.setItem(key, JSON.stringify(prefs)); } catch {} };
  const isActive = () => document.body.classList.contains('aai-companion-active');
  function nativeBubbleUpdate(force=false) {
    if (!state.nativeOn || !nativePlugin) return;
    const now=Date.now();
    if (!force && now-state.nativeLastUpdate<450) return;
    state.nativeLastUpdate=now;
    const content=(state.fullText || state.status || '').slice(0,8000);
    if (!content) return;
    void nativePlugin.update({text:content,streaming:state.streaming}).catch(() => {
      state.nativeOn=false;
      if (nativeButton) nativeButton.textContent='Aktifkan AAi di atas aplikasi lain';
    });
  }
  async function toggleNativeOverlay() {
    if (!nativePlugin) return;
    try {
      const status=await nativePlugin.status();
      if (status.running) {
        await nativePlugin.hide();
        state.nativeOn=false;
        nativeButton.textContent='Aktifkan AAi di atas aplikasi lain';
        return;
      }
      if (!status.overlayGranted) {
        await nativePlugin.requestOverlayPermission();
        nativeButton.textContent='Setelah memberi izin, ketuk lagi';
        return;
      }
      await nativePlugin.show({showComposer:prefs.composer,ownerId});
      state.nativeOn=true;
      nativeButton.textContent='Hentikan AAi di atas aplikasi lain';
      nativeBubbleUpdate(true);
    } catch {
      nativeButton.textContent='Overlay belum diizinkan · coba lagi';
    }
  }
  if (nativeButton && nativePlugin) {
    nativeButton.addEventListener('click',toggleNativeOverlay);
    void nativePlugin.status().then(status => {
      state.nativeOn=status.running===true;
      nativeButton.textContent=state.nativeOn
        ? 'Hentikan AAi di atas aplikasi lain' : 'Aktifkan AAi di atas aplikasi lain';
    }).catch(()=>{});
  }

  function layoutWidget() {
    if (!isActive()) return;
    const maxX = Math.max(0, stage.clientWidth - widget.offsetWidth - 6);
    const maxY = Math.max(0, stage.clientHeight - widget.offsetHeight - 14);
    const pos = core.clampPosition(prefs.x * maxX, prefs.y * maxY, maxX, maxY);
    widget.style.left = Math.round(pos.x) + 'px';
    widget.style.top = Math.round(pos.y) + 'px';
    widget.dataset.bubbleSide = pos.y < 22 && !bubble.hidden ? 'below' : 'above';
  }
  function savePosition(left, top) {
    const maxX = Math.max(0, stage.clientWidth - widget.offsetWidth - 6);
    const maxY = Math.max(0, stage.clientHeight - widget.offsetHeight - 14);
    const point = core.clampPosition(left, top, maxX, maxY);
    widget.style.left = point.x + 'px';
    widget.style.top = point.y + 'px';
    prefs.x = maxX ? point.x / maxX : 0;
    prefs.y = maxY ? point.y / maxY : 0;
    widget.dataset.bubbleSide = point.y < 22 ? 'below' : 'above';
    persist();
  }
  function scheduleLayout() { requestAnimationFrame(layoutWidget); }
  function renderSpeech() {
    const page = state.pages[state.index] || '';
    if (!state.pages.length && !state.status) {
      bubble.hidden = true;
      return;
    }
    bubble.hidden = false;
    speech.textContent = page || state.status || 'Aku di sini, ya. ✦';
    prev.disabled = state.index <= 0 || !state.pages.length;
    next.disabled = state.index >= state.pages.length - 1 || !state.pages.length;
    pageLabel.textContent = state.pages.length > 1
      ? (state.index + 1) + ' / ' + state.pages.length
      : (state.streaming ? 'Menjawab...' : 'AAi');
    widget.dataset.emotion = state.streaming ? (state.pages.length ? 'talk' : 'think') : state.emotion;
    scheduleLayout();
    nativeBubbleUpdate();
  }
  function showSpeech(text, type) {
    state.status = String(text || '').trim().slice(0, 200);
    state.pages = [];
    state.index = 0;
    state.fullText = '';
    state.emotion = type || 'idle';
    renderSpeech();
  }
  function renderFullText(text, keepIndex = true) {
    const oldIndex = state.index;
    state.fullText = String(text || '');
    state.emotion = 'idle';
    state.pages = core.paginateSpeech(state.fullText, 168);
    state.index = keepIndex ? Math.min(oldIndex, Math.max(state.pages.length - 1, 0)) : 0;
    state.status = state.pages.length ? '' : (state.streaming ? 'Aku sedang menyiapkan jawaban…' : '');
    renderSpeech();
  }
  function scheduleStreamRender() {
    if (state.renderScheduled) return;
    state.renderScheduled = true;
    requestAnimationFrame(() => {
      state.renderScheduled = false;
      if (isActive()) renderFullText(state.fullText);
    });
  }
  function setPreviewText(value) {
    const text = String(value || '').trim().slice(0, 420);
    previewText.textContent = text;
    preview.hidden = !prefs.preview || !text || !isActive();
  }
  function reloadLastSavedAnswer() {
    if (!isActive() || state.streaming) return;
    const rows = el('chatArea')?.querySelectorAll('.msg-row.assistant[data-plain-text]') || [];
    let answer = '';
    for (let i = rows.length - 1; i >= 0; i--) {
      const value = rows[i].getAttribute('data-plain-text');
      if (!value) continue;
      try { answer = decodeURIComponent(value); } catch { answer = value; }
      if (answer) break;
    }
    if (answer) renderFullText(answer, false);
    else {
      const raw = (el('chatArea')?.querySelector('.msg-row.assistant:last-child .bubble')?.textContent || '').trim();
      if (raw && !/^(Hai|Halo)/i.test(raw)) renderFullText(raw, false);
      else showSpeech('Aku di sini. Mau ngobrol apa? ✦');
    }
    const user = el('chatArea')?.querySelectorAll('.msg-row.user');
    const last = user && user.length ? user[user.length - 1] : null;
    if (last) {
      const raw = last.getAttribute('data-raw') || '';
      try { setPreviewText(decodeURIComponent(raw)); }
      catch { setPreviewText(raw || last.textContent); }
    } else setPreviewText('');
  }
  function refreshView() {
    modeButton.setAttribute('aria-pressed', String(prefs.active));
    modeButton.title = prefs.active ? 'Kembali ke Chatbot' : 'Buka Mode Pendamping';
    const label = modeButton.querySelector('.companion-switch-label');
    if (label) label.textContent = prefs.active ? 'Chatbot' : 'Pendamping';
    stage.hidden = !prefs.active;
    document.body.classList.toggle('aai-companion-active', prefs.active);
    document.body.classList.toggle('aai-companion-composer-hidden', prefs.active && !prefs.composer);
    document.body.classList.toggle('aai-companion-low-motion', prefs.lowMotion);
    showComposer.checked = prefs.composer;
    showPreview.checked = prefs.preview;
    lowMotion.checked = prefs.lowMotion;
    useMicro.checked = prefs.micro;
    reveal.hidden = !prefs.active || prefs.composer;
    preview.hidden = !prefs.active || !prefs.preview || !previewText.textContent.trim();
    settings.hidden = true;
    if (prefs.active) {
      reloadLastSavedAnswer();
      scheduleLayout();
    }
  }
  function chooseMode(active) {
    prefs.active = Boolean(active);
    persist();
    refreshView();
    if (!prefs.active && state.nativeOn && nativePlugin) {
      void nativePlugin.hide().finally(() => {
        state.nativeOn=false;
        if(nativeButton) nativeButton.textContent='Aktifkan AAi di atas aplikasi lain';
      });
    }
  }
  modeButton.addEventListener('click', () => chooseMode(!prefs.active));
  full.addEventListener('click', () => chooseMode(false));
  el('aaiCompanionViewFull').addEventListener('click', () => chooseMode(false));
  settingsButton.addEventListener('click', () => {
    settings.hidden = !settings.hidden;
    settingsButton.setAttribute('aria-expanded', String(!settings.hidden));
  });
  el('aaiCompanionCloseSettings').addEventListener('click', () => {
    settings.hidden = true;
    settingsButton.setAttribute('aria-expanded', 'false');
  });
  showComposer.addEventListener('change', () => {
    prefs.composer = showComposer.checked; persist(); refreshView();
    if (state.nativeOn && nativePlugin)
      void nativePlugin.setComposer({visible:prefs.composer}).catch(()=>{});
  });
  showPreview.addEventListener('change', () => { prefs.preview = showPreview.checked; persist(); refreshView(); });
  lowMotion.addEventListener('change', () => { prefs.lowMotion = lowMotion.checked; persist(); refreshView(); });
  flyButton?.addEventListener('click', () => {
    if (state.streaming) return;
    settings.hidden=true; // Let the user actually see the flight animation.
    settingsButton.setAttribute('aria-expanded','false');
    window.AAiCompanionMotion?.fly();
  });
  useMicro.addEventListener('change', () => {
    prefs.micro = useMicro.checked; persist();
    state.microAvailable = true;
    refreshView();
  });
  reveal.addEventListener('click', () => {
    prefs.composer = true;
    persist();
    refreshView();
    el('messageInput')?.focus();
  });

  prev.addEventListener('click', () => {
    if (state.index <= 0) return;
    state.index--;
    renderSpeech();
  });
  next.addEventListener('click', () => {
    if (state.index >= state.pages.length - 1) return;
    state.index++;
    renderSpeech();
  });

  // Avoid making fake semantic hitboxes before F0 verifies actual sprite pixels.
  // Alpha verification detects whether the canonical PNG has transparent corners.
  // Sensitive-area classification remains disabled when alpha cannot be proven.
  function inspectCanonicalAlpha() {
    const img = mascot.querySelector('img');
    if (!img || !img.complete || !img.naturalWidth) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(img.naturalWidth, 256);
      canvas.height = Math.min(img.naturalHeight, 256);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const corners = [[0,0],[canvas.width-1,0],[0,canvas.height-1],[canvas.width-1,canvas.height-1]];
      const alpha = (x,y) => data[(y*canvas.width+x)*4+3];
      // Actual alpha silhouettes are required to enable precise zones.
      if (!corners.some(([x,y]) => alpha(x,y) < 16)) {
        state.alphaMap = null;
        return;
      }
      let left=canvas.width,top=canvas.height,right=0,bottom=0;
      for (let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++) {
        if (alpha(x,y)>100) {
          left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        }
      }
      if (right-left<10 || bottom-top<10) return;
      state.alphaMap={canvas,ctx,rect:{left,top,right,bottom}};
    } catch { state.alphaMap = null; } // CORS or malformed image: general touch only.
  }
  function touchZone(clientX,clientY) {
    const img = mascot.querySelector('img');
    if (!img?.naturalWidth || !img.naturalHeight) return 'normal';
    const rigHit=window.AAiCompanionMotion?.hitTest?.(clientX,clientY);
    if(rigHit===null)return null;
    if(rigHit!==undefined){
      if(!state.alphaMap)return 'normal';
      const map=state.alphaMap;
      const y=rigHit.y/img.naturalHeight*map.canvas.height;
      const r=map.rect;
      const relY=(y-r.top)/Math.max(r.bottom-r.top,1);
      return relY<.32?'head':relY>.39&&relY<.72?'protect':'normal';
    }
    if (!state.alphaMap) return 'normal';
    const box=img.getBoundingClientRect();
    // The canonical sprite is drawn with object-fit: contain; its transparent
    // visual content is NOT the whole image tag rectangle.
    const scale=Math.min(box.width/img.naturalWidth,box.height/img.naturalHeight);
    const drawnW=img.naturalWidth*scale;
    const drawnH=img.naturalHeight*scale;
    const localX=clientX-box.left-(box.width-drawnW)/2;
    const localY=clientY-box.top-(box.height-drawnH)/2;
    if(localX<0 || localY<0 || localX>=drawnW || localY>=drawnH) return null;
    const x=Math.floor(localX/drawnW*state.alphaMap.canvas.width);
    const y=Math.floor(localY/drawnH*state.alphaMap.canvas.height);
    const sample=state.alphaMap.ctx.getImageData(x,y,1,1).data;
    if(sample[3]<35) return null; // No touching empty alpha around the mascot.
    const r=state.alphaMap.rect;
    const relY=(y-r.top)/Math.max(r.bottom-r.top,1);
    // F1 heuristic only; validated per-limb sprites are required for precise
    // protective/hand poses. Never interpret blank space as sensitive touch.
    if(relY<.32) return 'head';
    if(relY>.39 && relY<.72) return 'protect';
    return 'normal';
  }

  async function getDynamicReaction(zone, fallback, seq) {
    if (!prefs.micro || !state.microAvailable || Date.now() - state.lastMicroAt < 1800) return;
    state.lastMicroAt = Date.now();
    if (state.reactionAbort) state.reactionAbort.abort();
    const controller = new AbortController();
    state.reactionAbort = controller;
    const timeout = setTimeout(() => controller.abort(), 1700);
    try {
      const response = await fetch('/api/companion/reaction', {
        method:'POST', credentials:'same-origin',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({event:zone,recent:state.recent.slice(-3)}),
        signal:controller.signal,
      });
      if (!response.ok) {
        if ([401,403,415,503].includes(response.status)) state.microAvailable=false;
        return;
      }
      const data=await response.json();
      const reply=typeof data.reply === 'string' ? data.reply.trim().slice(0,120) : '';
      if (!reply || seq !== state.reactionSequence || state.streaming || !isActive()) return;
      if (reply === fallback || state.recent.slice(-6).includes(reply)) return;
      state.recent.push(reply);
      if (state.recent.length>8) state.recent.shift();
      showSpeech(reply,zone === 'head' || zone === 'protect' ? 'shy' : 'idle');
    } catch {
      // Local response already appeared instantly; no extra warning balloons.
    } finally {
      clearTimeout(timeout);
      if (state.reactionAbort===controller) state.reactionAbort=null;
    }
  }
  function reactToTouch(clientX,clientY,keyboard=false) {
    if (state.streaming) return; // Never overwrite a live answer with a tap line.
    const now=Date.now();
    state.tapHistory=state.tapHistory.filter(t=>now-t<3400);
    let zone=touchZone(clientX,clientY);
    if (zone === null) {
      if (!keyboard) return; // A pointer on transparent space isn't a touch.
      zone='normal'; // Enter/Space on the focused mascot remains operable.
    }
    state.tapHistory.push(now);
    if(state.tapHistory.length>3) zone='repeat';
    const local=core.reactionFor(zone,state.recent);
    const sequence=++state.reactionSequence;
    state.recent.push(local);
    if(state.recent.length>8) state.recent.shift();
    const emotion=zone==='head'||zone==='protect'||zone==='repeat'?'shy':'idle';
    // Touch reactions must not override the user's hidden-composer setting.
    window.AAiCompanionMotion?.react(zone);
    showSpeech(local,emotion);
    // Visual reaction does NOT wait for the model. The protected micro endpoint
    // can replace the sentence only if it responds quickly and remains current.
    void getDynamicReaction(zone,local,sequence);
    setTimeout(() => {
      if (!state.streaming && state.emotion==='shy') {
        state.emotion='idle';
        widget.dataset.emotion='idle';
      }
    },900);
  }
  mascot.addEventListener('pointerdown', event => {
    if (event.button !== 0 || touchZone(event.clientX,event.clientY) === null) return;
    const point={x:event.clientX,y:event.clientY};
    state.gesture={ point, t:Date.now(),left:widget.offsetLeft,top:widget.offsetTop };
    mascot.setPointerCapture(event.pointerId);
  });
  mascot.addEventListener('pointermove',event => {
    const g=state.gesture;
    if(!g)return;
    const kind=core.classifyGesture(g.point,{x:event.clientX,y:event.clientY},Date.now()-g.t);
    if(kind!=='drag' && widget.dataset.dragging!=='true')return;
    widget.dataset.dragging='true';
    savePosition(g.left+event.clientX-g.point.x,g.top+event.clientY-g.point.y);
  });
  mascot.addEventListener('pointerup',event => {
    const g=state.gesture;
    state.gesture=null;
    if(!g)return;
    const kind=core.classifyGesture(g.point,{x:event.clientX,y:event.clientY},Date.now()-g.t);
    widget.dataset.dragging='false';
    if(kind==='drag') { persist(); return; }
    if(kind==='long-press') {settings.hidden=false;settingsButton.setAttribute('aria-expanded','true');return;}
    reactToTouch(event.clientX,event.clientY);
  });
  mascot.addEventListener('pointercancel',()=>{
    state.gesture=null;widget.dataset.dragging='false';
  });
  mascot.addEventListener('keydown', event => {
    if(event.key==='Enter'||event.key===' ') {
      event.preventDefault();
      // Keyboard activation is intentional, even if the centre is transparent
      // in the current sleeping/flying pose.
      const box=mascot.getBoundingClientRect();
      reactToTouch(box.left+box.width/2,box.top+box.height/2,true);
    }
    if(event.key.startsWith('Arrow')){
      const step=20;
      const left=widget.offsetLeft+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0);
      const top=widget.offsetTop+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0);
      savePosition(left,top);event.preventDefault();
    }
  });
  mascot.querySelector('img')?.addEventListener('load',inspectCanonicalAlpha);
  inspectCanonicalAlpha();

  // Shared SSE bridge: only the real chat stream may publish answer/status.
  window.AAiCompanionBridge = {
    handleChatEvent(kind,data={}) {
      if(!isActive()) return;
      if(kind==='begin'){
        state.reactionSequence++;
        if (state.reactionAbort) state.reactionAbort.abort();
        state.streaming=true;state.currentRequestId=data.streamId||null;
        window.AAiCompanionMotion?.activity('begin');
        state.fullText='';state.pages=[];state.index=0;state.status='Aku cek dulu, ya.';
        setPreviewText(data.userMessage||'');
        renderSpeech();
        return;
      }
      if(data.streamId && state.currentRequestId && data.streamId!==state.currentRequestId) return;
      if(kind==='status' && !state.fullText.trim()){
        state.status=String(data.message||'Aku cek dulu, ya.').slice(0,200);
        window.AAiCompanionMotion?.activity('status');
        renderSpeech();return;
      }
      if(kind==='reset'){
        state.fullText='';state.pages=[];state.index=0;state.status='Aku cek sumbernya dulu, ya.';
        window.AAiCompanionMotion?.activity('status');
        renderSpeech();return;
      }
      if(kind==='token'){
        state.status='';state.fullText+=String(data.token||'');
        window.AAiCompanionMotion?.activity('token');
        scheduleStreamRender();return;
      }
      if(kind==='done'){
        state.streaming=false;state.currentRequestId=null;
        window.AAiCompanionMotion?.activity('done');
        renderFullText(data.text||state.fullText,false);
        return;
      }
      if(kind==='error'){
        state.streaming=false;state.currentRequestId=null;
        state.pages=[];state.index=0;
        state.status='Koneksi terputus. Coba lagi, ya.';
        window.AAiCompanionMotion?.activity('error');
        renderSpeech();
      }
    },
    refreshFromChat() { if(isActive()) reloadLastSavedAnswer(); },
    setMode: chooseMode,
    acceptNativeDraft(text) {
      const draft=String(text || '').slice(0,700);
      if(!draft.trim())return;
      prefs.active=true;prefs.composer=true;persist();
      refreshView();
      const input=el('messageInput');
      if(input) {
        input.value=draft;
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.focus();
      }
      setPreviewText(draft);
    },
  };
  // Read the draft after the WebView is really ready, not after an arbitrary
  // native 250ms timeout. It remains a draft until the user presses Send.
  async function consumeNativeDraft() {
    if (!nativePlugin || !ownerId || typeof nativePlugin.consumeDraft !== 'function') return;
    try {
      const result=await nativePlugin.consumeDraft({userId:ownerId});
      const draft=String(result?.draft || '').trim();
      if (draft && window.AAiCompanionBridge?.acceptNativeDraft)
        window.AAiCompanionBridge.acceptNativeDraft(draft);
    } catch { /* Native app may be on an older APK; keep web Chatbot usable. */ }
  }
  if (nativePlugin) {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void consumeNativeDraft();
    });
    window.addEventListener('focus', () => void consumeNativeDraft());
    void consumeNativeDraft();
  }
  let mutationTimer=null;
  const chatArea=el('chatArea');
  if(chatArea){
    const observer=new MutationObserver(()=>{
      if(!isActive()||state.streaming)return;
      if(mutationTimer)clearTimeout(mutationTimer);
      mutationTimer=setTimeout(()=>{mutationTimer=null;reloadLastSavedAnswer();},160);
    });
    observer.observe(chatArea,{childList:true,subtree:true,attributes:true,attributeFilter:['data-plain-text','data-raw','data-id']});
  }
  if(typeof ResizeObserver==='function'){
    new ResizeObserver(scheduleLayout).observe(stage);
    new ResizeObserver(scheduleLayout).observe(widget);
  }else window.addEventListener('resize',scheduleLayout);
  window.addEventListener('orientationchange',scheduleLayout);
  refreshView();
})();
