-- User administration stays in Postgres while Auth account changes are
-- orchestrated by the server-only Edge Function.
alter table public.profiles
  add column user_code text,
  add column department_id bigint,
  add column post_id bigint,
  add column deleted_at timestamptz;

create unique index profiles_user_code_lower_uidx
  on public.profiles (lower(user_code))
  where user_code is not null;
create index profiles_department_id_idx on public.profiles (department_id);
create index profiles_post_id_idx on public.profiles (post_id);
create index profiles_active_deleted_idx on public.profiles (is_active, deleted_at);

comment on column public.profiles.user_code is
  'Legacy business user code; nullable until legacy accounts are imported.';
comment on column public.profiles.department_id is
  'Legacy department ID retained until the organization slice is migrated.';
comment on column public.profiles.post_id is
  'Legacy post ID retained until the organization slice is migrated.';
comment on column public.profiles.deleted_at is
  'Soft deletion timestamp for user administration; deleted identities cannot sign in.';

insert into public.permission_catalog (permission_key, description)
values ('administration.users.reset_password', '为用户发送密码重置邮件')
on conflict (permission_key) do update
set description = excluded.description;

create view public.user_management_read_model
with (security_invoker = true)
as
select
  profile.id::text as id,
  profile.auth_user_id,
  profile.user_code,
  profile.login_name,
  profile.display_name,
  profile.email,
  profile.phone,
  profile.department_id::text as department_id,
  profile.post_id::text as post_id,
  profile.is_active,
  profile.deleted_at,
  profile.created_at,
  profile.updated_at,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', role.id::text,
        'code', role.code,
        'name', role.name,
        'isActive', role.is_active
      ) order by role.name, role.code
    ) filter (where role.id is not null),
    '[]'::jsonb
  ) as roles
from public.profiles as profile
left join public.user_roles as user_role on user_role.user_id = profile.id
left join public.roles as role on role.id = user_role.role_id
group by profile.id;

revoke all on public.user_management_read_model from public, anon, authenticated;
grant select on public.user_management_read_model to service_role;

create view public.user_management_role_options
with (security_invoker = true)
as
select id::text as id, code, name
from public.roles
where is_active;

revoke all on public.user_management_role_options from public, anon, authenticated;
grant select on public.user_management_role_options to service_role;

create function public.create_managed_user_profile(
  p_auth_user_id uuid,
  p_user_code text,
  p_login_name text,
  p_display_name text,
  p_email text,
  p_phone text,
  p_department_id bigint,
  p_post_id bigint,
  p_role_ids bigint[]
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
  p_role_ids bigint[]
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

create function public.set_managed_user_active(
  p_profile_id bigint,
  p_is_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_auth_user_id uuid;
begin
  update public.profiles as profile
  set is_active = p_is_active,
      updated_at = now()
  where profile.id = p_profile_id
    and profile.deleted_at is null
  returning profile.auth_user_id into target_auth_user_id;

  if not found then
    return false;
  end if;

  if not p_is_active and target_auth_user_id is not null then
    delete from app_private.account_password_sessions as allowed_session
    where allowed_session.auth_user_id = target_auth_user_id;
  end if;

  return true;
end;
$$;

create function public.soft_delete_managed_user(p_profile_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_auth_user_id uuid;
begin
  update public.profiles as profile
  set is_active = false,
      deleted_at = now(),
      updated_at = now()
  where profile.id = p_profile_id
    and profile.deleted_at is null
  returning profile.auth_user_id into target_auth_user_id;

  if not found then
    return false;
  end if;

  if target_auth_user_id is not null then
    delete from app_private.account_password_sessions as allowed_session
    where allowed_session.auth_user_id = target_auth_user_id;
  end if;

  return true;
end;
$$;

create function public.rollback_managed_user_create(p_auth_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.profiles as profile
  where profile.auth_user_id = p_auth_user_id;
  return found;
end;
$$;

revoke all on function public.create_managed_user_profile(
  uuid, text, text, text, text, text, bigint, bigint, bigint[]
) from public, anon, authenticated;
revoke all on function public.update_managed_user_profile(
  bigint, text, text, text, text, bigint, bigint, bigint[]
) from public, anon, authenticated;
revoke all on function public.set_managed_user_active(bigint, boolean)
  from public, anon, authenticated;
revoke all on function public.soft_delete_managed_user(bigint)
  from public, anon, authenticated;
revoke all on function public.rollback_managed_user_create(uuid)
  from public, anon, authenticated;

grant execute on function public.create_managed_user_profile(
  uuid, text, text, text, text, text, bigint, bigint, bigint[]
) to service_role;
grant execute on function public.update_managed_user_profile(
  bigint, text, text, text, text, bigint, bigint, bigint[]
) to service_role;
grant execute on function public.set_managed_user_active(bigint, boolean)
  to service_role;
grant execute on function public.soft_delete_managed_user(bigint)
  to service_role;
grant execute on function public.rollback_managed_user_create(uuid)
  to service_role;
