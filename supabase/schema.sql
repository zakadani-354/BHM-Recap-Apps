create extension if not exists pgcrypto with schema extensions;

create table if not exists public.bhm_app_state (
  id text primary key check (id = 'shared'),
  members jsonb not null default '[]'::jsonb check (jsonb_typeof(members) = 'array'),
  attendance jsonb not null default '[]'::jsonb check (jsonb_typeof(attendance) = 'array'),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.bhm_terobosan_events (
  event_year integer primary key check (event_year between 1000 and 9999),
  event_date date not null,
  attendance jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attendance) = 'array'),
  check (extract(year from event_date)::integer = event_year)
);

create table if not exists public.bhm_app_accounts (
  username text primary key check (username in ('admin', 'pengurus')),
  role text not null check (role in ('admin', 'pengurus')),
  password_hash text not null
);

alter table public.bhm_app_state enable row level security;
alter table public.bhm_terobosan_events enable row level security;
alter table public.bhm_app_accounts enable row level security;

revoke all on public.bhm_app_state from public, anon, authenticated;
revoke all on public.bhm_terobosan_events from public, anon, authenticated;
revoke all on public.bhm_app_accounts from public, anon, authenticated;
grant all on public.bhm_app_state to service_role;
grant all on public.bhm_terobosan_events to service_role;
grant all on public.bhm_app_accounts to service_role;

do $$
begin
  if exists (
    select substring(entry->>'tanggal' from 1 for 4)
    from public.bhm_app_state as state
    cross join lateral jsonb_array_elements(state.attendance) as records(entry)
    where entry->>'jenisPengajian' = 'Terobosan Pusat'
      and entry->>'tanggal' ~ '^\d{4}-\d{2}-\d{2}$'
    group by substring(entry->>'tanggal' from 1 for 4)
    having count(distinct entry->>'tanggal') > 1
  ) then
    raise exception 'Existing Terobosan Pusat data contains multiple event dates in a year';
  end if;
end;
$$;

insert into public.bhm_terobosan_events (event_year, event_date, attendance)
select extract(year from (entry->>'tanggal')::date)::integer,
       (entry->>'tanggal')::date,
       jsonb_agg(entry order by entry->>'nama')
from public.bhm_app_state as state
cross join lateral jsonb_array_elements(state.attendance) as records(entry)
where entry->>'jenisPengajian' = 'Terobosan Pusat'
  and entry->>'tanggal' ~ '^\d{4}-\d{2}-\d{2}$'
group by extract(year from (entry->>'tanggal')::date)::integer,
         (entry->>'tanggal')::date
on conflict (event_year) do nothing;

update public.bhm_app_state as state
set attendance = coalesce((
  select jsonb_agg(entry)
  from jsonb_array_elements(state.attendance) as records(entry)
  where coalesce(entry->>'jenisPengajian', 'Pengajian Rutin') <> 'Terobosan Pusat'
), '[]'::jsonb)
where exists (
  select 1
  from jsonb_array_elements(state.attendance) as records(entry)
  where entry->>'jenisPengajian' = 'Terobosan Pusat'
);

insert into public.bhm_app_accounts (username, role, password_hash)
values
  ('admin', 'admin', extensions.crypt('admin123', extensions.gen_salt('bf', 12))),
  ('pengurus', 'pengurus', extensions.crypt('pengurus123', extensions.gen_salt('bf', 12)))
on conflict (username) do nothing;

create or replace function public.bhm_authenticate_app_user(
  p_username text,
  p_password text
)
returns text
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select account.role
  from public.bhm_app_accounts as account
  where account.username = lower(trim(p_username))
    and account.password_hash = extensions.crypt(p_password, account.password_hash)
  limit 1;
$$;

create or replace function public.bhm_change_app_password(
  p_username text,
  p_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  updated_rows integer;
begin
  if lower(trim(p_username)) not in ('admin', 'pengurus')
      or char_length(p_password) < 4 then
    return false;
  end if;

  update public.bhm_app_accounts
  set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 12))
  where username = lower(trim(p_username));

  get diagnostics updated_rows = row_count;
  return updated_rows = 1;
end;
$$;

