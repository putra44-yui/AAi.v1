import { createClient } from '@supabase/supabase-js';

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

    let friendPersonId;

    // If existing_person_id provided, link to existing person
    if (existing_person_id) {
      const { data: existingPerson, error: existingError } = await supabase
        .from('persons')
        .select('id')
        .eq('id', existing_person_id)
        .single();

      if (existingError || !existingPerson) {
        return res.status(400).json({ error: 'Existing person not found' });
      }

      friendPersonId = existing_person_id;
    } else {
      // Reuse existing person by name if present, otherwise create.
      const normalizedName = friend_name.trim();
      const { data: existingByName } = await supabase
        .from('persons')
        .select('id, name')
        .ilike('name', normalizedName)
        .maybeSingle();

      if (existingByName?.id) {
        friendPersonId = existingByName.id;
      } else {
        const { data: newPerson, error: createError } = await supabase
          .from('persons')
          .insert({
            name: normalizedName,
            description: `Friend of ${user.person_id} - introduced via chat`
          })
          .select('id')
          .single();

        if (createError) {
          return res.status(500).json({ error: 'Failed to create friend person', details: createError });
        }

        friendPersonId = newPerson.id;
      }
    }

    // Create bidirectional relationship
    let relError = null;
    const relationshipWithMeta = [
      {
        person_a: user.person_id,
        person_b: friendPersonId,
        relation_type: relationship_type,
        friend_status: 'active',
        introduction_context: intro_message?.substring(0, 500)
      },
      {
        person_a: friendPersonId,
        person_b: user.person_id,
        relation_type: relationship_type,
        friend_status: 'active',
        introduction_context: intro_message?.substring(0, 500)
      }
    ];

    const relationshipBasic = [
      {
        person_a: user.person_id,
        person_b: friendPersonId,
        relation_type: relationship_type
      },
      {
        person_a: friendPersonId,
        person_b: user.person_id,
        relation_type: relationship_type
      }
    ];

    const { error: relErrorWithMeta } = await supabase
      .from('relationships')
      .insert(relationshipWithMeta)
      .select('id')
      .limit(1);

    if (relErrorWithMeta) {
      const relErrMsg = String(relErrorWithMeta.message || '').toLowerCase();
      const missingMetaColumns =
        relErrMsg.includes('friend_status') ||
        relErrMsg.includes('introduction_context');

      if (missingMetaColumns) {
        const { error: relErrorBasic } = await supabase
          .from('relationships')
          .insert(relationshipBasic)
          .select('id')
          .limit(1);
        relError = relErrorBasic;
      } else {
        relError = relErrorWithMeta;
      }
    }

    if (relError) {
      const relErrMsg = String(relError.message || '').toLowerCase();
      const isDuplicate = relError.code === '23505' || relErrMsg.includes('duplicate');
      if (!isDuplicate) {
        console.error('Relationship creation error:', relError);
        return res.status(500).json({ error: 'Failed to create relationship', details: relError });
      }
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

    return res.status(200).json({
      success: true,
      friend_id: friendPersonId,
      person_id: friendPersonId,
      message: `Friend ${friend_name} saved successfully`
    });

  } catch (err) {
    console.error('confirm-and-save error:', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
