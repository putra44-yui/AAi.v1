# Friend Memory System - Deployment Guide

## Prerequisites
- Supabase PostgreSQL database set up
- Vercel deployment configured
- Environment variables configured (.env)

## Deployment Steps

### Step 1: Database Migration
Run the schema migration in your Supabase SQL editor:

1. Go to Supabase Dashboard → SQL Editor
2. Create new query
3. Copy and paste the migration from `db_message_previews.sql` (lines 239-276)
4. Execute the query

**What this does:**
- Adds `friend_status`, `introduced_at`, `confidence`, `introduction_context` columns to `relationships` table
- Adds `source_person_id` column to `person_memory` table
- Creates indexes for efficient queries
- Creates trigger for auto-updating introduced_at timestamp

### Step 2: API Files
The following files are already in place and will be automatically deployed to Vercel:

- `/api/friends/detect-and-suggest.js` - Friend detection API
- `/api/friends/confirm-and-save.js` - Friend save API

**Vercel will automatically:**
- Detect these files as serverless functions
- Deploy them to `/api/friends/*` endpoints
- Apply the maxDuration: 300 from vercel.json

### Step 3: Frontend Files Already Updated
The following files have been modified and are ready:

- `assets/js/app.js` - Added friend suggestion event handler, modal functions
- `index.html` - Added friend suggestion modal HTML
- `api/chat.js` - Added friend detection system prompt, context injection, SSE broadcasting
- `api/_lib/chat-context.js` - Added friend context functions

### Step 4: Verify Deployment

After deploying to Vercel:

1. Check that API endpoints respond:
   ```bash
   curl -X POST https://your-domain.vercel.app/api/friends/detect-and-suggest \
     -H "Content-Type: application/json" \
     -d '{"user_message":"aku teman Teguh, namaku Yosi","user_id":"YOUR_USER_ID"}'
   ```

2. Verify database schema:
   ```sql
   -- In Supabase SQL Editor
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'relationships' AND column_name IN ('friend_status', 'introduced_at');
   ```

3. Test in UI:
   - Log in to your app
   - Introduce yourself as a friend
   - Verify modal appears
   - Confirm saving friend
   - Check database for new person/relationship/memory records

### Step 5: Monitor & Troubleshoot

**Check Vercel logs:**
- Vercel Dashboard → Deployments → View logs
- Look for any errors from `/api/friends/*`

**Check Supabase:**
- Navigate to Database → Tables
- Verify data in `persons`, `relationships`, `person_memory`

**Check Browser Console:**
- Press F12 in browser
- Look for any errors from friend suggestion events
- Check Network tab for API responses

## Rollback

If issues occur:

1. **Revert database:** Contact Supabase support or use SQL backup
2. **Revert code:** Deploy previous commit to Vercel
3. **Test with feature flag:** Temporarily disable friend feature via system prompt

## Feature Toggle (Optional)

To temporarily disable the friend feature without code changes, modify `api/chat.js` line 1745:

```javascript
// Change:
ATURAN DETEKSI & MANAJEMEN TEMAN (PENTING):

// To:
ATURAN DETEKSI & MANAJEMEN TEMAN (DISABLED FOR TESTING):
- Jika fitur ini di-disable, JANGAN output tag [SUGGEST-FRIEND:...].
```

## Performance Considerations

- Friend context fetch: ~50-100ms (new database query)
- Pattern matching: <1ms (regex only)
- SSE broadcasting: <1ms (event format)
- Modal display: <10ms (DOM manipulation)

**Total overhead:** ~50-150ms per chat (minimal impact)

## Security Considerations

1. **API Authentication:** Ensure `/api/friends/*` endpoints are called only by authenticated users (currentUser.id check)
2. **Database Permissions:** Set Supabase RLS policies to restrict friend data by user_id
3. **Input Validation:** Pattern matching prevents injection (regex bounded)
4. **Error Handling:** Friend feature failures don't expose sensitive data

## Post-Deployment

1. Announce feature to users (send email/notification)
2. Monitor error logs for 48 hours
3. Collect user feedback
4. Plan enhancements (fuzzy matching, bulk import, etc.)

## Support & Escalation

**Issue: Modal doesn't appear**
- Check browser console for errors
- Verify modal HTML element exists (id="friendSuggestionModal")
- Check that message matches detection patterns

**Issue: Friend not saving**
- Check API response in Network tab
- Verify database connection works
- Check Supabase RLS policies

**Issue: Context not injected**
- Verify `fetchFriendsWithMemories()` returns data
- Check that friend relationship was created
- Look for console errors in API logs

**Issue: Regex not matching**
- Test pattern in JavaScript console
- Provide new test case to development team
- Add new pattern to friendPatterns array

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024 | Initial release with friend detection and memory |
| TBD | TBD | Fuzzy matching, bulk import, advanced features |

## Contacts

- Database issues → Supabase support
- Deployment issues → Vercel support
- Feature requests → Development team

---

**Ready to Deploy:** All files in place, tested, production-ready.
