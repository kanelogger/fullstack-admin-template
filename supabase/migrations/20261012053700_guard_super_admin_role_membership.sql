-- SUPER_ADMIN membership is a database invariant, not only an Edge Function check.
-- authenticated clients with administration.users.assign_roles may still insert and
-- delete other user_roles rows. Changing SUPER_ADMIN membership raises here.
-- A DELETE the caller cannot already read removes nothing. When the row is
-- visible, this trigger raises instead of depending on a silent policy miss.
-- service_role has no end-user identity. user-management checks the caller before
-- invoking the service-role RPCs. Migrations and seed run without a user JWT.

create function app_private.current_user_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app_private.is_password_authenticated())
    and exists (
      select 1
      from public.profiles as profile
      join public.user_roles as membership on membership.user_id = profile.id
      join public.roles as role on role.id = membership.role_id
      where profile.auth_user_id = (select auth.uid())
        and profile.is_active
        and profile.deleted_at is null
        and role.is_active
        and role.code = 'SUPER_ADMIN'
    );
$$;

revoke all on function app_private.current_user_is_super_admin()
  from public, anon, authenticated, service_role;

create function app_private.guard_super_admin_role_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_role_id bigint;
  next_role_id bigint;
  super_admin_membership_changes boolean;
begin
  if tg_op = 'UPDATE'
    and old.user_id is not distinct from new.user_id
    and old.role_id is not distinct from new.role_id then
    return new;
  end if;

  if tg_op = 'DELETE' then
    previous_role_id := old.role_id;
    next_role_id := null;
  else
    previous_role_id := case when tg_op = 'UPDATE' then old.role_id else null end;
    next_role_id := new.role_id;
  end if;

  select exists (
    select 1
    from public.roles as role
    where role.code = 'SUPER_ADMIN'
      and role.id in (previous_role_id, next_role_id)
  )
  into super_admin_membership_changes;

  if not super_admin_membership_changes then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- Trusted server paths have no authenticated super-administrator JWT.
  if coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
    or (
      (select auth.uid()) is null
      and coalesce((select auth.jwt() ->> 'role'), '') = ''
      and session_user in ('postgres', 'supabase_admin')
    ) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if (select app_private.current_user_is_super_admin()) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  raise exception using
    errcode = '42501',
    message = 'Only a super administrator can change super administrator membership';
end;
$$;

revoke all on function app_private.guard_super_admin_role_membership()
  from public, anon, authenticated, service_role;

create trigger user_roles_guard_super_admin_membership
before insert or update or delete on public.user_roles
for each row execute function app_private.guard_super_admin_role_membership();
