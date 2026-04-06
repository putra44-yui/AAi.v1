-- =========================================
-- AAi FAMILY AI SYSTEM - DATABASE SCHEMA
-- PostgreSQL 14+ | Production-Ready
-- =========================================
BEGIN;

-- 0. EXTENSION
create extension if not exists "uuid-ossp";

-- 1. PERSONS (IDENTITAS MANUSIA)
create table if not exists persons (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  date_of_birth date,
  role text check (role in ('ayah', 'ibu', 'anak')),
  description text,
  created_at timestamptz default now()
);
comment on table persons is 'Identitas manusia dalam keluarga';
comment on column persons.role is 'Peran: ayah, ibu, anak';

-- 2. USERS (AKUN LOGIN)
create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  username text unique not null,
  person_id uuid references persons(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists idx_users_person_id on users(person_id);

-- 3. RELATIONSHIPS (HUBUNGAN ANTAR PERSON)
create table if not exists relationships (
  id uuid primary key default uuid_generate_v4(),
  person_a uuid references persons(id) on delete cascade,
  person_b uuid references persons(id) on delete cascade,
  relation_type text not null,
  created_at timestamptz default now(),
  constraint uq_relationship_pair unique (person_a, person_b, relation_type)
);
create index if not exists idx_relationships_person_a on relationships(person_a);
create index if not exists idx_relationships_person_b on relationships(person_b);

-- 4. AI PERSONAS (GAYA AI)
create table if not exists ai_personas (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  system_prompt text not null,
  is_active boolean default false,
  created_at timestamptz default now()
);
-- Pastikan hanya 1 persona yang aktif dalam 1 waktu
-- create unique index if not exists idx_ai_personas_active on ai_personas(is_active) where is_active = true;
drop index if exists idx_ai_personas_active;

-- 5. SESSIONS (GRUP CHAT)
create table if not exists sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete cascade,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_sessions_user_id on sessions(user_id);

-- 6. MESSAGES (HISTORI CHAT)
create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid references sessions(id) on delete cascade,
  role text check (role in ('user', 'assistant')) not null,
  content text not null,
  persona_id uuid references ai_personas(id) on delete set null,
  parent_id uuid references messages(id) on delete cascade,
  created_at timestamptz default now()
);
create index if not exists idx_messages_session_id on messages(session_id);
create index if not exists idx_messages_persona_id on messages(persona_id);
create index if not exists idx_messages_parent_id on messages(parent_id);
create index if not exists idx_messages_session_created on messages(session_id, created_at);

-- 6.1 MIGRATION: Session checkpoint summary untuk mode Compact
alter table sessions
  add column if not exists compact_checkpoint_summary text,
  add column if not exists compact_checkpoint_message_id uuid references messages(id) on delete set null,
  add column if not exists compact_checkpoint_at timestamptz;

create index if not exists idx_sessions_compact_checkpoint_at on sessions(compact_checkpoint_at desc);

-- 7. PERSON MEMORY (OPSIONAL – FUTURE AI MEMORY)
create table if not exists person_memory (
  id uuid primary key default uuid_generate_v4(),
  person_id uuid references persons(id) on delete cascade,
  key text not null,
  value text,
  created_at timestamptz default now()
);
create index if not exists idx_person_memory_person_id on person_memory(person_id);
create unique index if not exists idx_person_memory_person_key on person_memory(person_id, key);

-- 8. MESSAGE PREVIEWS (AUDIT AMBIGUITAS)
create table if not exists message_previews (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_message_id uuid references messages(id) on delete set null,
  assistant_message_id uuid references messages(id) on delete set null,
  is_ambiguous boolean not null default false,
  confidence double precision,
  reason_codes text[] default '{}',
  preview_json jsonb not null,
  created_at timestamptz default now()
);
create index if not exists idx_message_previews_session_created on message_previews(session_id, created_at desc);
create index if not exists idx_message_previews_assistant on message_previews(assistant_message_id);
create index if not exists idx_message_previews_user on message_previews(user_message_id);
create index if not exists idx_message_previews_preview_json_gin on message_previews using gin(preview_json);

