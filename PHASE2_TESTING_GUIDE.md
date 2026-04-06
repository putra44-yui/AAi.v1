# Phase 2 Testing & Validation Guide

## Deployment Status
✅ **Live at**: https://a-ai-rust.vercel.app  
✅ **Time**: Deployed 2024 (vercel --prod completed)

---

## Test 1: Reload Bug Fix (SSE Init Event)

**Feature**: Message loss on reload after network timeout should be fixed by SSE init event

**Setup**:
1. Open https://a-ai-rust.vercel.app in incognito/fresh session
2. Start new chat
3. Type a message (e.g., "Hello, apa kabar?")

**Test Procedure**:
1. Click Send
2. Wait for AI to start responding (first few tokens should appear)
3. **BEFORE response completes**: Either:
   - Open DevTools Network tab → throttle to "Offline"
   - Or unplug network cable
   - Or force timeout by waiting >30s without response
4. This should interrupt the stream mid-response
5. **Reload the page** (Ctrl+R or Cmd+R)

**Expected Result** ✅:
- Session ID preserved (localStorage aai_last_session should still exist)
- User message visible in chat history
- Chat doesn't disappear or reset
- Can continue conversation normally

**What Fixed This**:
- Backend: SSE init event sends `{ session_id, user_message_id, phase: 'init' }` IMMEDIATELY after headers (line 1919-1932)
- Frontend: processLine() detects `phase='init'`, syncs session, skips content processing (line 1311-1319)
- Frontend: initApp() fallback loads sessions[0] if localStorage session not in current list (line 2607-2620)

**Debug Artifacts**:
- Check browser DevTools Console for errors
- Check Network tab XHR requests — should see SSE stream with init event
- Check localStorage: `localStorage.getItem('aai_last_session')` should have session_id

---

## Test 2: Soft-Drop Memory Recall

**Feature**: Memory "forget" should rank down (not delete) so AI can still recall traces

**Setup**:
1. Login to session (or use existing user)
2. Send a memorable fact: "Saya sangat suka makan nasi goreng setiap hari pagi"
3. Wait for memory [MEMORY:...] parsing in AI response
4. Send another message: "Terima kasih atas informasi itu, saya akan ingat"

**Test Procedure (Part A: Verify Memory Created)**:
1. Check Supabase `person_memory` table for new entry with:
   - key: something like "makan_nasi_goreng_pagi" (fuzzy merged)
   - memory_type: "preferensi"
   - status: "active"
   - priority_score: Should be >0.5

**Test Procedure (Part B: Request Forget)**:
1. Send explicit forget: "Lupakan bahwa aku suka nasi goreng"
2. AI should recognize [MEMORY_FORGET:...] tag in response
3. Check Supabase again — same memory entry should now have:
   - status: "dropped" (NOT "archived", NOT deleted)
   - priority_score: 0.02 (rank-down)
   - updated_at: Recent timestamp

**Test Procedure (Part C: Verify Trace Recall)**:
1. Later in conversation, send: "Apakah kau masih ingat aku apa?"
2. Or send: "Apa kau masih ingat jejaknya tentang makanan favorit aku?"
3. **Expected**: AI should respond with something like:
   - "Aku masih ingat sedikit jejaknya... seperti ada sesuatu tentang makanan favorit kamu, tapi detailnya sudah kabur"
   - OR if in dropped memory block: AI mentions the memory with lowered confidence

**What Fixed This**:
- Backend: Forget loop changed from hard-delete to `status='dropped', priority_score=0.02` (line 2328)
- Backend: systemDroppedMemoryPrompt injected into messages array (line 2028-2067) tells AI to treat dropped memories as degraded (mention with "aku masih ingat jejaknya")
- Schema: person_memory.status already supports string "dropped" (TEXT field)

**Debug Artifacts**:
- Supabase: SELECT * FROM person_memory WHERE status='dropped' should show rank-down memories
- Backend logs: grep for "MEMORY_FORGET:" in response to verify tag parsing
- Check systemDroppedMemoryPrompt injection in /api/chat.js around line 2050

---

## Test 3: Shared Child Memory (Co-parenting Data)

**Feature**: Child data entered by one parent visible to both parents

**Setup** (assume family structure):
- User (role='ayah') + Rosalia (role='ibu') 
- Child (role='anak', person_id stored in relationships table)

