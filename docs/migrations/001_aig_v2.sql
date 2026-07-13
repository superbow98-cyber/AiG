-- ============================================================================
-- AiG v2 migration — database fix + new collaboration features
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL → New query).
--
-- Safe / backward compatible:
--   * Only ADDS columns and tables (IF NOT EXISTS) — nothing is dropped.
--   * Existing rows and existing columns are untouched.
--   * Re-runnable (idempotent) — policies are dropped-then-created.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- for gen_random_uuid()

-- ---------------------------------------------------------------------------
-- 1. profiles  — needed so users can search/find each other (auth.users is
--    not readable by the anon/authenticated role directly)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_read_all   on public.profiles;
drop policy if exists profiles_upsert_self on public.profiles;
drop policy if exists profiles_update_self on public.profiles;

-- any signed-in user can read profiles (to search & connect)
create policy profiles_read_all on public.profiles
  for select using (auth.role() = 'authenticated');
create policy profiles_upsert_self on public.profiles
  for insert with check (auth.uid() = id);
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id);

-- auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(coalesce(new.email,''), '@', 1))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- backfill profiles for users that already exist
insert into public.profiles (id, email, display_name)
select id, email, split_part(coalesce(email,''), '@', 1)
from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. datasets — a grouping that links GPR + XRF + AI results together and
--    carries the sharing/visibility setting
-- ---------------------------------------------------------------------------
create table if not exists public.datasets (
  dataset_id        text primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  site_id           text,
  title             text,
  artifact_category text,
  visibility        text not null default 'private'
                    check (visibility in ('private','connected','public')),
  created_at        timestamptz not null default now()
);

alter table public.datasets enable row level security;

-- ---------------------------------------------------------------------------
-- 3. user_connections — connect / share network
-- ---------------------------------------------------------------------------
create table if not exists public.user_connections (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references auth.users(id) on delete cascade,
  addressee_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','accepted')),
  created_at    timestamptz not null default now(),
  unique (requester_id, addressee_id)
);

alter table public.user_connections enable row level security;

drop policy if exists conn_select      on public.user_connections;
drop policy if exists conn_insert       on public.user_connections;
drop policy if exists conn_update        on public.user_connections;
create policy conn_select on public.user_connections
  for select using (auth.uid() = requester_id or auth.uid() = addressee_id);
create policy conn_insert on public.user_connections
  for insert with check (auth.uid() = requester_id);
create policy conn_update on public.user_connections
  for update using (auth.uid() = addressee_id or auth.uid() = requester_id);

-- helper: are two users connected (accepted, either direction)?
create or replace function public.are_connected(a uuid, b uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.user_connections c
    where c.status = 'accepted'
      and ((c.requester_id = a and c.addressee_id = b)
        or (c.requester_id = b and c.addressee_id = a))
  );
$$;

-- datasets policies (needs are_connected)
drop policy if exists datasets_owner    on public.datasets;
drop policy if exists datasets_read      on public.datasets;
create policy datasets_owner on public.datasets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy datasets_read on public.datasets
  for select using (
    auth.uid() = user_id
    or visibility = 'public'
    or (visibility = 'connected' and public.are_connected(auth.uid(), user_id))
  );

-- ---------------------------------------------------------------------------
-- 4. dataset_shares — explicit per-user share (optional, finer-grained)
-- ---------------------------------------------------------------------------
create table if not exists public.dataset_shares (
  id           uuid primary key default gen_random_uuid(),
  dataset_id   text not null references public.datasets(dataset_id) on delete cascade,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  shared_with  uuid not null references auth.users(id) on delete cascade,
  permission   text not null default 'read' check (permission in ('read','comment')),
  created_at   timestamptz not null default now(),
  unique (dataset_id, shared_with)
);

alter table public.dataset_shares enable row level security;

drop policy if exists shares_owner  on public.dataset_shares;
drop policy if exists shares_read    on public.dataset_shares;
create policy shares_owner on public.dataset_shares
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy shares_read on public.dataset_shares
  for select using (auth.uid() = owner_id or auth.uid() = shared_with);

