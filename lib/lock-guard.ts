import type { SupabaseClient } from '@supabase/supabase-js';

export type EvidenceChainStep = {
  step: string;
  confidence: number;
  source: string;
};

export type LockStatus = 'locked' | 'saved' | 'draft';

type MemoryRow = {
  id: string;
  content: string;
  is_locked: boolean;
};

type RowWithId = {
  id: string;
};

export type SaveMemoryWithLockGuardInput = {
  supabase: SupabaseClient;
  userId: string;
  memoryKey: string;
  content: string;
  evidenceChain: EvidenceChainStep[];
};

export type SaveMemoryWithLockGuardResult = {
  status: LockStatus;
  memoryId: string | null;
  draftId: string | null;
};

function normalizeMemoryKey(memoryKey: string): string {
  return String(memoryKey || '').trim().toLowerCase();
}

function extractContentKey(content: string): string {
  const raw = String(content || '').trim();
  const separatorIndex = raw.indexOf(':');
  if (separatorIndex === -1) {
    return normalizeMemoryKey(raw);
  }

  return normalizeMemoryKey(raw.slice(0, separatorIndex));
}

export function formatMemoryContent(memoryKey: string, content: string): string {
  return `${normalizeMemoryKey(memoryKey)}: ${String(content || '').trim()}`;
}

export async function saveMemoryWithLockGuard({
  supabase,
  userId,
  memoryKey,
  content,
  evidenceChain
}: SaveMemoryWithLockGuardInput): Promise<SaveMemoryWithLockGuardResult> {
  const normalizedKey = normalizeMemoryKey(memoryKey);
  const normalizedContent = String(content || '').trim();

  const { data: memoryRows, error: fetchError } = await supabase
    .from('memories')
    .select('id, content, is_locked')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  const existingMemory = ((memoryRows || []) as MemoryRow[])
    .find((row) => extractContentKey(row.content) === normalizedKey) || null;

  if (existingMemory?.is_locked) {
    const { data: draftRow, error: draftError } = await supabase
      .from('draft_memories')
      .insert({
        memory_id: existingMemory.id,
        user_id: userId,
        content: normalizedContent,
        evidence_chain: evidenceChain
      })
      .select('id')
      .single();

    if (draftError) {
      return {
        status: 'locked',
        memoryId: existingMemory.id,
        draftId: null
      };
    }

    return {
      status: 'draft',
      memoryId: existingMemory.id,
      draftId: ((draftRow || null) as RowWithId | null)?.id || null
    };
  }

  if (existingMemory?.id) {
    const { data: updatedMemory, error: updateError } = await supabase
      .from('memories')
      .update({
        content: normalizedContent,
        evidence_chain: evidenceChain
      })
      .eq('id', existingMemory.id)
      .select('id')
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    return {
      status: 'saved',
      memoryId: ((updatedMemory || null) as RowWithId | null)?.id || existingMemory.id,
      draftId: null
    };
  }

  const { data: insertedMemory, error: insertError } = await supabase
    .from('memories')
    .insert({
      user_id: userId,
      content: normalizedContent,
      evidence_chain: evidenceChain,
      is_locked: false
    })
    .select('id')
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return {
    status: 'saved',
    memoryId: ((insertedMemory || null) as RowWithId | null)?.id || null,
    draftId: null
  };
}