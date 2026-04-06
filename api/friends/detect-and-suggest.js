import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Detects friend introduction in a message and suggests saving them.
 * Simple pattern-based detection first, then optional AI-based parsing.
 * 
 * POST /api/friends/detect-and-suggest
 * Body: { user_message: string, user_id: uuid, session_id?: uuid }
 * Response: { suggested_friend: { name, context } | null, should_suggest: boolean, reason?: string }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_message, user_id, session_id } = req.body;

  if (!user_message || !user_id) {
    return res.status(400).json({ error: 'user_message and user_id required' });
  }

  try {
    // Get user's person to check existing relationships
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('person_id')
      .eq('id', user_id)
      .single();

    if (userError || !user?.person_id) {
      return res.status(400).json({ error: 'User or person not found' });
    }

    // Pattern detection for friend introduction
    // Patterns: "I'm [your account owner]'s friend [name]", "Aku teman [name]", "Nama aku [name], aku teman..."
    const friendPatterns = [
      // "aku teman Teguh, namaku Yosi" / "aku teman dari Teguh, namaku Yosi"
      { regex: /aku\s+teman(?:\s+dari)?\s+\w+.*?nama\s*(?:ku|saya|aku)?\s+(\w+)/i, friendGroup: 1, desc: 'aku teman X ... nama/namaku Y' },
      // "namaku Yosi, aku teman Teguh" / "nama saya Yosi, aku teman dari Teguh"
      { regex: /nama\s*(?:ku|saya|aku)?\s+(\w+).*?aku\s+teman(?:\s+dari)?\s+\w+/i, friendGroup: 1, desc: 'nama/namaku Y ... aku teman X' },
      // "saya Yosi, teman dari Teguh" / "saya Yosi teman Teguh"
      { regex: /saya\s+(\w+)\s*[,.]?\s*teman(?:\s+dari)?\s+\w+/i, friendGroup: 1, desc: 'saya Y, teman X' },
      // "teman dari Teguh, nama saya Yosi"
      { regex: /teman(?:\s+dari)?\s+\w+.*?nama\s*(?:ku|saya|aku)?\s+(\w+)/i, friendGroup: 1, desc: 'teman X ... nama Y' },
      // "I'm Teguh's friend, name is Yosi"
      { regex: /i['’]?m\s+\w+['’]s\s+friend.*?name\s+(?:is\s+)?(\w+)/i, friendGroup: 1, desc: "I'm X's friend, name is Y" },
    ];

    let detectedFriend = null;

    for (const patternObj of friendPatterns) {
      const match = patternObj.regex.exec(user_message);
      if (match) {
        // Use the specified capture group for friend name
        detectedFriend = match[patternObj.friendGroup];
        if (detectedFriend && detectedFriend.toLowerCase() !== 'teman' && detectedFriend.toLowerCase() !== 'dari') {
          break;
        }
      }
    }

    // If no regex match, try simpler pattern
    if (!detectedFriend) {
      const simplePattern = /(?:bernama|namaku|nama\s+saya|nama\s+aku)\s+(\w+)|nama\s+(\w+)\s+.*?teman/i;
      const simpleMatch = simplePattern.exec(user_message);
      if (simpleMatch) {
        detectedFriend = simpleMatch[1] || simpleMatch[2];
      }
    }

    // If still no match, no suggestion
    if (!detectedFriend) {
      return res.status(200).json({
        suggested_friend: null,
        should_suggest: false,
        reason: 'no_friend_pattern_detected'
      });
    }

    // Normalize friend name
    const friendNameNormalized = detectedFriend.toLowerCase().trim();
    const friendNameProper = detectedFriend.charAt(0).toUpperCase() + detectedFriend.slice(1).toLowerCase();

    // Check if this friend/person already exists in the system
    const { data: existingPerson } = await supabase
      .from('persons')
      .select('id, name')
      .ilike('name', friendNameProper)
      .single();

    if (existingPerson) {
      // Check if already a relationship
      const { data: existingRelationship } = await supabase
        .from('relationships')
        .select('id')
        .or(`and(person_a.eq.${user?.person_id},person_b.eq.${existingPerson.id}),and(person_a.eq.${existingPerson.id},person_b.eq.${user?.person_id})`)
        .eq('relation_type', 'teman')
        .single();

      if (existingRelationship) {
        return res.status(200).json({
          suggested_friend: null,
          should_suggest: false,
          reason: 'already_saved_as_friend',
          existing_friend_name: existingPerson.name
        });
      }

      // Person exists but no relationship yet - suggest linking
      return res.status(200).json({
        suggested_friend: {
          name: existingPerson.name,
          person_id: existingPerson.id,
          context: 'existing_person_no_relationship',
          intro_message: user_message.substring(0, 200)
        },
        should_suggest: true,
        reason: 'existing_person_needs_relationship'
      });
    }

    // New person not in database - suggest creating
    return res.status(200).json({
      suggested_friend: {
        name: friendNameProper,
        context: 'new_friend',
        intro_message: user_message.substring(0, 200)
      },
      should_suggest: true,
      reason: 'new_friend_detected'
    });

  } catch (err) {
    console.error('detect-and-suggest error:', err);
    return res.status(500).json({
      error: err.message,
      suggested_friend: null,
      should_suggest: false
    });
  }
}
