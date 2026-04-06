# Friend Memory Recognition System - Usage Guide

## What This Feature Does

The AI can now automatically detect when someone introduces themselves as your friend, suggest saving them to memory, and remember them in future conversations.

## How to Use

### Step 1: Introduce a Friend
In a chat message, introduce someone as your friend using natural language, for example:
- "Aku teman Teguh, namaku Yosi"
- "Nama saya Yosi, aku teman dari Teguh"
- "I'm Teguh's friend, my name is Yosi"
- "Saya Yosi, teman dari Teguh"

### Step 2: AI Detects & Suggests
The AI will:
1. Detect the friend introduction pattern
2. Respond warmly: "Senang berkenalan dengan [friend name]! 😊"
3. Show a modal popup asking if you want to save this friend

### Step 3: Confirm or Dismiss
- Click **"Ya, Ingat Teman Ini"** to save the friend to your memory
- Click **"Nanti Saja"** to skip

### Step 4: AI Remembers
Once saved, in all future conversations, the AI will:
- Automatically reference the friend when relevant
- Use their saved information from previous context
- Feel like they genuinely know your friends

## Example Conversation

```
User: "Aku teman Teguh, namaku Yosi. Kami sering main game bareng."

AI: "Senang berkenalan dengan Yosi! 😊 Wah, kalian sering bermain game bersama ya? Itu seru sekali! Aku akan ingat tentang Yosi dan teman-teman Teguh yang lain."

[Modal appears: "Kenali Teman Baru"]
[You click: "Ya, Ingat Teman Ini"]

Later in a new chat:
User: "Apa tamus teman-temanku yang sering bermain game?"

AI: "Tentu! Dari yang aku ingat, Yosi adalah teman Teguh yang sering bermain game bareng. Kalian punya banyak keseruan bersama!"
```

## Technical Details

### What Gets Saved
When you confirm a friend:
- Friend's name
- Introduction message/context
- Relationship type (friend/sahabat)
- Timestamp of when they were introduced
- Friend's top 5 memories (if already known in system)

### How It Works Internally
1. **Detection**: Regex patterns identify friend introduction phrasings
2. **Suggestion**: System suggests saving via modal (you decide)
3. **Storage**: Friend saved to database with relationship metadata
4. **Context Injection**: All future chats include friend info in AI context
5. **Memory Tracking**: Source of each memory is tracked (who told us)

### Supported Patterns

The system detects these Indonesian friend introduction patterns:
- "nama aku X, aku teman [nama pemilik akun]"
- "saya X, teman dari [nama pemilik akun]"
- "aku teman dari X, nama aku Y"
- "I'm X's friend, name is Y"
- And variations with "teman" (friend) or "sahabat" (best friend)

### Smart Features
- **Deduplication**: Won't save the same friend twice
- **Existing Person Linking**: If friend already exists in system, links relationship instead of creating duplicate
- **Graceful Fallback**: If friend context fails to load, chat continues working normally
- **Error Handling**: Friend saving failures don't break the entire chat experience

## Troubleshooting

### Modal Doesn't Appear
- Make sure you used a recognized friend introduction pattern
- Check browser console for errors (F12)
- Refresh page and try again

### Friend Not Saved
- Check if you clicked "Ya, Ingat Teman Ini" (not "Nanti Saja")
- Verify friend name was extracted correctly from your message
- Check server logs for API errors

### AI Doesn't Remember Friend in Next Chat
- Make sure the save was successful (you should see confirmation message)
- Start a new chat session to test memory
- Friend must be marked as "active" in system (not archived)

## Database Schema

The system extends these database tables:
- `relationships`: Added columns for friend_status, introduced_at, confidence, introduction_context
- `person_memory`: Added source_person_id to track who told us about this memory

## API Endpoints (Internal Use)

### POST /api/friends/detect-and-suggest
Detects friend introduction in a message
- Input: user_message, user_id, session_id
- Output: suggested_friend object with name and context

### POST /api/friends/confirm-and-save
Saves confirmed friend to database
- Input: user_id, friend_name, relationship_type, intro_message
- Output: success status, friend_id, person_id

## Privacy & Data

- Friend data is stored in your private Supabase database
- Only you can see your friends' information
- Source tracking (source_person_id) records who told you about each friend
- Archive old friendships instead of hard-deleting

## Future Enhancements

Possible improvements for future versions:
- Fuzzy matching for duplicate detection (currently exact name match only)
- Bulk import of friends from contacts
- Friend profile management UI
- Friend-specific conversation contexts
- Relationship strength visualization
- Multi-language support expansion

## Support

If you encounter issues:
1. Check browser console (F12) for error messages
2. Verify API endpoints are responsive: `/api/friends/detect-and-suggest`, `/api/friends/confirm-and-save`
3. Check Supabase connection and permissions
4. Review database schema for missing columns
5. Check that friend suggestion modal element exists in DOM (id="friendSuggestionModal")

## Quick Reference

| Action | Result |
|--------|--------|
| Introduce friend naturally | AI detects pattern |
| AI suggests in modal | You confirm or dismiss |
| Click "Ya, Ingat Teman Ini" | Friend saved, message shown |
| Start new chat session | Friend's info auto-injected |
| Mention friend in chat | AI references them naturally |

---

**Status**: Production Ready
**Last Updated**: 2024
**Version**: 1.0
