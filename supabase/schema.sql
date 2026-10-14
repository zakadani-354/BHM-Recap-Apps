create extension if not exists pgcrypto with schema extensions;

create table if not exists public.bhm_app_state (
  id text primary key check (id = 'shared'),
  members jsonb not null default '[]'::jsonb check (jsonb_typeof(members) = 'array'),
  attendance jsonb not null default '[]'::jsonb check (jsonb_typeof(attendance) = 'array'),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.bhm_app_accounts (
  username text primary key check (username in ('admin', 'pengurus')),
  role text not null check (role in ('admin', 'pengurus')),
  password_hash text not null
);

alter table public.bhm_app_state enable row level security;
alter table public.bhm_app_accounts enable row level security;

revoke all on public.bhm_app_state from public, anon, authenticated;
revoke all on public.bhm_app_accounts from public, anon, authenticated;
grant all on public.bhm_app_state to service_role;
grant all on public.bhm_app_accounts to service_role;

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

  insert into public.bhm_app_state (id)
  values ('shared')
  on conflict (id) do nothing;

  if p_collection = 'members' then
    update public.bhm_app_state
    set members = p_data,
        revision = revision + 1,
        updated_at = now()
    where id = 'shared'
    returning revision into saved_revision;
  else
    update public.bhm_app_state
    set attendance = p_data,
        revision = revision + 1,
        updated_at = now()
    where id = 'shared'
    returning revision into saved_revision;
  end if;

  return saved_revision;
end;
$$;

revoke all on function public.bhm_authenticate_app_user(text, text) from public, anon, authenticated;
revoke all on function public.bhm_change_app_password(text, text) from public, anon, authenticated;
revoke all on function public.bhm_save_app_collection(text, jsonb) from public, anon, authenticated;
grant execute on function public.bhm_authenticate_app_user(text, text) to service_role;
grant execute on function public.bhm_change_app_password(text, text) to service_role;
grant execute on function public.bhm_save_app_collection(text, jsonb) to service_role;

notify pgrst, 'reload schema';

select
  to_regclass('public.bhm_app_state') is not null as state_table_ready,
  to_regclass('public.bhm_app_accounts') is not null as accounts_table_ready,
  to_regprocedure('public.bhm_authenticate_app_user(text,text)') is not null as login_function_ready,
  to_regprocedure('public.bhm_change_app_password(text,text)') is not null as password_function_ready,
  to_regprocedure('public.bhm_save_app_collection(text,jsonb)') is not null as save_function_ready;