**Test Procedure (Part A: Parent A Enters Child Data)**:
1. Login as User (Ayah session)
2. Send: "Anak saya Budi, 12 tahun, sedang demam 39 derajat. Dia butuh istirahat"
3. Wait for AI response with [MEMORY:...] tags
4. AI should detect and store:
   - Memory key: "anak_budi_demam_suhu_39" 
   - memory_type: "fakta" or "kesehatan"
   - person_id: child's person_id
   - status: "active"

**Test Procedure (Part B: Backend Verification)**:
1. Check Supabase person_memory table
2. Verify new memory has person_id = child's ID
3. Check relationships table to confirm Ayah + Ibu both linked to child

**Test Procedure (Part C: Parent B Recalls Child Data)**:
1. **Logout/Switch to Rosalia session** (reload page, load different user)
2. Send: "Bagaimana kabar anak kita?"
3. **Backend parallel fetch** (line 1575) should execute:
   ```
   - SELECT active memories WHERE person_id=rosalia_id
   - SELECT dropped memories WHERE person_id=rosalia_id
   - SELECT memories WHERE person_id=child_id (via relationships)
   ```
4. **systemChildMemoryPrompt** (line 2035-2055) injects into messages with prefix:
   ```
   "DATA BERSAMA TENTANG ANAK-ANAK KAMI:
   - Budi (12 tahun): sedang demam 39 derajat, butuh istirahat"
   ```
5. **Expected Result**: Rosalia's AI response includes:
   - "Budi masih demam 39 derajat, dia butuh istirahat"
   - Shows the memory was shared across parents

**Test Procedure (Part D: Verify isParent Guard)**:
1. Check api/chat.js line ~1565 for `isParent` check:
   - `if (isParent && childPersonIds.length > 0)` guards child memory fetch
   - Only executes if user's role = 'ayah' or 'ibu'
2. Can test by creating non-parent user (role='anak') — should NOT fetch child memories

**What Fixed This**:
- Backend: allPersons query now includes 'id' field (line 1547) so we can match parent_id
- Backend: Parallel fetch queries 3+ sources (line 1575) — active + dropped + child memories via Promise.all
- Backend: systemChildMemoryPrompt builder (line 2035-2055) formats child data for injection
- Backend: Messages array injects after emotion guidance (line 2012)
- Guard: isParent boolean skip child queries for non-parents (line 1565)

**Debug Artifacts**:
- Supabase relationships table: SELECT * WHERE (parent_id=user_id AND child_id=...) OR (parent_id=rosalia_id AND child_id=...)
- Backend logs: grep for "systemChildMemoryPrompt" or "childMemories" in /api/chat.js
- Network tab: Check SSE stream for [DATA BERSAMA...] block injection
- Check app.js line 1311 — init phase handler should skip this for phase='init'

---

## Quick Validation Checklist

- [ ] **Test 1 Pass**: Send → Disconnect → Reload → Session preserved + message visible
- [ ] **Test 2 Pass**: Create memory → Forget → Check status='dropped' + priority=0.02 → AI recalls trace
- [ ] **Test 3 Pass**: Ayah enters child data → Ibu logs in → AI mentions child data in [DATA BERSAMA] block

---

## Rollback Plan (if needed)

If critical issues found:
1. **Immediate**: `vercel --prod --env-file=/dev/null` to use previous deployment
2. Or: Revert Phase 2 commits in git, redeploy
3. User can configure Vercel rollback UI manually

---

## Known Limitations

1. **Friend recognition across sessions**: Deferred (Phase 3) — user noted acceptable if token-heavy
2. **Multi-language memory merge**: Currently Indonesian-focused, fuzzy merge via Jaccard ≥0.72
3. **Dropped memory TTL**: No auto-purge yet — dropped memories stay indefinitely (can be added later)
4. **Child memory sync latency**: Parallel fetch should be <500ms, but network variance possible

---

## Success Criteria

✅ **All tests pass** = Phase 2 feature-complete and production-ready  
⚠️ **1-2 tests fail** = Investigate; likely edge case in family structure or session handling  
❌ **3+ tests fail** = Critical bug; recommend rollback and root-cause analysis

---

## Next Phase (Phase 3 - Future)

- Friend recognition across sessions
- Multi-layer intent detection (beyond keywords)
- Auto-summarization of long conversations
- Emotion tracking over time
