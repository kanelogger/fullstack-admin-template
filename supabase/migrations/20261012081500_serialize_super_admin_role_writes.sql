-- The Edge Function's read of current membership and the later service-role
-- role replacement are not one lock. A super administrator can revoke
-- SUPER_ADMIN after that read, and the stale replacement would write it back
-- because the membership trigger trusts service_role. Check and replace the
-- role set in this transaction, after locking the actor, target, and
-- SUPER_ADMIN role.

create function app_private.assert_super_admin_membership_change(
  p_actor_profile_id bigint,
  p_target_profile_id bigint,
  p_role_ids bigint[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  super_admin_role_id bigint;
  actor_is_super_admin boolean;
  target_has_super_admin boolean;
  requested_has_super_admin boolean;
begin
  if p_actor_profile_id is null then
    raise exception using errcode = '22023', message = 'Actor profile is required';
  end if;

  select role.id
  into super_admin_role_id
  from public.roles as role
  where role.code = 'SUPER_ADMIN'
  for update;
  if super_admin_role_id is null then
    raise exception using errcode = '23514', message = 'SUPER_ADMIN role is missing';
  end if;

  perform 1
  from public.profiles as profile
  where profile.id in (p_actor_profile_id, p_target_profile_id)
  order by profile.id
  for update;

  perform 1
  from public.user_roles as membership
  where membership.user_id in (p_actor_profile_id, p_target_profile_id)
  order by membership.user_id, membership.role_id
  for update;

  select exists (
    select 1
    from public.profiles as profile
    join public.user_roles as membership on membership.user_id = profile.id
    join public.roles as role on role.id = membership.role_id
    where profile.id = p_actor_profile_id
      and profile.is_active
      and profile.deleted_at is null
      and role.id = super_admin_role_id
      and role.is_active
  )
  into actor_is_super_admin;

  if actor_is_super_admin then
    return;
  end if;

  requested_has_super_admin := p_role_ids is not null
    and super_admin_role_id = any (p_role_ids);
  target_has_super_admin := p_target_profile_id is not null and exists (
    select 1
    from public.user_roles as membership
    where membership.user_id = p_target_profile_id
      and membership.role_id = super_admin_role_id
  );

  if requested_has_super_admin is distinct from target_has_super_admin then
    raise exception using
      errcode = '42501',
      message = 'Only a super administrator can change super administrator membership';
  end if;
end;
$$;

revoke all on function app_private.assert_super_admin_membership_change(bigint, bigint, bigint[])
  from public, anon, authenticated, service_role;

drop function public.create_managed_user_profile(
  uuid, text, text, text, text, text, bigint, bigint, bigint[]
);
drop function public.update_managed_user_profile(
  bigint, text, text, text, text, bigint, bigint, bigint[]
);

create function public.create_managed_user_profile(
  p_auth_user_id uuid,
  p_user_code text,
  p_login_name text,
  p_display_name text,
  p_email text,
  p_phone text,
  p_department_id bigint,
  p_post_id bigint,
  p_role_ids bigint[],
  p_actor_profile_id bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_profile_id bigint;
begin
  if p_auth_user_id is null
    or nullif(trim(p_user_code), '') is null
    or nullif(trim(p_login_name), '') is null
    or nullif(trim(p_display_name), '') is null
    or nullif(trim(p_email), '') is null
    or coalesce(cardinality(p_role_ids), 0) = 0 then
    raise exception using errcode = '22023', message = 'Invalid managed user fields';
  end if;

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_auth_user_id
      and auth_user.email_confirmed_at is not null
      and lower(auth_user.email) = lower(trim(p_email))
  ) then
    raise exception using errcode = '23514', message = 'Auth email must be confirmed';
  end if;

  if exists (
    select 1
    from unnest(p_role_ids) as requested(role_id)
    left join public.roles as role on role.id = requested.role_id
    where role.id is null or not role.is_active
  ) then
    raise exception using errcode = '23514', message = 'All assigned roles must be active';
  end if;

  perform app_private.assert_super_admin_membership_change(
    p_actor_profile_id,
    null,
    p_role_ids
  );

  insert into public.profiles (
    auth_user_id,
    user_code,
    login_name,
    display_name,
    email,
    phone,
    department_id,
    post_id,
    is_active,
    must_reset_password
  ) values (
    p_auth_user_id,
    trim(p_user_code),
    trim(p_login_name),
    trim(p_display_name),
    lower(trim(p_email)),
    nullif(trim(coalesce(p_phone, '')), ''),
    p_department_id,
    p_post_id,
    true,
    true
  ) returning id into new_profile_id;

  insert into public.user_roles (user_id, role_id)
  select new_profile_id, requested.role_id
  from unnest(p_role_ids) as requested(role_id)
  on conflict (user_id, role_id) do nothing;

  return new_profile_id::text;
end;
$$;

create function public.update_managed_user_profile(
  p_profile_id bigint,
  p_user_code text,
  p_login_name text,
  p_display_name text,
  p_phone text,
  p_department_id bigint,
  p_post_id bigint,
  p_role_ids bigint[],
  p_actor_profile_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_profile_id is null
    or nullif(trim(p_user_code), '') is null
    or nullif(trim(p_login_name), '') is null
    or nullif(trim(p_display_name), '') is null then
    raise exception using errcode = '22023', message = 'Invalid managed user fields';
  end if;

  if p_role_ids is not null and cardinality(p_role_ids) = 0 then
    raise exception using errcode = '22023', message = 'At least one role must be assigned';
  end if;

  if p_role_ids is not null and exists (
    select 1
    from unnest(p_role_ids) as requested(role_id)
    left join public.roles as role on role.id = requested.role_id
    where role.id is null or not role.is_active
  ) then
    raise exception using errcode = '23514', message = 'All assigned roles must be active';
  end if;

  if p_role_ids is not null then
    perform app_private.assert_super_admin_membership_change(
      p_actor_profile_id,
      p_profile_id,
      p_role_ids
    );
  end if;

  update public.profiles as profile
  set user_code = trim(p_user_code),
      login_name = trim(p_login_name),
      display_name = trim(p_display_name),
      phone = nullif(trim(coalesce(p_phone, '')), ''),
      department_id = p_department_id,
      post_id = p_post_id,
      updated_at = now()
  where profile.id = p_profile_id
    and profile.deleted_at is null;

  if not found then
    return false;
  end if;

  if p_role_ids is not null then
    delete from public.user_roles as user_role
    where user_role.user_id = p_profile_id;

    insert into public.user_roles (user_id, role_id)
    select p_profile_id, requested.role_id
    from unnest(p_role_ids) as requested(role_id)
    on conflict (user_id, role_id) do nothing;
  end if;

  return true;
end;
$$;

revoke all on function public.create_managed_user_profile(
  uuid, text, text, text, text, text, bigint, bigint, bigint[], bigint
) from public, anon, authenticated;
revoke all on function public.update_managed_user_profile(
  bigint, text, text, text, text, bigint, bigint, bigint[], bigint
) from public, anon, authenticated;

grant execute on function public.create_managed_user_profile(
  uuid, text, text, text, text, text, bigint, bigint, bigint[], bigint
) to service_role;
grant execute on function public.update_managed_user_profile(
  bigint, text, text, text, text, bigint, bigint, bigint[], bigint
) to service_role;