-- TRIGGER: Auto-update sessions.updated_at
create or replace function update_sessions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_update_sessions on sessions;
create trigger trigger_update_sessions
before update on sessions
for each row
execute function update_sessions_updated_at();

-- 9. MIGRATION: Enhance person_memory for AI learning system
alter table person_memory
  add column if not exists confidence float default 0.7,
  add column if not exists observation_count int default 1,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists source_message_id uuid references messages(id) on delete set null,
  add column if not exists priority_score float default 0.5,
  add column if not exists memory_scope text default 'dynamic',
  add column if not exists memory_type text default 'fakta',
  add column if not exists category text default 'umum',
  add column if not exists status text default 'active',
  add column if not exists deleted_at timestamptz,
  add column if not exists deletion_reason text,
  add column if not exists deleted_by uuid references users(id) on delete set null;

alter table person_memory
  drop constraint if exists chk_person_memory_status;
alter table person_memory
  add constraint chk_person_memory_status check (status in ('active', 'archived', 'dropped'));

alter table person_memory
  drop constraint if exists chk_person_memory_type;
alter table person_memory
  add constraint chk_person_memory_type check (memory_type in ('pattern', 'kebiasaan', 'cara_berpikir', 'preferensi', 'emosi', 'fakta'));

alter table person_memory
  drop constraint if exists chk_person_memory_priority_score;
alter table person_memory
  add constraint chk_person_memory_priority_score check (priority_score >= 0 and priority_score <= 1);

alter table person_memory
  drop constraint if exists chk_person_memory_scope;
alter table person_memory
  add constraint chk_person_memory_scope check (memory_scope in ('stable', 'dynamic'));

create index if not exists idx_person_memory_updated on person_memory(person_id, updated_at desc);
create index if not exists idx_person_memory_priority on person_memory(person_id, status, priority_score desc, updated_at desc);
create index if not exists idx_person_memory_type_status on person_memory(person_id, memory_type, status, updated_at desc);
create index if not exists idx_person_memory_scope_status on person_memory(person_id, memory_scope, status, updated_at desc);

comment on column person_memory.memory_scope is 'stable untuk trait inti/identitas pokok, dynamic untuk emosi, kebiasaan, preferensi, dan konteks situasional';

