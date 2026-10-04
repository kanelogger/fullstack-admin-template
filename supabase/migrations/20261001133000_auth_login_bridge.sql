-- Server-only lookup for login_name -> verified Auth email. It is called by
-- Edge Functions with the service_role key and cannot be enumerated by browser roles.
create function app_private.session_context(p_profile_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'authUserId', profile.auth_user_id,
    'id', profile.id::text,
    'loginName', profile.login_name,
    'displayName', profile.display_name,
    'email', profile.email,
    'phone', profile.phone,
    'avatarUrl', profile.avatar_url,
    'isActive', profile.is_active,
    'mustResetPassword', profile.must_reset_password,
    'roleCodes', coalesce(
      (
        select jsonb_agg(role.code order by role.code)
        from public.user_roles as user_role
        join public.roles as role on role.id = user_role.role_id
        where user_role.user_id = profile.id
          and role.is_active
      ),
      '[]'::jsonb
    ),
    'permissionKeys',
      case
        when exists (
          select 1
          from public.user_roles as user_role
          join public.roles as role on role.id = user_role.role_id
          where user_role.user_id = profile.id
            and role.code = 'SUPER_ADMIN'
            and role.is_active
        ) then coalesce(
          (
            select jsonb_agg(permission.permission_key order by permission.permission_key)
            from public.permission_catalog as permission
          ),
          '[]'::jsonb
        )
        else coalesce(
          (
            select jsonb_agg(distinct role_permission.permission_key order by role_permission.permission_key)
            from public.user_roles as user_role
            join public.roles as role on role.id = user_role.role_id
            join public.role_permissions as role_permission on role_permission.role_id = role.id
            where user_role.user_id = profile.id
              and role.is_active
          ),
          '[]'::jsonb
        )
      end
  )
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.is_active;
$$;

revoke all on function app_private.session_context(bigint)
  from public, anon, authenticated, service_role;

create function public.resolve_login_identity(p_login_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resolved_identity jsonb;
begin
  select app_private.session_context(profile.id)
  into resolved_identity
  from public.profiles as profile
  join auth.users as auth_user on auth_user.id = profile.auth_user_id
  where lower(profile.login_name) = lower(trim(p_login_name))
    and profile.is_active
    and auth_user.email_confirmed_at is not null
    and lower(auth_user.email) = lower(profile.email)
  limit 1;

  return resolved_identity;
end;
$$;

revoke all on function public.resolve_login_identity(text) from public, anon, authenticated;
grant execute on function public.resolve_login_identity(text) to service_role;
comment on function public.resolve_login_identity(text) is
  'Server-only mapping for Supabase Edge Auth flows; returns only verified, active profiles.';

-- Browser profile services call this function; it returns only the caller's
-- own profile and emits the BIGINT business ID as decimal text.
create function public.current_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.session_context(profile.id)
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.is_active
    and (select app_private.is_password_authenticated())
  limit 1;
$$;

revoke all on function public.current_profile() from public, anon;
grant execute on function public.current_profile() to authenticated;

-- Fastify exchanges a verified Supabase bearer token for its temporary legacy
-- JWT through this caller-scoped function. It can only return the caller's ID.
create function public.current_business_user_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id::text
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.is_active
    and (select app_private.is_password_authenticated())
  limit 1;
$$;

revoke all on function public.current_business_user_id() from public, anon;
grant execute on function public.current_business_user_id() to authenticated;

-- Called after the user completes the emailed recovery flow. The caller can
-- update only their own reset marker; the password itself remains in Auth.
create function public.complete_password_reset()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  reset_completed boolean;
begin
  update public.profiles as profile
  set must_reset_password = false,
      password_reset_requested_at = null,
      updated_at = now()
  where profile.auth_user_id = (select auth.uid())
    and profile.is_active
    and profile.password_reset_requested_at is not null
    and (select app_private.is_password_recovery_session())
    and exists (
      select 1
      from app_private.password_reset_requests as reset_request
      join auth.users as auth_user on auth_user.id = reset_request.auth_user_id
      where reset_request.auth_user_id = profile.auth_user_id
        and reset_request.requested_at = profile.password_reset_requested_at
        and reset_request.expires_at > now()
        and auth_user.encrypted_password is distinct from
          reset_request.password_hash_before_request
    );

  reset_completed := found;
  if reset_completed then
    delete from app_private.password_reset_requests
    where auth_user_id = (select auth.uid());
  end if;

  return reset_completed;
end;
$$;

revoke all on function public.complete_password_reset() from public, anon;
grant execute on function public.complete_password_reset() to authenticated;
