create or replace function safe_jsonb_object(input_text text)
returns jsonb
language plpgsql
as $$
declare
  parsed jsonb;
begin
  if input_text is null or btrim(input_text) = '' then
    return '{}'::jsonb;
  end if;

  begin
    parsed := input_text::jsonb;
  exception when others then
    return '{}'::jsonb;
  end;

  if jsonb_typeof(parsed) <> 'object' then
    return '{}'::jsonb;
  end if;

  return parsed;
end;
$$;

create or replace function upsert_provisional_friend_mention(
  p_person_id uuid,
  p_key text,
  p_subject text,
  p_relation text default 'teman',
  p_context text default null,
  p_value text default null,
  p_source_context text default 'friend_via_account',
  p_source_message_id uuid default null,
  p_source_person_id uuid default null
)
returns table (
  id uuid,
  key text,
  value text,
  observation_count integer,
  category text,
  status text,
  memory_scope text,
  confidence double precision,
  priority_score double precision,
  previous_mention_count integer,
  current_mention_count integer,
  was_inserted boolean
)
language plpgsql
as $$
declare
  inserted_row person_memory%rowtype;
  now_iso text := to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  insert into person_memory (
    person_id,
    key,
    value,
    memory_type,
    category,
    status,
    memory_scope,
    confidence,
    observation_count,
    priority_score,
    source_message_id,
    source_person_id
  )
  values (
    p_person_id,
    p_key,
    jsonb_build_object(
      'subject', coalesce(nullif(p_subject, ''), ''),
      'relation', coalesce(nullif(p_relation, ''), 'teman'),
      'value', coalesce(nullif(p_value, ''), nullif(p_context, ''), ''),
      'source_context', coalesce(nullif(p_source_context, ''), 'friend_via_account'),
      'mention_count', 1,
      'first_seen', now_iso,
      'last_seen', now_iso,
      'status', 'pending',
      'semantic_category', 'relasi',
      'cctv_ready', false
    )::text,
    'fakta',
    'provisional_friend',
    'active',
    'dynamic',
    0.35,
    1,
    0.28,
    p_source_message_id,
    p_source_person_id
  )
  on conflict (person_id, key) do nothing
  returning * into inserted_row;

  if found then
    return query
    select
      inserted_row.id,
      inserted_row.key,
      inserted_row.value,
      inserted_row.observation_count,
      inserted_row.category,
      inserted_row.status,
      inserted_row.memory_scope,
      inserted_row.confidence,
      inserted_row.priority_score,
      0,
      1,
      true;
    return;
  end if;

  return query
  with current_row as (
    select
      pm.id,
      pm.key,
      pm.value,
      pm.observation_count,
      pm.category,
      pm.status,
      pm.memory_scope,
      pm.confidence,
      pm.priority_score,
      safe_jsonb_object(pm.value) as meta,
      greatest(
        1,
        coalesce(
          nullif(safe_jsonb_object(pm.value) ->> 'mention_count', '')::integer,
          pm.observation_count,
          0
        )
      ) as previous_count
    from person_memory pm
    where pm.person_id = p_person_id
      and pm.key = p_key
    for update
  ),
  updated as (
    update person_memory pm
    set
      value = jsonb_set(
        current_row.meta || jsonb_build_object(
          'subject', coalesce(nullif(p_subject, ''), current_row.meta ->> 'subject', ''),
          'relation', coalesce(nullif(p_relation, ''), current_row.meta ->> 'relation', 'teman'),
          'value', coalesce(nullif(p_value, ''), nullif(p_context, ''), current_row.meta ->> 'value', ''),
          'source_context', coalesce(nullif(p_source_context, ''), current_row.meta ->> 'source_context', 'friend_via_account'),
          'first_seen', coalesce(current_row.meta ->> 'first_seen', now_iso),
          'last_seen', now_iso,
          'status', 'pending',
          'semantic_category', 'relasi'
        ),
        '{mention_count}',
        to_jsonb(current_row.previous_count + 1),
        true
      )::text,
      memory_type = 'fakta',
      category = 'provisional_friend',
      status = 'active',
      memory_scope = 'dynamic',
      observation_count = current_row.previous_count + 1,
      confidence = least(0.72, greatest(0.35, 0.35 + (current_row.previous_count * 0.08))),
      priority_score = least(0.70, greatest(0.20, 0.20 + ((current_row.previous_count + 1) * 0.08))),
      source_message_id = coalesce(p_source_message_id, pm.source_message_id),
      source_person_id = coalesce(p_source_person_id, pm.source_person_id)
    from current_row
    where pm.id = current_row.id
    returning
      pm.id,
      pm.key,
      pm.value,
      pm.observation_count,
      pm.category,
      pm.status,
      pm.memory_scope,
      pm.confidence,
      pm.priority_score,
      current_row.previous_count as previous_mention_count,
      current_row.previous_count + 1 as current_mention_count,
      false as was_inserted
  )
  select
    updated.id,
    updated.key,
    updated.value,
    updated.observation_count,
    updated.category,
    updated.status,
    updated.memory_scope,
    updated.confidence,
    updated.priority_score,
    updated.previous_mention_count,
    updated.current_mention_count,
    updated.was_inserted
  from updated;
end;
$$;