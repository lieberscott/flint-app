-- Flint MVP schema

create extension if not exists postgis;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  shirt_color text,
  created_at timestamptz not null default now()
);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  transit_line text not null,
  direction text not null,
  geohash text not null,
  car_number text,
  status text not null default 'open' check (status in ('open', 'ready', 'go', 'closed')),
  expires_at timestamptz not null,
  last_lat double precision,
  last_lng double precision,
  go_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.incident_members (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'bothered' check (role in ('bothered', 'confronter', 'partner')),
  last_lat double precision,
  last_lng double precision,
  heading double precision,
  speed double precision,
  joined_at timestamptz not null default now(),
  unique (incident_id, user_id)
);

create index incidents_open_idx on public.incidents (transit_line, direction, status, expires_at);
create index incident_members_incident_idx on public.incident_members (incident_id);
create index incident_members_user_joined_idx on public.incident_members (user_id, joined_at desc);

create unique index one_confronter_per_incident
  on public.incident_members (incident_id)
  where role = 'confronter';

create or replace function public.check_incident_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  confronter_count int;
  partner_count int;
begin
  select count(*) into confronter_count
  from public.incident_members
  where incident_id = new.incident_id and role = 'confronter';

  select count(*) into partner_count
  from public.incident_members
  where incident_id = new.incident_id and role = 'partner';

  if confronter_count = 1 and partner_count >= 1 then
    update public.incidents
    set status = 'ready'
    where id = new.incident_id and status = 'open';
  end if;

  return new;
end;
$$;

create trigger incident_members_ready_trigger
after insert or update of role on public.incident_members
for each row
execute function public.check_incident_ready();

alter table public.profiles enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_members enable row level security;

create policy "Users manage own profile"
  on public.profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users read profiles in shared incidents"
  on public.profiles
  for select
  using (
    exists (
      select 1
      from public.incident_members mine
      join public.incident_members theirs on mine.incident_id = theirs.incident_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

create policy "Members read their incidents"
  on public.incidents
  for select
  using (
    exists (
      select 1 from public.incident_members
      where incident_id = incidents.id and user_id = auth.uid()
    )
  );

create policy "Members update their incidents"
  on public.incidents
  for update
  using (
    exists (
      select 1 from public.incident_members
      where incident_id = incidents.id and user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.incident_members
      where incident_id = incidents.id and user_id = auth.uid()
    )
  );

create policy "Members read incident members"
  on public.incident_members
  for select
  using (
    exists (
      select 1 from public.incident_members mine
      where mine.incident_id = incident_members.incident_id and mine.user_id = auth.uid()
    )
  );

create policy "Users update own membership"
  on public.incident_members
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.incidents;
alter publication supabase_realtime add table public.incident_members;
