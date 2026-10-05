create or replace function public.bootstrap_first_admin_profile(
  p_auth_user_id uuid,
  p_login_name text,
  p_display_name text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_profile public.profiles;
  new_profile_id bigint;
  super_admin_role_id bigint;
begin
  if p_auth_user_id is null
    or nullif(trim(p_login_name), '') is null
    or length(trim(p_login_name)) > 64
    or nullif(trim(p_display_name), '') is null
    or length(trim(p_display_name)) > 128
    or nullif(trim(p_email), '') is null
    or length(trim(p_email)) > 320 then
    raise exception using errcode = '22023', message = 'Initial administrator fields are invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('fullstack-admin-template:first-super-admin', 0)
  );

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_auth_user_id
      and auth_user.email_confirmed_at is not null
      and lower(auth_user.email) = lower(trim(p_email))
  ) then
    raise exception using errcode = '23514', message = 'Confirmed Auth identity is required';
  end if;

  select profile.*
  into existing_profile
  from public.profiles as profile
  where profile.auth_user_id = p_auth_user_id
  for update;

  if found then
    if existing_profile.is_active
      and existing_profile.deleted_at is null
      and lower(existing_profile.login_name) = lower(trim(p_login_name))
      and existing_profile.display_name = trim(p_display_name)
      and lower(existing_profile.email) = lower(trim(p_email))
      and exists (
        select 1
        from public.user_roles as user_role
        join public.roles as role on role.id = user_role.role_id
        where user_role.user_id = existing_profile.id
          and role.code = 'SUPER_ADMIN'
      ) then
      return jsonb_build_object(
        'id', existing_profile.id::text,
        'mustResetPassword', existing_profile.must_reset_password,
        'initialized', true
      );
    end if;
    raise exception using errcode = '23505', message = 'Auth identity already has a different profile';
  end if;

  if exists (
    select 1
    from public.user_roles as user_role
    join public.roles as role on role.id = user_role.role_id
    where role.code = 'SUPER_ADMIN'
  ) then
    raise exception using errcode = '23505', message = 'An initial administrator already exists';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where lower(profile.login_name) = lower(trim(p_login_name))
       or lower(profile.email) = lower(trim(p_email))
       or lower(profile.user_code) = lower(trim(p_login_name))
  ) then
    raise exception using errcode = '23505', message = 'Administrator login or email is already in use';
  end if;

  select role.id
  into super_admin_role_id
  from public.roles as role
  where role.code = 'SUPER_ADMIN'
    and role.is_active;
  if super_admin_role_id is null then
    raise exception using errcode = '23514', message = 'SUPER_ADMIN role is missing or inactive';
  end if;

  insert into public.profiles (
    auth_user_id,
    user_code,
    login_name,
    display_name,
    email,
    is_active,
    must_reset_password
  ) values (
    p_auth_user_id,
    trim(p_login_name),
    trim(p_login_name),
    trim(p_display_name),
    lower(trim(p_email)),
    true,
    false
  )
  returning id into new_profile_id;

  insert into public.user_roles (user_id, role_id)
  values (new_profile_id, super_admin_role_id);

  return jsonb_build_object(
    'id', new_profile_id::text,
    'mustResetPassword', false,
    'initialized', true
  );
end;
$$;

revoke all on function public.bootstrap_first_admin_profile(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin_profile(uuid, text, text, text)
  to service_role;
comment on function public.bootstrap_first_admin_profile(uuid, text, text, text) is
  'One-time transactional first-administrator bootstrap; callable only with the service role.';
