import { createClient } from '@supabase/supabase-js';
import * as chatMemory from '../_lib/chat-memory.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Confirms and saves a detected friend to the system.
 * Creates or links Person, creates Relationship, and initial memory.
 * 
 * POST /api/friends/confirm-and-save
 * Body: {
 *   user_id: uuid,
 *   friend_name: string,
 *   relationship_type: 'teman' | 'sahabat',
 *   intro_message: string,
 *   existing_person_id?: uuid (if linking existing)
 * }
 * Response: { success: boolean, friend_id: uuid, person_id?: uuid }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, friend_name, relationship_type = 'teman', intro_message, existing_person_id } = req.body;

  if (!user_id || !friend_name) {
    return res.status(400).json({ error: 'user_id and friend_name required' });
  }

  if (!['teman', 'sahabat'].includes(relationship_type)) {
    return res.status(400).json({ error: 'relationship_type must be teman or sahabat' });
  }

  try {
    // Get user's person
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('person_id')
      .eq('id', user_id)
      .single();

    if (userError || !user?.person_id) {
      return res.status(400).json({ error: 'User or person not found' });
    }

    let validatedExistingPersonId = null;
    if (existing_person_id) {
      const { data: existingPerson, error: existingError } = await supabase
        .from('persons')
        .select('id')
        .eq('id', existing_person_id)
        .single();

      if (existingError || !existingPerson) {
        return res.status(400).json({ error: 'Existing person not found' });
      }

      validatedExistingPersonId = existing_person_id;
    }

    const confirmResult = await chatMemory.confirmFriend(supabase, {
      ownerPersonId: user.person_id,
      friendPersonId: validatedExistingPersonId,
      friendName: friend_name,
      relationshipType: relationship_type,
      introMessage: intro_message,
      placeholderPersonId: user.person_id
    });

    const friendPersonId = confirmResult.friendPersonId;

    if (confirmResult.relationshipWarning) {
      console.warn('confirm-and-save relationship warning:', {
        user_id,
        friend_name,
        relationship_warning: confirmResult.relationshipWarning
      });
    }

    // Create initial memory from intro message
    if (intro_message) {
      const initialMemory = {
        person_id: friendPersonId,
        key: `introduced_as_friend_of_${user.person_id}`,
        value: `Dikenalkan sebagai teman pada ${new Date().toISOString().split('T')[0]}`,
        memory_type: 'fakta',
        category: 'umum',
        confidence: 0.9,
        observation_count: 1,
        priority_score: 0.8,
        status: 'active',
        source_person_id: user.person_id // Track that user told us this
      };

      let { error: memoryError } = await supabase
        .from('person_memory')
        .insert(initialMemory)
        .select('id');

      if (memoryError) {
        const memErrMsg = String(memoryError.message || '').toLowerCase();
        const missingSourceColumn = memErrMsg.includes('source_person_id');
        if (missingSourceColumn) {
          const fallbackMemory = { ...initialMemory };
          delete fallbackMemory.source_person_id;

          const fallbackResult = await supabase
            .from('person_memory')
            .insert(fallbackMemory)
            .select('id');

          memoryError = fallbackResult.error;
        }
      }

      if (memoryError) {
        console.error('Initial memory creation error:', memoryError);
        // Don't fail the entire call if memory creation fails
      }
    }

    const confirmed = Boolean(confirmResult.confirmed);
    return res.status(200).json({
      success: true,
      confirmed,
      friend_id: friendPersonId,
      person_id: friendPersonId,
      relationship_mode: confirmResult.relationshipMode || null,
      relationship_validation: confirmResult.relationshipValidation || null,
      relationship_warning: confirmResult.relationshipWarning || null,
      message: confirmed
        ? `Friend ${friend_name} saved successfully`
        : `Friend ${friend_name} saved with relationship warning`
    });

  } catch (err) {
    console.error('confirm-and-save error:', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
