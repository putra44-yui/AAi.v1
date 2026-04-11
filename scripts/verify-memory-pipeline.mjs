import assert from 'node:assert/strict';
import * as chatMemory from '../api_backup/_lib/chat-memory.js';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createIso(daysAgo = 0) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function escapeRegExp(input = '') {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesIlike(value, pattern) {
  const normalizedValue = String(value ?? '').toLowerCase();
  const normalizedPattern = String(pattern ?? '').toLowerCase();
  if (!normalizedPattern.includes('%')) {
    return normalizedValue === normalizedPattern;
  }

  const regexp = new RegExp(`^${escapeRegExp(normalizedPattern).replace(/%/g, '.*')}$`, 'i');
  return regexp.test(normalizedValue);
}

function parseFields(fields) {
  const raw = String(fields || '*').trim();
  if (!raw || raw === '*') return null;
  return raw.split(',').map(part => part.trim()).filter(Boolean);
}

function projectRow(row, fields) {
  const selectedFields = parseFields(fields);
  if (!selectedFields) return clone(row);

  const projected = {};
  for (const field of selectedFields) {
    projected[field] = row[field];
  }
  return projected;
}

function safeJsonObject(input) {
  try {
    const parsed = JSON.parse(String(input || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error || 'Unknown error')
  };
}

function emitLog(entry = {}) {
  console.log(JSON.stringify({
    source: 'verify-memory-pipeline',
    timestamp: new Date().toISOString(),
    ...entry
  }));
}

async function runScenario(name, execute) {
  const startedAt = Date.now();

  try {
    const details = await execute();
    const result = {
      type: 'scenario_result',
      scenario: name,
      status: 'pass',
      duration_ms: Date.now() - startedAt,
      details: details || {}
    };
    emitLog(result);
    return result;
  } catch (error) {
    const result = {
      type: 'scenario_result',
      scenario: name,
      status: 'fail',
      duration_ms: Date.now() - startedAt,
      error: serializeError(error)
    };
    emitLog(result);
    throw error;
  }
}

class MockQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.operation = 'select';
    this.filters = [];
    this.sorts = [];
    this.limitCount = null;
    this.cardinality = 'many';
    this.selectFields = '*';
    this.payload = null;
    this.options = {};
  }

  select(fields = '*') {
    this.selectFields = fields;
    return this;
  }

  insert(values) {
    this.operation = 'insert';
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }

  update(values) {
    this.operation = 'update';
    this.payload = values || {};
    return this;
  }

  upsert(values, options = {}) {
    this.operation = 'upsert';
    this.payload = Array.isArray(values) ? values : [values];
    this.options = options;
    return this;
  }

  eq(field, value) {
    this.filters.push(row => row[field] === value);
    return this;
  }

  neq(field, value) {
    this.filters.push(row => row[field] !== value);
    return this;
  }

  ilike(field, pattern) {
    this.filters.push(row => matchesIlike(row[field], pattern));
    return this;
  }

  order(field, { ascending = true } = {}) {
    this.sorts.push({ field, ascending });
    return this;
  }

  limit(value) {
    this.limitCount = Number(value);
    return this;
  }

  maybeSingle() {
    this.cardinality = 'maybeSingle';
    return this;
  }

  single() {
    this.cardinality = 'single';
    return this;
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  async execute() {
    switch (this.operation) {
      case 'insert':
        return this.executeInsert();
      case 'update':
        return this.executeUpdate();
      case 'upsert':
        return this.executeUpsert();
      default:
        return this.executeSelect();
    }
  }

  getRows() {
    const rows = this.client.tables[this.table] || [];
    let result = rows.filter(row => this.filters.every(filter => filter(row)));

    for (const sort of this.sorts) {
      result = [...result].sort((left, right) => {
        const leftValue = left[sort.field];
        const rightValue = right[sort.field];
        if (leftValue === rightValue) return 0;
        if (leftValue == null) return sort.ascending ? -1 : 1;
        if (rightValue == null) return sort.ascending ? 1 : -1;
        if (leftValue > rightValue) return sort.ascending ? 1 : -1;
        return sort.ascending ? -1 : 1;
      });
    }

    if (Number.isFinite(this.limitCount) && this.limitCount >= 0) {
      result = result.slice(0, this.limitCount);
    }

    return result;
  }

  buildResult(rows, error = null) {
    if (error) {
      return { data: null, error };
    }

    const projectedRows = this.selectFields ? rows.map(row => projectRow(row, this.selectFields)) : null;

    if (this.cardinality === 'single') {
      if (!projectedRows || projectedRows.length !== 1) {
        return {
          data: null,
          error: {
            code: 'PGRST116',
            message: `Expected single row for ${this.table}, received ${projectedRows ? projectedRows.length : 0}`
          }
        };
      }
      return { data: projectedRows[0], error: null };
    }

    if (this.cardinality === 'maybeSingle') {
      if (!projectedRows || projectedRows.length === 0) {
        return { data: null, error: null };
      }
      return { data: projectedRows[0], error: null };
    }

    return {
      data: this.selectFields ? projectedRows : null,
      error: null
    };
  }

  async executeSelect() {
    return this.buildResult(this.getRows());
  }

  async executeInsert() {
    const tableRows = this.client.tables[this.table] || [];
    const inserted = [];

    for (const rawRow of this.payload || []) {
      const row = this.client.prepareRow(this.table, rawRow, { isInsert: true });
      tableRows.push(row);
      inserted.push(row);
    }

    this.client.tables[this.table] = tableRows;
    return this.buildResult(inserted);
  }

  async executeUpdate() {
    const rows = this.getRows();
    const updated = [];

    for (const row of rows) {
      Object.assign(row, clone(this.payload || {}));
      if ('updated_at' in row) {
        row.updated_at = new Date().toISOString();
      }
      updated.push(row);
    }

    return this.buildResult(updated);
  }

  async executeUpsert() {
    if (this.table === 'relationships') {
      const includesMetadata = (this.payload || []).some(row => 'friend_status' in row || 'introduction_context' in row);
      if (includesMetadata && this.client.flags.failRelationshipMetadataOnce) {
        this.client.flags.failRelationshipMetadataOnce = false;
        return this.buildResult([], {
          code: '23505',
          message: 'mock relationship constraint violation on metadata columns'
        });
      }
      if (!includesMetadata && this.client.flags.failRelationshipFallback) {
        return this.buildResult([], {
          code: '23505',
          message: 'mock relationship fallback violation'
        });
      }
    }

    const tableRows = this.client.tables[this.table] || [];
    const conflictFields = String(this.options.onConflict || '')
      .split(',')
      .map(field => field.trim())
      .filter(Boolean);
    const affected = [];

    for (const rawRow of this.payload || []) {
      const candidate = this.client.prepareRow(this.table, rawRow, { isInsert: true, preserveExistingId: true });
      const existing = conflictFields.length
        ? tableRows.find(row => conflictFields.every(field => row[field] === candidate[field]))
        : null;

      if (existing) {
        Object.assign(existing, candidate, { id: existing.id });
        if ('updated_at' in existing) {
          existing.updated_at = new Date().toISOString();
        }
        affected.push(existing);
      } else {
        tableRows.push(candidate);
        affected.push(candidate);
      }
    }

    this.client.tables[this.table] = tableRows;
    return this.buildResult(affected);
  }
}

class MockSupabase {
  constructor(seed = {}, flags = {}) {
    this.tables = {
      users: clone(seed.users || []),
      persons: clone(seed.persons || []),
      person_memory: clone(seed.person_memory || []),
      legacy_audit_log: clone(seed.legacy_audit_log || []),
      relationships: clone(seed.relationships || []),
      memories: clone(seed.memories || [])
    };

    this.flags = {
      failRelationshipMetadataOnce: false,
      failRelationshipFallback: false,
      ...flags
    };

    this.sequences = {
      users: this.tables.users.length,
      persons: this.tables.persons.length,
      person_memory: this.tables.person_memory.length,
      legacy_audit_log: this.tables.legacy_audit_log.length,
      relationships: this.tables.relationships.length,
      memories: this.tables.memories.length
    };
  }

  from(table) {
    return new MockQuery(this, table);
  }

  async rpc(name, params) {
    if (name !== 'upsert_provisional_friend_mention') {
      return {
        data: null,
        error: {
          code: '42883',
          message: `function ${name} does not exist`
        }
      };
    }

    const nowIso = new Date().toISOString();
    const tableRows = this.tables.person_memory;
    let row = tableRows.find(item => item.person_id === params.p_person_id && item.key === params.p_key);

    if (!row) {
      row = this.prepareRow('person_memory', {
        person_id: params.p_person_id,
        key: params.p_key,
        value: JSON.stringify({
          subject: params.p_subject || '',
          relation: params.p_relation || 'teman',
          value: params.p_value || params.p_context || '',
          source_context: params.p_source_context || 'friend_via_account',
          mention_count: 1,
          first_seen: nowIso,
          last_seen: nowIso,
          status: 'pending',
          semantic_category: 'relasi',
          cctv_ready: false
        }),
        memory_type: 'fakta',
        category: 'provisional_friend',
        status: 'active',
        memory_scope: 'dynamic',
        confidence: 0.35,
        observation_count: 1,
        priority_score: 0.28,
        source_message_id: params.p_source_message_id || null,
        source_person_id: params.p_source_person_id || null
      }, { isInsert: true });
      tableRows.push(row);

      return {
        data: [{
          id: row.id,
          key: row.key,
          value: row.value,
          observation_count: row.observation_count,
          category: row.category,
          status: row.status,
          memory_scope: row.memory_scope,
          confidence: row.confidence,
          priority_score: row.priority_score,
          previous_mention_count: 0,
          current_mention_count: 1,
          was_inserted: true
        }],
        error: null
      };
    }

    const meta = safeJsonObject(row.value);
    const previousMentionCount = Math.max(1, Number(meta.mention_count || row.observation_count || 1));
    const currentMentionCount = previousMentionCount + 1;
    row.value = JSON.stringify({
      ...meta,
      subject: params.p_subject || meta.subject || '',
      relation: params.p_relation || meta.relation || 'teman',
      value: params.p_value || params.p_context || meta.value || '',
      source_context: params.p_source_context || meta.source_context || 'friend_via_account',
      first_seen: meta.first_seen || nowIso,
      last_seen: nowIso,
      status: 'pending',
      semantic_category: 'relasi',
      mention_count: currentMentionCount
    });
    row.memory_type = 'fakta';
    row.category = 'provisional_friend';
    row.status = 'active';
    row.memory_scope = 'dynamic';
    row.confidence = Number(Math.min(0.72, Math.max(0.35, 0.35 + previousMentionCount * 0.08)).toFixed(4));
    row.observation_count = currentMentionCount;
    row.priority_score = Number(Math.min(0.7, Math.max(0.2, 0.2 + currentMentionCount * 0.08)).toFixed(4));
    row.source_message_id = params.p_source_message_id || row.source_message_id || null;
    row.source_person_id = params.p_source_person_id || row.source_person_id || null;
    row.updated_at = nowIso;

    return {
      data: [{
        id: row.id,
        key: row.key,
        value: row.value,
        observation_count: row.observation_count,
        category: row.category,
        status: row.status,
        memory_scope: row.memory_scope,
        confidence: row.confidence,
        priority_score: row.priority_score,
        previous_mention_count: previousMentionCount,
        current_mention_count: currentMentionCount,
        was_inserted: false
      }],
      error: null
    };
  }

  prepareRow(table, inputRow = {}, options = {}) {
    const row = clone(inputRow || {});
    if (!row.id || !options.preserveExistingId) {
      row.id = row.id || `${table}-${++this.sequences[table]}`;
    }

    const nowIso = new Date().toISOString();
    if (!('created_at' in row)) row.created_at = nowIso;
    if (!('updated_at' in row)) row.updated_at = nowIso;
    return row;
  }
}

function buildDynamicMemoryRow(personId, index) {
  return {
    id: `memory-${index}`,
    person_id: personId,
    key: `habit_${index}`,
    value: JSON.stringify({
      subject: 'Pemilik Akun',
      relation: 'diri',
      value: `Kebiasaan nomor ${index}`,
      source_context: 'user_direct',
      semantic_category: 'kebiasaan'
    }),
    memory_type: 'kebiasaan',
    category: 'umum',
    status: 'active',
    memory_scope: 'dynamic',
    confidence: 0.82,
    observation_count: 3,
    priority_score: Number((0.1 + index * 0.005).toFixed(4)),
    updated_at: createIso(21),
    created_at: createIso(40)
  };
}

async function verifyCorruptJsonFallback() {
  const corruptRow = {
    id: 'warisan-1',
    key: 'warisan_ayah',
    value: '{"subject":"Ayah","value":"Masih suka kopi"',
    confidence: 0.91,
    observation_count: 2,
    updated_at: createIso(3),
    priority_score: 0.95,
    memory_type: 'fakta',
    category: 'warisan',
    status: 'active',
    memory_scope: 'stable'
  };
  const supportingRow = {
    id: 'dynamic-1',
    key: 'preferensi_kopi',
    value: JSON.stringify({
      subject: 'Ayah',
      relation: 'ayah',
      value: 'Suka kopi hitam',
      source_context: 'friend_via_account',
      semantic_category: 'preferensi'
    }),
    confidence: 0.72,
    observation_count: 1,
    updated_at: createIso(2),
    priority_score: 0.74,
    memory_type: 'fakta',
    category: 'umum',
    status: 'active',
    memory_scope: 'dynamic'
  };

  const parsed = chatMemory.safeParseValue(corruptRow);
  assert.equal(parsed.fallback_legacy, true, 'Corrupt JSON should fall back to legacy text');
  assert.equal(parsed.corrupted_json, true, 'Corrupt JSON should be flagged');

  const selection = await chatMemory.selectRelevantMemories([corruptRow, supportingRow], 'Tolong ingat soal Ayah dan kopi', {
    checkpointSummary: 'Pembahasan tentang keluarga dan preferensi kopi.'
  });

  assert(selection.items.some(item => item.key === 'warisan_ayah'), 'Corrupt legacy row should still remain retrievable');

  return {
    fallback_legacy: parsed.fallback_legacy,
    corrupted_json: parsed.corrupted_json,
    selected_keys: selection.items.map(item => item.key)
  };
}

async function verifyConcurrentProvisionalMentions() {
  const supabase = new MockSupabase();
  const ownerPersonId = 'person-owner-1';
  const mentionText = 'Saya cerita soal teman Budi.';
  const tasks = Array.from({ length: 6 }, (_, index) => chatMemory.trackProvisionalFriend(
    supabase,
    ownerPersonId,
    mentionText,
    {
      sourceMessageId: `msg-${index + 1}`,
      sourcePersonId: ownerPersonId
    }
  ));

  await Promise.all(tasks);

  const provisionalRows = supabase.tables.person_memory.filter(row => row.person_id === ownerPersonId && row.key === 'mention_budi');
  assert.equal(provisionalRows.length, 1, 'Concurrent provisional mentions should only create one row');

  const valueState = chatMemory.safeParseValue(provisionalRows[0]);
  assert.equal(valueState.mention_count, 6, 'Atomic mention count should reflect all concurrent updates');
  assert.equal(provisionalRows[0].observation_count, 6, 'Observation count should stay aligned with mention_count');
  assert.equal(supabase.tables.legacy_audit_log.length, 6, 'Each provisional mention should still emit an audit row');

  return {
    key: provisionalRows[0].key,
    mention_count: valueState.mention_count,
    audit_rows: supabase.tables.legacy_audit_log.length
  };
}

async function verifyMemoryBudgetOverflow() {
  const ownerPersonId = 'person-owner-2';
  const seededRows = Array.from({ length: 75 }, (_, index) => buildDynamicMemoryRow(ownerPersonId, index + 1));
  const supabase = new MockSupabase({ person_memory: seededRows });

  const result = await chatMemory.applyMemoryDecayAndBudget(supabase, ownerPersonId, {
    userId: 'user-owner-2',
    lockedKeys: new Set()
  });

  const allRows = supabase.tables.person_memory.filter(row => row.person_id === ownerPersonId);
  const activeRows = allRows.filter(row => row.status === 'active');
  const archivedRows = allRows.filter(row => row.status === 'archived');

  assert.equal(allRows.length, 75, 'Budget archive should not drop memory rows');
  assert.equal(activeRows.length, 70, 'Active memories should be trimmed to budget');
  assert.equal(archivedRows.length, 5, 'Overflow rows should be archived, not deleted');
  assert.equal(result.archived, 5, 'Archive count should match overflow');
  assert(result.decayed >= 70, 'Old dynamic memories should still go through decay');

  return {
    decayed: result.decayed,
    archived: result.archived,
    total_rows: allRows.length,
    active_rows: activeRows.length
  };
}

async function verifyRelationshipFallback() {
  const ownerPersonId = 'person-owner-3';

  const fallbackSupabase = new MockSupabase({
    person_memory: [{
      id: 'placeholder-budi',
      person_id: ownerPersonId,
      key: 'mention_budi',
      value: JSON.stringify({
        subject: 'Budi',
        relation: 'teman',
        value: 'Teman kantor lama',
        source_context: 'friend_via_account',
        mention_count: 3,
        status: 'pending',
        semantic_category: 'relasi'
      }),
      memory_type: 'fakta',
      category: 'provisional_friend',
      status: 'active',
      memory_scope: 'dynamic',
      confidence: 0.51,
      observation_count: 3,
      priority_score: 0.46,
      updated_at: createIso(1),
      created_at: createIso(3)
    }]
  }, {
    failRelationshipMetadataOnce: true
  });

  const recovered = await chatMemory.confirmFriend(fallbackSupabase, {
    ownerPersonId,
    friendName: 'Budi',
    relationshipType: 'teman',
    introMessage: 'Budi teman kantor saya.',
    placeholderPersonId: ownerPersonId
  });

  assert.equal(recovered.confirmed, true, 'Fallback upsert should still confirm the relationship');
  assert.equal(recovered.relationshipWarning, null, 'Recovered fallback should not leave a warning');
  assert.equal(recovered.relationshipValidation.ok, true, 'Recovered fallback should return valid relationship validation');
  assert.equal(fallbackSupabase.tables.relationships.length, 2, 'Bidirectional relationship rows should be persisted');
  assert.equal(fallbackSupabase.tables.person_memory[0].status, 'archived', 'Placeholder should be archived after successful confirmation');

  const warningSupabase = new MockSupabase({
    person_memory: [{
      id: 'placeholder-sari',
      person_id: ownerPersonId,
      key: 'mention_sari',
      value: JSON.stringify({
        subject: 'Sari',
        relation: 'teman',
        value: 'Teman kuliah',
        source_context: 'friend_via_account',
        mention_count: 2,
        status: 'pending',
        semantic_category: 'relasi'
      }),
      memory_type: 'fakta',
      category: 'provisional_friend',
      status: 'active',
      memory_scope: 'dynamic',
      confidence: 0.43,
      observation_count: 2,
      priority_score: 0.36,
      updated_at: createIso(1),
      created_at: createIso(2)
    }]
  }, {
    failRelationshipMetadataOnce: true,
    failRelationshipFallback: true
  });

  const warned = await chatMemory.confirmFriend(warningSupabase, {
    ownerPersonId,
    friendName: 'Sari',
    relationshipType: 'teman',
    introMessage: 'Sari teman kuliah saya.',
    placeholderPersonId: ownerPersonId
  });

  assert.equal(warned.confirmed, false, 'Hard relationship failure should not masquerade as confirmed');
  assert(warned.relationshipWarning, 'Hard relationship failure should surface warning metadata');
  assert.equal(warned.relationshipMode, 'basic_upsert', 'Hard relationship failure should report fallback mode');
  assert.equal(warningSupabase.tables.persons.length, 1, 'Friend person row should still be preserved');
  assert.equal(warningSupabase.tables.relationships.length, 0, 'Failed relationship upsert should not create partial rows');
  assert.equal(warningSupabase.tables.person_memory[0].status, 'active', 'Placeholder should remain active if confirmation did not persist');

  return {
    recovered_confirmed: recovered.confirmed,
    recovered_mode: recovered.relationshipMode,
    warned_confirmed: warned.confirmed,
    warning_code: warned.relationshipWarning.code,
    warning_mode: warned.relationshipWarning.mode || null
  };
}

async function verifyFamilyAliasSubjectResolution() {
  const knownFriends = [
    {
      name: 'Budi',
      relation: 'teman',
      aliases: ['budi']
    }
  ];
  const familyMembers = [
    {
      id: 'person-ayah',
      name: 'Teguh Putra',
      relation: 'ayah',
      aliases: ['abi', 'bapak', 'papa', 'ayah']
    },
    {
      id: 'person-ibu',
      name: 'Rosalia',
      relation: 'ibu',
      aliases: ['ummi', 'mama', 'ibu', 'istri']
    },
    {
      id: 'person-anak',
      name: 'Aqil',
      relation: 'anak',
      aliases: ['aqil']
    }
  ];

  const ownerAliasSubject = chatMemory.resolveSubject('Bagaimana abi dulu saat kerja?', [], {
    currentPersonName: 'Aqil',
    familyMembers,
    familyNames: familyMembers.map(member => member.name)
  });
  assert.equal(ownerAliasSubject?.subject, 'Teguh Putra', 'Alias abi harus dipetakan ke subject ayah yang canonical');

  const canonicalNestedSubject = chatMemory.resolveSubject('Istri Teguh Putra lagi capek akhir-akhir ini', knownFriends, {
    currentPersonName: 'Aqil',
    familyMembers,
    familyNames: familyMembers.map(member => member.name)
  });
  assert.equal(canonicalNestedSubject?.subject, 'Rosalia', 'Nested relation yang masih berada dalam graph keluarga harus tetap dipetakan ke person canonical');

  const spouseAliasSubject = chatMemory.resolveSubject('Istri lagi capek akhir-akhir ini', [], {
    currentPersonName: 'Teguh Putra',
    familyMembers,
    familyNames: familyMembers.map(member => member.name)
  });
  assert.equal(spouseAliasSubject?.subject, 'Rosalia', 'Alias istri harus dipetakan ke pasangan canonical');

  const spouseSayaAliasSubject = chatMemory.resolveSubject('Bagaimana istri saya sekarang?', [], {
    currentPersonName: 'Teguh Putra',
    familyMembers,
    familyNames: familyMembers.map(member => member.name)
  });
  assert.equal(spouseSayaAliasSubject?.subject, 'Rosalia', 'Frasa seperti "istri saya" harus tetap dipetakan ke pasangan canonical, bukan ke diri sendiri');

  const compositeNestedSubject = chatMemory.resolveSubject('Istri Budi sedang sakit', knownFriends, {
    currentPersonName: 'Teguh Putra',
    familyMembers,
    familyNames: familyMembers.map(member => member.name)
  });
  assert.equal(compositeNestedSubject?.subject, 'Istri Budi', 'Nested relation non-keluarga harus menjadi subject komposit, bukan diarahkan ke keluarga user');

  const compositeParentSubject = chatMemory.resolveSubject('Ayah temanku Budi keras orangnya', knownFriends, {
    currentPersonName: 'Teguh Putra',
    familyMembers,
    familyNames: familyMembers.map(member => member.name)
  });
  assert.equal(compositeParentSubject?.subject, 'Ayah Budi', 'Nested relation bertingkat harus tetap mengikat ke owner subjek yang benar');

  const nestedRelationSubject = chatMemory.resolveSubject('Istri temanku sedang sakit', [], {
    currentPersonName: 'Teguh Putra',
    familyMembers,
    familyNames: familyMembers.map(member => member.name)
  });
  assert.notEqual(nestedRelationSubject?.subject, 'Rosalia', 'Frasa nested relation seperti "istri temanku" tidak boleh salah dipetakan ke istri user');

  const extracted = chatMemory.filterMemoryUpserts([
    {
      key: 'pola_pikir_inti',
      value: 'abi selalu suka berpikir sistematis',
      memoryType: 'cara_berpikir',
      category: 'cara_berpikir'
    }
  ], {
    maxItems: 3,
    userMessage: 'Abi itu dulu suka berpikir sistematis kalau ada masalah.',
    currentPersonName: 'Aqil',
    familyMembers,
    familyNames: familyMembers.map(member => member.name)
  });

  assert.equal(extracted.accepted.length, 1, 'Memory upsert tentang abi harus lolos sebagai satu kandidat valid');
  const extractedMetadata = chatMemory.extractStructuredMemoryMetadata(extracted.accepted[0]);
  assert.equal(extractedMetadata.subject, 'Teguh Putra', 'Structured memory harus menyimpan subject canonical untuk alias abi');

  const compositeExtracted = chatMemory.filterMemoryUpserts([
    {
      key: 'kebiasaan_pagi',
      value: 'ayah temanku Budi suka bangun subuh',
      memoryType: 'kebiasaan',
      category: 'kebiasaan'
    }
  ], {
    maxItems: 3,
    userMessage: 'Ayah temanku Budi suka bangun subuh dan rutin jalan pagi sebelum kerja.',
    currentPersonName: 'Teguh Putra',
    knownFriends,
    familyMembers,
    familyNames: familyMembers.map(member => member.name)
  });

  assert.equal(compositeExtracted.accepted.length, 1, 'Memory upsert nested relation non-keluarga harus tetap bisa diekstrak');
  const compositeExtractedMetadata = chatMemory.extractStructuredMemoryMetadata(compositeExtracted.accepted[0]);
  assert.equal(compositeExtractedMetadata.subject, 'Ayah Budi', 'Structured memory nested relation harus menyimpan subject komposit yang tepat');
  assert(!/^ayah temanku budi\b/i.test(String(compositeExtractedMetadata.value || '')), 'Narrative memory nested relation harus dibersihkan dari prefix referensi');
  assert(/bangun subuh|jalan pagi/i.test(String(compositeExtractedMetadata.value || '')), 'Narrative memory nested relation harus tetap menyimpan inti kebiasaan');

  const evidenceRecord = chatMemory.buildMemoryEvidenceRecord({
    personId: 'person-ayah',
    memory: extracted.accepted[0],
    userMessage: 'Bagian awal hanya pembuka, tetapi inti pentingnya ada di akhir: abi alergi kacang dan harus dibawa ke dokter malam ini.',
    recentHistory: [
      { role: 'assistant', content: 'Coba ceritakan konteksnya dulu.' },
      { role: 'user', content: 'Tadi siang abi makan sesuatu yang tidak cocok.' }
    ]
  });
  const parsedContextWindow = JSON.parse(evidenceRecord.context_window || '{}');
  assert.equal(parsedContextWindow.version, 2, 'Context window evidence harus memakai format versi baru');
  assert.equal(parsedContextWindow.current_message, 'Bagian awal hanya pembuka, tetapi inti pentingnya ada di akhir: abi alergi kacang dan harus dibawa ke dokter malam ini.', 'Current message harus tersimpan penuh di context window evidence');
  assert(Array.isArray(parsedContextWindow.recent_turns) && parsedContextWindow.recent_turns.length === 2, 'Recent turns penuh harus ikut tersimpan di context window evidence');
  assert(/alergi kacang/.test(parsedContextWindow.summary || ''), 'Summary context evidence harus tetap memuat inti penting yang ada di bagian akhir pesan');

  return {
    owner_alias_subject: ownerAliasSubject?.subject || null,
    canonical_nested_subject: canonicalNestedSubject?.subject || null,
    spouse_alias_subject: spouseAliasSubject?.subject || null,
    spouse_saya_alias_subject: spouseSayaAliasSubject?.subject || null,
    composite_nested_subject: compositeNestedSubject?.subject || null,
    composite_parent_subject: compositeParentSubject?.subject || null,
    nested_relation_subject: nestedRelationSubject?.subject || null,
    extracted_subject: extractedMetadata.subject || null,
    composite_extracted_subject: compositeExtractedMetadata.subject || null,
    extracted_key: extracted.accepted[0]?.key || null,
    evidence_context_version: parsedContextWindow.version || null
  };
}

async function main() {
  const scenarioResults = [];

  scenarioResults.push(await runScenario('corrupt-json-value', verifyCorruptJsonFallback));
  scenarioResults.push(await runScenario('concurrent-provisional-mention', verifyConcurrentProvisionalMentions));
  scenarioResults.push(await runScenario('active-memory-budget-overflow', verifyMemoryBudgetOverflow));
  scenarioResults.push(await runScenario('relationship-upsert-constraint-fallback', verifyRelationshipFallback));
  scenarioResults.push(await runScenario('family-alias-subject-resolution', verifyFamilyAliasSubjectResolution));

  emitLog({
    type: 'verification_summary',
    status: 'pass',
    total_scenarios: scenarioResults.length,
    passed_scenarios: scenarioResults.filter(result => result.status === 'pass').length,
    failed_scenarios: scenarioResults.filter(result => result.status !== 'pass').length
  });
}

main().catch(error => {
  emitLog({
    type: 'verification_summary',
    status: 'fail',
    error: serializeError(error)
  });
  process.exitCode = 1;
});