create or replace function public.bhm_save_app_collection(
  p_collection text,
  p_data jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_revision bigint;
begin
  if p_collection is null
      or p_collection not in ('members', 'attendance')
      or p_data is null
      or jsonb_typeof(p_data) is distinct from 'array' then
    raise exception 'Invalid shared data collection';
  end if;

  if p_collection = 'attendance' and exists (
    select 1
    from jsonb_array_elements(p_data) as entries(entry)
    where entry->>'jenisPengajian' = 'Terobosan Pusat'
      and (
        entry->>'tanggal' is null
        or entry->>'tanggal' !~ '^\d{4}-\d{2}-\d{2}$'
        or (entry->>'tanggal')::date::text <> entry->>'tanggal'
      )
  ) then
    raise exception 'Terobosan Pusat attendance requires an ISO date';
  end if;

  if p_collection = 'attendance' and exists (
    select substring(entry->>'tanggal' from 1 for 4)
    from jsonb_array_elements(p_data) as entries(entry)
    where entry->>'jenisPengajian' = 'Terobosan Pusat'
    group by substring(entry->>'tanggal' from 1 for 4)
    having count(distinct entry->>'tanggal') > 1
  ) then
    raise exception 'Terobosan Pusat is limited to one event date per year';
  end if;

  insert into public.bhm_app_state (id)
  values ('shared')
  on conflict (id) do nothing;

  perform 1
  from public.bhm_app_state
  where id = 'shared'
  for update;

  if p_collection = 'members' then
    update public.bhm_app_state
    set members = p_data,
        revision = revision + 1,
        updated_at = now()
    where id = 'shared'
    returning revision into saved_revision;
  else
    delete from public.bhm_terobosan_events;

    insert into public.bhm_terobosan_events (event_year, event_date, attendance)
    select extract(year from (entry->>'tanggal')::date)::integer,
           (entry->>'tanggal')::date,
           jsonb_agg(entry order by entry->>'nama')
    from jsonb_array_elements(p_data) as records(entry)
    where entry->>'jenisPengajian' = 'Terobosan Pusat'
    group by extract(year from (entry->>'tanggal')::date)::integer,
             (entry->>'tanggal')::date;

    update public.bhm_app_state
    set attendance = coalesce((
          select jsonb_agg(entry)
          from jsonb_array_elements(p_data) as records(entry)
          where coalesce(entry->>'jenisPengajian', 'Pengajian Rutin') <> 'Terobosan Pusat'
        ), '[]'::jsonb),
        revision = revision + 1,
        updated_at = now()
    where id = 'shared'
    returning revision into saved_revision;
  end if;

  return saved_revision;
end;
$$;

create or replace function public.bhm_append_app_attendance(
  p_data jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_revision bigint;
  current_attendance jsonb;
  current_members jsonb;
  combined_attendance jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) is distinct from 'array' then
    raise exception 'Attendance additions must be a non-empty array';
  end if;
  if jsonb_array_length(p_data) = 0 then
    raise exception 'Attendance additions must be a non-empty array';
  end if;

  insert into public.bhm_app_state (id)
  values ('shared')
  on conflict (id) do nothing;

  select attendance, members
  into current_attendance, current_members
  from public.bhm_app_state
  where id = 'shared'
  for update;

  if exists (
    select 1
    from jsonb_array_elements(p_data) as entries(entry)
    where jsonb_typeof(entry) is distinct from 'object'
      or entry->>'memberId' is null
      or entry->>'nama' is null
      or entry->>'kelompok' is null
      or entry->>'tanggal' is null
      or entry->>'tanggal' !~ '^\d{4}-\d{2}-\d{2}$'
      or (entry->>'tanggal')::date::text <> entry->>'tanggal'
      or entry->>'status' is null
      or entry->>'status' not in ('Hadir', 'Izin', 'Sakit', 'Alpa')
      or coalesce(entry->>'jenisPengajian', 'Pengajian Rutin')
        not in ('Pengajian Rutin', 'Terobosan Pusat')
      or entry->>'metode' is null
      or entry->>'metode' not in ('Satuan', 'Barcode')
      or not exists (
        select 1
        from jsonb_array_elements(current_members) as roster(member)
        where member->>'id' = entry->>'memberId'
          and member->>'nama' = entry->>'nama'
          and member->>'kelompok' = entry->>'kelompok'
      )
  ) then
    raise exception 'Attendance addition contains an invalid member or record';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(current_attendance) as current_records(existing)
    join jsonb_array_elements(p_data) as new_records(incoming)
      on existing->>'tanggal' = incoming->>'tanggal'
      and coalesce(existing->>'jenisPengajian', 'Pengajian Rutin')
        = coalesce(incoming->>'jenisPengajian', 'Pengajian Rutin')
      and (
        existing->>'memberId' = incoming->>'memberId'
        or (
          existing->>'nama' = incoming->>'nama'
          and existing->>'kelompok' = incoming->>'kelompok'
        )
      )
  ) then
    raise exception 'Attendance record already exists';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_data) with ordinality as first_record(value, idx)
    join jsonb_array_elements(p_data) with ordinality as second_record(value, idx)
      on first_record.idx < second_record.idx
      and first_record.value->>'tanggal' = second_record.value->>'tanggal'
      and coalesce(first_record.value->>'jenisPengajian', 'Pengajian Rutin')
        = coalesce(second_record.value->>'jenisPengajian', 'Pengajian Rutin')
      and (
        first_record.value->>'memberId' = second_record.value->>'memberId'
        or (
          first_record.value->>'nama' = second_record.value->>'nama'
          and first_record.value->>'kelompok' = second_record.value->>'kelompok'
        )
      )
  ) then
    raise exception 'Attendance additions contain duplicate records';
  end if;

  combined_attendance := current_attendance || p_data;
  if exists (
    select substring(entry->>'tanggal' from 1 for 4)
    from jsonb_array_elements(combined_attendance) as entries(entry)
    where entry->>'jenisPengajian' = 'Terobosan Pusat'
    group by substring(entry->>'tanggal' from 1 for 4)
    having count(distinct entry->>'tanggal') > 1
  ) then
    raise exception 'Terobosan Pusat is limited to one event date per year';
  end if;

  update public.bhm_app_state
  set attendance = combined_attendance,
      revision = revision + 1,
      updated_at = now()
  where id = 'shared'
  returning revision into saved_revision;

  return saved_revision;