-- 9.1 PLANNING MEMORY (GLOBAL PER PERSON, USER-MANAGED)
create table if not exists planning_memory (
  id uuid primary key default uuid_generate_v4(),
  person_id uuid not null references persons(id) on delete cascade,
  title text not null,
  content text default '',
  category text default 'rencana',
  tags text[] default '{}',
  priority int default 0,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_planning_memory_person_updated on planning_memory(person_id, updated_at desc);
create index if not exists idx_planning_memory_person_priority on planning_memory(person_id, priority desc, updated_at desc);
create index if not exists idx_planning_memory_category on planning_memory(person_id, category, updated_at desc);
create index if not exists idx_planning_memory_tags_gin on planning_memory using gin(tags);

alter table planning_memory
  add constraint chk_planning_memory_priority_range
  check (priority >= -10 and priority <= 10);

create or replace function update_planning_memory_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_update_planning_memory on planning_memory;
create trigger trigger_update_planning_memory
before update on planning_memory
for each row
execute function update_planning_memory_updated_at();

update person_memory
set priority_score = least(0.99, greatest(0.05, coalesce(confidence, 0.7) * greatest(0.3, least(1.0, coalesce(observation_count, 1) / 5.0))))
where priority_score is null or priority_score = 0.5;

update person_memory
set memory_scope = case
  when memory_type = 'cara_berpikir' then 'stable'
  when key in ('nama_panggilan', 'nama_lengkap', 'tanggal_lahir', 'tempat_lahir', 'domisili', 'profil_mbti', 'pola_pikir_inti', 'prinsip_keputusan', 'nilai_hidup') then 'stable'
  when memory_type = 'pattern' and (
    key like '%pola_pikir%'
    or key like '%mindset%'
    or key like '%prinsip%'
    or key like '%nilai%'
    or key like '%warisan%'
  ) then 'stable'
  else coalesce(memory_scope, 'dynamic')
end
where memory_scope is null or memory_scope not in ('stable', 'dynamic') or memory_scope = 'dynamic';

-- Trigger: recompute priority from explicit values, do not auto-promote confidence/count.
create or replace function update_person_memory_on_update()
returns trigger as $$
begin
  new.updated_at = now();
  new.observation_count = greatest(1, coalesce(new.observation_count, old.observation_count, 1));
  new.confidence = least(0.98, greatest(0.05, coalesce(new.confidence, old.confidence, 0.7)));
  new.memory_scope = coalesce(nullif(new.memory_scope, ''), old.memory_scope, 'dynamic');
  new.priority_score = least(0.99, greatest(0.05, new.confidence * greatest(0.3, least(1.0, new.observation_count / 5.0))));

  if new.status in ('archived', 'dropped') and old.status is distinct from new.status then
    new.deleted_at = now();
  end if;

  if new.status = 'active' and old.status is distinct from 'active' then
    new.deleted_at = null;
    new.deletion_reason = null;
    new.deleted_by = null;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_update_person_memory on person_memory;
create trigger trigger_update_person_memory
before update on person_memory
for each row
execute function update_person_memory_on_update();

-- 9.2 MEMORY EVIDENCE & LEGACY AUDIT
create table if not exists person_memory_evidence (
  id uuid primary key default uuid_generate_v4(),
  person_id uuid not null references persons(id) on delete cascade,
  memory_id uuid references person_memory(id) on delete set null,
  memory_key text not null,
  memory_type text not null default 'fakta',
  memory_value text not null,
  memory_scope text not null default 'dynamic',
  category text default 'umum',
  source_message_id uuid references messages(id) on delete set null,
  source_session_id uuid references sessions(id) on delete set null,
  unique_context_hash text not null,
  normalized_claim_hash text not null,
  evidence_status text not null default 'validated',
  reliability_score float default 0.5,
  emotional_state text default 'netral',
  emotion_confidence float default 0,
  style_signals text[] default '{}',
  context_window text,
  created_at timestamptz default now(),
  constraint uq_person_memory_evidence_context unique (person_id, unique_context_hash)
);

alter table person_memory_evidence
  drop constraint if exists chk_person_memory_evidence_type;
alter table person_memory_evidence
  add constraint chk_person_memory_evidence_type
  check (memory_type in ('pattern', 'kebiasaan', 'cara_berpikir', 'preferensi', 'emosi', 'fakta'));

alter table person_memory_evidence
  drop constraint if exists chk_person_memory_evidence_scope;
alter table person_memory_evidence
  add constraint chk_person_memory_evidence_scope
  check (memory_scope in ('stable', 'dynamic'));

alter table person_memory_evidence
  drop constraint if exists chk_person_memory_evidence_status;
alter table person_memory_evidence
  add constraint chk_person_memory_evidence_status
  check (evidence_status in ('validated', 'provisional', 'conflict', 'suppressed'));

alter table person_memory_evidence
  drop constraint if exists chk_person_memory_evidence_reliability;
alter table person_memory_evidence
  add constraint chk_person_memory_evidence_reliability
  check (reliability_score >= 0 and reliability_score <= 1);

alter table person_memory_evidence
  drop constraint if exists chk_person_memory_evidence_emotion_confidence;
alter table person_memory_evidence
  add constraint chk_person_memory_evidence_emotion_confidence
  check (emotion_confidence >= 0 and emotion_confidence <= 1);

create index if not exists idx_person_memory_evidence_person_created
  on person_memory_evidence(person_id, created_at desc);

create index if not exists idx_person_memory_evidence_memory_status
  on person_memory_evidence(memory_id, evidence_status, created_at desc);

create index if not exists idx_person_memory_evidence_key_status
  on person_memory_evidence(person_id, memory_key, memory_type, evidence_status, created_at desc);

create index if not exists idx_person_memory_evidence_claim_hash
  on person_memory_evidence(person_id, normalized_claim_hash, created_at desc);

comment on table person_memory_evidence is 'Append-only evidence rows untuk membedakan observasi independen dari pengulangan konteks yang sama';
comment on column person_memory_evidence.unique_context_hash is 'Hash konservatif yang mencegah claim sama dalam sesi/konteks sama menaikkan observation_count';

create table if not exists legacy_audit_log (
  id uuid primary key default uuid_generate_v4(),
  person_id uuid references persons(id) on delete cascade,
  memory_id uuid references person_memory(id) on delete set null,
  evidence_id uuid references person_memory_evidence(id) on delete set null,
  session_id uuid references sessions(id) on delete set null,
  source_message_id uuid references messages(id) on delete set null,
  event_type text not null,
  reason_code text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_legacy_audit_log_person_created
  on legacy_audit_log(person_id, created_at desc);

create index if not exists idx_legacy_audit_log_memory_created
  on legacy_audit_log(memory_id, created_at desc);

create index if not exists idx_legacy_audit_log_session_created
  on legacy_audit_log(session_id, created_at desc);

comment on table legacy_audit_log is 'Jejak keputusan memory governance: duplikasi konteks, provisional evidence, conflict, drift candidate, dan forget events';

-- =========================================
-- 10. FRIEND MEMORY SYSTEM SCHEMA (NEW)
-- =========================================
-- 10.1: Add friend_status field to relationships for metadata tracking
alter table relationships
  add column if not exists friend_status text default 'active',
  add column if not exists introduced_at timestamptz default now(),
  add column if not exists confidence float default 0.7,
  add column if not exists introduction_context text;

alter table relationships
  drop constraint if exists chk_relationships_friend_status;
alter table relationships
  add constraint chk_relationships_friend_status 
  check (friend_status in ('active', 'archived', 'pending_confirmation'));

comment on column relationships.friend_status is 'Status hubungan teman: active, archived, pending_confirmation';
comment on column relationships.introduced_at is 'Kapan teman dikenalkan/ditambahkan';
comment on column relationships.confidence is 'Tingkat kepercayaan akan hubungan ini (0-1)';
comment on column relationships.introduction_context is 'Context dari pengenalan awal (disimpan dari pesan intro)';

-- 10.2: Add indexes for fast friend lookups
create index if not exists idx_relationships_type_a 
  on relationships(person_a, relation_type) 
  where friend_status = 'active';

create index if not exists idx_relationships_type_b 
  on relationships(person_b, relation_type) 
  where friend_status = 'active';

create index if not exists idx_relationships_friend_type 
  on relationships(person_a, relation_type, introduced_at desc) 
  where relation_type IN ('teman', 'sahabat') AND friend_status = 'active';

-- 10.3: Add source_person_id to person_memory (tracks who told us this memory)
alter table person_memory
  add column if not exists source_person_id uuid references persons(id) on delete set null;

comment on column person_memory.source_person_id is 'Person ID yang memberitahu memory ini (jika dari teman, bukan self-memory)';

create index if not exists idx_person_memory_source_person 
  on person_memory(person_id, source_person_id, updated_at desc);

-- 10.4: Auto-update relationships.introduced_at trigger
create or replace function update_relationships_introduced_at()
returns trigger as $$
begin
  if new.introduced_at is null then
    new.introduced_at = now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_update_relationships_introduced_at on relationships;
create trigger trigger_update_relationships_introduced_at
before insert on relationships
for each row
execute function update_relationships_introduced_at();

-- =========================================
-- 11. FILE GENERATION JOBS (ASYNC FILE WORKER)
-- =========================================
create table if not exists file_generation_jobs (
  id uuid primary key default uuid_generate_v4(),
  message_id uuid not null references messages(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  status text not null default 'pending',
  source_text text not null,
  pending_text text not null,
  processed_text text,
  error_text text,
  file_count int not null default 0,
  attempt_count int not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table file_generation_jobs
  drop constraint if exists chk_file_generation_jobs_status;
alter table file_generation_jobs
  add constraint chk_file_generation_jobs_status
  check (status in ('pending', 'processing', 'ready', 'failed'));

alter table file_generation_jobs
  drop constraint if exists chk_file_generation_jobs_file_count;
alter table file_generation_jobs
  add constraint chk_file_generation_jobs_file_count check (file_count >= 0);

alter table file_generation_jobs
  drop constraint if exists chk_file_generation_jobs_attempt_count;
alter table file_generation_jobs
  add constraint chk_file_generation_jobs_attempt_count check (attempt_count >= 0);

create index if not exists idx_file_generation_jobs_status_created
  on file_generation_jobs(status, created_at asc);

create index if not exists idx_file_generation_jobs_message_id
  on file_generation_jobs(message_id);

create index if not exists idx_file_generation_jobs_session_id
  on file_generation_jobs(session_id, created_at desc);

create or replace function update_file_generation_jobs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_update_file_generation_jobs on file_generation_jobs;
create trigger trigger_update_file_generation_jobs
before update on file_generation_jobs
for each row
execute function update_file_generation_jobs_updated_at();

-- =========================================
-- PHASE 1: MEMORY LOCK GUARD
-- =========================================
create table if not exists memories (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  content text not null,
  evidence_chain jsonb not null default '[]'::jsonb,
  is_locked boolean not null default false,
  created_at timestamptz default now()
);

create index if not exists idx_memories_user_created on memories(user_id, created_at desc);
create index if not exists idx_memories_user_locked on memories(user_id, is_locked, created_at desc);
create index if not exists idx_memories_evidence_chain_gin on memories using gin(evidence_chain);

create table if not exists draft_memories (
  id uuid primary key default uuid_generate_v4(),
  memory_id uuid references memories(id) on delete set null,
  user_id uuid not null references users(id) on delete cascade,
  content text not null,
  evidence_chain jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_draft_memories_user_created on draft_memories(user_id, created_at desc);
create index if not exists idx_draft_memories_memory_id on draft_memories(memory_id);

-- =========================================
-- AUDIT TRAIL (FASE 0)
-- =========================================
create table if not exists audit_trail (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null,
  route text not null,
  method text not null,
  status_code int,
  timestamp timestamptz default now(),
  payload_summary text,
  constraint audit_trail_trace_idx unique (trace_id, timestamp)
);

create index if not exists idx_audit_trail_trace on audit_trail(trace_id);
create index if not exists idx_audit_trail_route on audit_trail(route);

COMMIT;

-- =========================================
-- 10. ARCHIVE: DATA DICTIONARY (UNTUK MANUSIA + AI)
-- =========================================
-- Daftar tabel inti di database ini:
-- 1) persons          : profil manusia dalam keluarga
-- 2) users            : akun login yang terhubung ke persons
-- 3) relationships    : relasi antar person (suami/istri/ayah-anak/dll)
-- 4) ai_personas      : persona/gaya AI yang bisa dipilih
-- 5) sessions         : ruang obrolan per user
-- 6) messages         : histori chat user/assistant
-- 7) person_memory    : memori preferensi/kebiasaan per person
-- 8) message_previews : audit preview ambigu untuk kontrol kualitas jawaban

-- Query inventaris tabel (jalankan manual di SQL Editor saat audit):
-- select table_name
-- from information_schema.tables
-- where table_schema = 'public'
-- order by table_name;

-- Query inventaris kolom per tabel (jalankan manual saat butuh konteks AI):
-- select table_name, ordinal_position, column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public'
-- order by table_name, ordinal_position;

-- Query inventaris foreign key (relasi antar tabel):
-- select
--   tc.table_name,
--   kcu.column_name,
--   ccu.table_name as foreign_table_name,
--   ccu.column_name as foreign_column_name
-- from information_schema.table_constraints tc
-- join information_schema.key_column_usage kcu
--   on tc.constraint_name = kcu.constraint_name
--  and tc.table_schema = kcu.table_schema
-- join information_schema.constraint_column_usage ccu
--   on ccu.constraint_name = tc.constraint_name
--  and ccu.table_schema = tc.table_schema
-- where tc.constraint_type = 'FOREIGN KEY'
--   and tc.table_schema = 'public'
-- order by tc.table_name, kcu.column_name;

-- Catatan eksekusi lokal (CLI) - ini bukan perintah SQL Editor:
-- psql -U postgres -d family_ai_dev -f schema.sql
-- \dt
-- \di