-- Authenticated sessions created by other enabled Supabase Auth endpoints
-- must not grant application data access or an old Fastify API token.
alter table public.profiles
  add column password_reset_requested_at timestamptz;

comment on column public.profiles.password_reset_requested_at is
  'Server-recorded time of the latest reset request; cleared after its password update is confirmed.';

create table app_private.password_reset_requests (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  password_hash_before_request text not null,
  requested_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at > requested_at)
);

alter table app_private.password_reset_requests enable row level security;
revoke all on app_private.password_reset_requests from public, anon, authenticated, service_role;
comment on table app_private.password_reset_requests is
  'Private one-time reset state. The saved Auth password hash is never exposed to clients.';

create function public.mark_password_reset_requested(p_auth_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  reset_time timestamptz := clock_timestamp();
  previous_password_hash text;
begin
  select auth_user.encrypted_password
  into previous_password_hash
  from auth.users as auth_user
  join public.profiles as profile on profile.auth_user_id = auth_user.id
  where auth_user.id = p_auth_user_id
    and profile.is_active
  for update of auth_user;

  if not found then
    return false;
  end if;

  insert into app_private.password_reset_requests (
    auth_user_id,
    password_hash_before_request,
    requested_at,
    expires_at
  ) values (
    p_auth_user_id,
    previous_password_hash,
    reset_time,
    reset_time + interval '24 hours'
  )
  on conflict (auth_user_id) do update
  set password_hash_before_request = excluded.password_hash_before_request,
      requested_at = excluded.requested_at,
      expires_at = excluded.expires_at;

  update public.profiles as profile
  set password_reset_requested_at = reset_time,
      updated_at = reset_time
  where profile.auth_user_id = p_auth_user_id
    and profile.is_active;

  return found;
end;
$$;

revoke all on function public.mark_password_reset_requested(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_password_reset_requested(uuid) to service_role;
comment on function public.mark_password_reset_requested(uuid) is
  'Server-only reset request marker used to require a subsequent Auth password update.';

create function app_private.is_password_authenticated()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt())->'amr', '[]'::jsonb)
    @> '[{"method":"password"}]'::jsonb;
$$;

create function app_private.is_password_recovery_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- GoTrue currently labels a verified recovery-link session as `otp`.
  select coalesce((select auth.jwt())->'amr', '[]'::jsonb)
    @> '[{"method":"recovery"}]'::jsonb
    or coalesce((select auth.jwt())->'amr', '[]'::jsonb)
    @> '[{"method":"otp"}]'::jsonb;
$$;

revoke all on function app_private.is_password_authenticated() from public, anon;
revoke all on function app_private.is_password_recovery_session() from public, anon;
grant execute on function app_private.is_password_authenticated() to authenticated;
grant execute on function app_private.is_password_recovery_session() to authenticated;

create or replace function app_private.is_current_profile(p_profile_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app_private.is_password_authenticated()) and exists (
    select 1
    from public.profiles as profile
    where profile.id = p_profile_id
      and profile.auth_user_id = (select auth.uid())
      and profile.is_active
  );
$$;

create or replace function app_private.can_read_role(p_role_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app_private.is_password_authenticated()) and exists (
    select 1
    from public.user_roles as user_role
    join public.profiles as profile on profile.id = user_role.user_id
    join public.roles as role on role.id = user_role.role_id
    where user_role.role_id = p_role_id
      and profile.auth_user_id = (select auth.uid())
      and profile.is_active
      and role.is_active
  );
$$;

create or replace function app_private.has_permission(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app_private.is_password_authenticated()) and exists (
    select 1
    from public.profiles as profile
    join public.user_roles as user_role on user_role.user_id = profile.id
    join public.roles as role on role.id = user_role.role_id
    where profile.auth_user_id = (select auth.uid())
      and profile.is_active
      and role.is_active
      and (
        role.code = 'SUPER_ADMIN'
        or exists (
          select 1
          from public.role_permissions as role_permission
          where role_permission.role_id = role.id
            and role_permission.permission_key = p_permission_key
        )
      )
  );
$$;

drop policy permission_catalog_read_authenticated on public.permission_catalog;
create policy permission_catalog_read_password_sessions
on public.permission_catalog for select to authenticated
using ((select app_private.is_password_authenticated()));
