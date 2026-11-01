-- Optional display-only tool progress for AAi chats reopened on another device.
-- Chat content remains in messages.content; this stores public activity, not reasoning.
alter table public.messages add column if not exists activity_trace jsonb;

comment on column public.messages.activity_trace is
  'Bounded public-facing progress steps and verified tool sources for cross-device AAi chat history; no hidden chain of thought.';