end;
$$;

create or replace function public.bhm_append_terobosan_attendance(
  p_data jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_revision bigint;
  current_members jsonb;
  current_event_date date;
  current_attendance jsonb;
  target_year integer;
  target_date date;
begin
  if p_data is null or jsonb_typeof(p_data) is distinct from 'array' then
    raise exception 'Attendance additions must be a non-empty array';
  end if;
  if jsonb_array_length(p_data) = 0 then
    raise exception 'Attendance additions must be a non-empty array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_data) as records(entry)
    where jsonb_typeof(entry) is distinct from 'object'
      or entry->>'jenisPengajian' is distinct from 'Terobosan Pusat'
      or entry->>'tanggal' is null
      or entry->>'tanggal' !~ '^\d{4}-\d{2}-\d{2}$'
      or entry->>'nama' is null
      or btrim(entry->>'nama') = ''
      or entry->>'kelompok' is null
      or entry->>'kelompok' not in (
        'Baitu Taqwa', 'Almansurin', 'Al Huda', 'Al Malik', 'Miftahul Jannah', 'Baitul Makmur'
      )
      or entry->>'jenisKelamin' is null
      or entry->>'jenisKelamin' not in ('Pria', 'Wanita')
      or entry->>'status' is null
      or entry->>'status' not in ('Hadir', 'Izin', 'Sakit', 'Alpa')
      or entry->>'metode' is distinct from 'Satuan'
  ) then
    raise exception 'Terobosan Pusat attendance contains an invalid record';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_data) as records(entry)
    where (entry->>'tanggal')::date::text <> entry->>'tanggal'
  ) then
    raise exception 'Terobosan Pusat attendance requires a valid ISO date';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_data) as first_record(entry)
    cross join jsonb_array_elements(p_data) as second_record(entry)
    where first_record.entry->>'tanggal' <> second_record.entry->>'tanggal'
  ) then
    raise exception 'A single submission must use one Terobosan Pusat event date';
  end if;

  target_date := (p_data->0->>'tanggal')::date;
  target_year := extract(year from target_date)::integer;

  insert into public.bhm_app_state (id)
  values ('shared')
  on conflict (id) do nothing;

  select members into current_members
  from public.bhm_app_state
  where id = 'shared'
  for update;

  if exists (
    select 1
    from jsonb_array_elements(p_data) as records(entry)
    where entry->>'memberId' is not null
      and not exists (
        select 1
        from jsonb_array_elements(current_members) as roster(member)
        where member->>'id' = entry->>'memberId'
          and member->>'nama' = entry->>'nama'
          and member->>'kelompok' = entry->>'kelompok'
          and member->>'jenisKelamin' = entry->>'jenisKelamin'
      )
  ) then
    raise exception 'Attendance member details do not match the shared roster';
  end if;

  select attendance, event_date
  into current_attendance, current_event_date
  from public.bhm_terobosan_events
  where bhm_terobosan_events.event_year = append_terobosan_attendance.target_year
  for update;

  if not found then
    insert into public.bhm_terobosan_events (event_year, event_date)
    values (target_year, target_date);
    current_attendance := '[]'::jsonb;
  elsif current_event_date <> target_date then
    raise exception 'Terobosan Pusat is limited to one event date per year';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(current_attendance) as current_records(existing)
    join jsonb_array_elements(p_data) as new_records(incoming)
      on (
        (existing->>'memberId' is not null
          and existing->>'memberId' = incoming->>'memberId')
        or (
          lower(btrim(existing->>'nama')) = lower(btrim(incoming->>'nama'))
          and existing->>'kelompok' = incoming->>'kelompok'
        )
      )
  ) or exists (
    select 1
    from jsonb_array_elements(p_data) with ordinality as first_record(value, idx)
    join jsonb_array_elements(p_data) with ordinality as second_record(value, idx)
      on first_record.idx < second_record.idx
      and (
        (first_record.value->>'memberId' is not null
          and first_record.value->>'memberId' = second_record.value->>'memberId')
        or (
          lower(btrim(first_record.value->>'nama')) = lower(btrim(second_record.value->>'nama'))
          and first_record.value->>'kelompok' = second_record.value->>'kelompok'
        )
      )
  ) then
    raise exception 'Terobosan Pusat attendance record already exists';
  end if;

  update public.bhm_terobosan_events
  set attendance = current_attendance || p_data
  where bhm_terobosan_events.event_year = append_terobosan_attendance.target_year;

  update public.bhm_app_state
  set revision = revision + 1,
      updated_at = now()
  where id = 'shared'
  returning revision into saved_revision;

  return saved_revision;