-- helper: can the current user access a dataset (owner / public / connected / shared)?
create or replace function public.can_access_dataset(ds text)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.datasets d
    where d.dataset_id = ds
      and (
        d.user_id = auth.uid()
        or d.visibility = 'public'
        or (d.visibility = 'connected' and public.are_connected(auth.uid(), d.user_id))
      )
  )
  or exists (
    select 1 from public.dataset_shares s
    where s.dataset_id = ds and s.shared_with = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. dataset_messages — "Chat on Dataset" discussion thread
-- ---------------------------------------------------------------------------
create table if not exists public.dataset_messages (
  id          uuid primary key default gen_random_uuid(),
  dataset_id  text not null,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

alter table public.dataset_messages enable row level security;

drop policy if exists msg_read   on public.dataset_messages;
drop policy if exists msg_insert  on public.dataset_messages;
create policy msg_read on public.dataset_messages
  for select using (public.can_access_dataset(dataset_id));
create policy msg_insert on public.dataset_messages
  for insert with check (auth.uid() = user_id and public.can_access_dataset(dataset_id));

-- realtime for live chat
do $$ begin
  begin
    alter publication supabase_realtime add table public.dataset_messages;
  exception when duplicate_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 6. gpr_xrf_records — ensure base + ADD required fields (backward compatible)
-- ---------------------------------------------------------------------------
create table if not exists public.gpr_xrf_records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.gpr_xrf_records
  add column if not exists user_id          uuid default auth.uid(),
  add column if not exists dataset_id        text,
  add column if not exists site_id           text,
  add column if not exists material_id        text,
  add column if not exists artifact_category  text,
  add column if not exists scan_filename      text,
  add column if not exists gpr_signature      double precision[],
  add column if not exists gpr_features        jsonb,
  add column if not exists xrf_features        jsonb,
  add column if not exists fusion_output       jsonb,
  add column if not exists hyperbola_shape     jsonb,
  add column if not exists position_trace      integer,
  add column if not exists position_m          double precision,
  add column if not exists depth_ns            double precision,
  add column if not exists depth_m             double precision,
  add column if not exists size_width_cm       double precision,
  add column if not exists size_height_cm      double precision,
  add column if not exists xrf_material        text,
  add column if not exists xrf_elements        jsonb,
  add column if not exists ai_prediction       text,
  add column if not exists confidence          double precision,
  add column if not exists predicted_material  text,
  add column if not exists predicted_confidence double precision,
  add column if not exists gps_lat             double precision,
  add column if not exists gps_lng             double precision,
  add column if not exists excavation_date     date,
  add column if not exists notes               text,
  add column if not exists created_at          timestamptz default now();

alter table public.gpr_xrf_records enable row level security;

drop policy if exists rec_owner_all on public.gpr_xrf_records;
drop policy if exists rec_read       on public.gpr_xrf_records;
drop policy if exists rec_insert_own on public.gpr_xrf_records;
-- FIX for "save shows success but DB stays empty": inserts require the row's
-- user_id to equal the signed-in user. Owner can do everything on own rows;
-- shared/public dataset rows are readable by permitted users.
create policy rec_insert_own on public.gpr_xrf_records
  for insert with check (auth.uid() = user_id);
create policy rec_owner_all on public.gpr_xrf_records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy rec_read on public.gpr_xrf_records
  for select using (
    auth.uid() = user_id
    or (dataset_id is not null and public.can_access_dataset(dataset_id))
  );

-- ---------------------------------------------------------------------------
-- 7. gpr_scans — ensure base + add dataset_id link + RLS
-- ---------------------------------------------------------------------------
create table if not exists public.gpr_scans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.gpr_scans
  add column if not exists user_id     uuid default auth.uid(),
  add column if not exists dataset_id   text,
  add column if not exists filename     text,
  add column if not exists format       text,
  add column if not exists traces       integer,
  add column if not exists samples      integer,
  add column if not exists dt_ns        double precision,
  add column if not exists dx_m         double precision,
  add column if not exists scan_data    jsonb,
  add column if not exists created_at   timestamptz default now();

alter table public.gpr_scans enable row level security;

drop policy if exists scans_owner_all on public.gpr_scans;
drop policy if exists scans_read       on public.gpr_scans;
create policy scans_owner_all on public.gpr_scans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy scans_read on public.gpr_scans
  for select using (
    auth.uid() = user_id
    or (dataset_id is not null and public.can_access_dataset(dataset_id))
  );

-- ---------------------------------------------------------------------------
-- 8. Helpful indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_records_user     on public.gpr_xrf_records(user_id);
create index if not exists idx_records_dataset  on public.gpr_xrf_records(dataset_id);
create index if not exists idx_scans_user       on public.gpr_scans(user_id);
create index if not exists idx_scans_dataset    on public.gpr_scans(dataset_id);
create index if not exists idx_msg_dataset      on public.dataset_messages(dataset_id, created_at);
create index if not exists idx_conn_addressee   on public.user_connections(addressee_id, status);

-- Done. See docs/DATABASE_FIX_AND_SETUP.md for the test checklist.
