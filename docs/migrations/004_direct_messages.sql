-- ============================================================================
-- AiG migration 004 — private direct messages between accepted connections
-- ============================================================================
-- Run once in Supabase Dashboard → SQL Editor → New query → Run.
-- Backs src/lib/db.js: listDirectMessages(), sendDirectMessage(),
-- subscribeDirectMessages() — same realtime pattern as dataset_messages
-- (migration 001), scoped to a single sender/recipient pair instead of a
-- shared dataset, and gated on an accepted user_connections row so only
-- connected users can message each other.

create table if not exists public.direct_messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body         text not null,
  created_at   timestamptz not null default now()
);

create index if not exists direct_messages_pair_idx
  on public.direct_messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at);

alter table public.direct_messages enable row level security;

drop policy if exists direct_messages_select on public.direct_messages;
create policy direct_messages_select on public.direct_messages
  for select using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists direct_messages_insert on public.direct_messages;
create policy direct_messages_insert on public.direct_messages
  for insert with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.user_connections
      where status = 'accepted'
        and (
          (requester_id = sender_id and addressee_id = recipient_id)
          or (requester_id = recipient_id and addressee_id = sender_id)
        )
    )
  );

-- Enable Realtime for this table so subscribeDirectMessages() (db.js) gets
-- live INSERT events, matching dataset_messages' existing behaviour.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'direct_messages'
  ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
end $$;
