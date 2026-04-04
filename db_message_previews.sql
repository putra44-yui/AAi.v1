-- =========================================
-- 8. MESSAGE PREVIEWS (AUDIT AMBIGUITAS)
-- =========================================
create table if not exists message_previews (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_message_id uuid references messages(id) on delete set null,
  assistant_message_id uuid references messages(id) on delete set null,
  is_ambiguous boolean not null default false,
  confidence double precision,
  reason_codes text[] default '{}',
  preview_json jsonb not null,
  created_at timestamp with time zone default now()
);

create index if not exists idx_message_previews_session_created
  on message_previews(session_id, created_at desc);

create index if not exists idx_message_previews_assistant
  on message_previews(assistant_message_id);

create index if not exists idx_message_previews_user
  on message_previews(user_message_id);

create index if not exists idx_message_previews_preview_json_gin
  on message_previews using gin(preview_json);
