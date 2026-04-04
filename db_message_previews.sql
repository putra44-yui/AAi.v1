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
  add column if not exists source_message_id uuid references messages(id) on delete set null;

create index if not exists idx_person_memory_updated on person_memory(person_id, updated_at desc);

-- Trigger: auto-increment observation_count & updated_at saat memori diperbarui
create or replace function update_person_memory_on_update()
returns trigger as $$
begin
  new.updated_at = now();
  new.observation_count = coalesce(old.observation_count, 0) + 1;
  -- Naikkan confidence semakin sering teramati (cap di 0.98)
  new.confidence = least(0.98, coalesce(old.confidence, 0.7) + 0.05);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_update_person_memory on person_memory;
create trigger trigger_update_person_memory
before update on person_memory
for each row
execute function update_person_memory_on_update();

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