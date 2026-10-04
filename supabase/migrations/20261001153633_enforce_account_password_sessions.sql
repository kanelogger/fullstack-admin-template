-- Supabase Auth exposes several credential endpoints directly. Only sessions
-- approved by the server-side login_name + password flow may reach app data.
create table app_private.account_password_sessions (
  session_id uuid primary key,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  authorized_at timestamptz not null default clock_timestamp()
);

alter table app_private.account_password_sessions enable row level security;
revoke all on app_private.account_password_sessions
  from public, anon, authenticated, service_role;

comment on table app_private.account_password_sessions is
  'Server-only allowlist of Auth sessions created through login_name + password.';

create function public.register_account_password_session(
  p_session_id uuid,
  p_auth_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_session_id is null or p_auth_user_id is null or not exists (
    select 1
    from public.profiles as profile
    where profile.auth_user_id = p_auth_user_id
      and profile.is_active
      and not profile.must_reset_password
  ) then
    return false;
  end if;

  insert into app_private.account_password_sessions (session_id, auth_user_id)
  values (p_session_id, p_auth_user_id)
  on conflict (session_id) do nothing;

  return exists (
    select 1
    from app_private.account_password_sessions as allowed_session
    where allowed_session.session_id = p_session_id
      and allowed_session.auth_user_id = p_auth_user_id
  );
end;
$$;

revoke all on function public.register_account_password_session(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.register_account_password_session(uuid, uuid)
  to service_role;

create function public.revoke_account_password_session()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_session_id text := (select auth.jwt())->>'session_id';
begin
  if token_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  delete from app_private.account_password_sessions as allowed_session
  where allowed_session.session_id = token_session_id::uuid
    and allowed_session.auth_user_id = (select auth.uid());

  return found;
end;
$$;

revoke all on function public.revoke_account_password_session() from public, anon;
grant execute on function public.revoke_account_password_session() to authenticated;

create or replace function app_private.is_password_authenticated()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt())->'amr', '[]'::jsonb)
      @> '[{"method":"password"}]'::jsonb
    and exists (
      select 1
      from app_private.account_password_sessions as allowed_session
      where allowed_session.auth_user_id = (select auth.uid())
        and allowed_session.session_id = case
          when ((select auth.jwt())->>'session_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((select auth.jwt())->>'session_id')::uuid
          else null
        end
    );
$$;

revoke all on function app_private.is_password_authenticated() from public, anon;
grant execute on function app_private.is_password_authenticated() to authenticated;