end;
$$;

revoke all on function public.bhm_authenticate_app_user(text, text) from public, anon, authenticated;
revoke all on function public.bhm_change_app_password(text, text) from public, anon, authenticated;
revoke all on function public.bhm_save_app_collection(text, jsonb) from public, anon, authenticated;
revoke all on function public.bhm_append_app_attendance(jsonb) from public, anon, authenticated;
revoke all on function public.bhm_append_terobosan_attendance(jsonb) from public, anon, authenticated;
grant execute on function public.bhm_authenticate_app_user(text, text) to service_role;
grant execute on function public.bhm_change_app_password(text, text) to service_role;
grant execute on function public.bhm_save_app_collection(text, jsonb) to service_role;
grant execute on function public.bhm_append_app_attendance(jsonb) to service_role;
grant execute on function public.bhm_append_terobosan_attendance(jsonb) to service_role;

notify pgrst, 'reload schema';

select
  to_regclass('public.bhm_app_state') is not null as state_table_ready,
  to_regclass('public.bhm_app_accounts') is not null as accounts_table_ready,
  to_regprocedure('public.bhm_authenticate_app_user(text,text)') is not null as login_function_ready,
  to_regprocedure('public.bhm_change_app_password(text,text)') is not null as password_function_ready,
  to_regprocedure('public.bhm_save_app_collection(text,jsonb)') is not null as save_function_ready,
  to_regprocedure('public.bhm_append_app_attendance(jsonb)') is not null as attendance_append_function_ready,
  to_regclass('public.bhm_terobosan_events') is not null as terobosan_table_ready,
  to_regprocedure('public.bhm_append_terobosan_attendance(jsonb)') is not null as terobosan_append_function_ready;
