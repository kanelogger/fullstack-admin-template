-- Role members and menu access are derived from the existing permission keys.
-- No second role/menu relationship table is introduced.
do $$
begin
  if exists (
    select 1 from public.menus
    where kind = 'route' and required_permission_key is null
  ) then
    raise exception 'Route menus without a permission key must be repaired before authorization management is enabled';
  end if;
end;
$$;

alter table public.menus
  drop constraint menus_kind_route_contract,
  add constraint menus_kind_route_contract check (
    (kind = 'group' and route_key is null and required_permission_key is null)
    or (kind = 'route' and route_key is not null and required_permission_key is not null)
  );

create or replace function app_private.role_read_model(p_role_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', role.id::text,
    'code', role.code,
    'name', role.name,
    'description', role.description,
    'isSystem', role.is_system,
    'isActive', role.is_active,
    'userCount', (
      select count(*)::integer
      from public.user_roles as user_role
      join public.profiles as profile on profile.id = user_role.user_id
      where user_role.role_id = role.id
        and profile.deleted_at is null
    ),
    'permissionKeys', case
      when role.code = 'SUPER_ADMIN' then coalesce(
        (select jsonb_agg(permission.permission_key order by permission.permission_key)
         from public.permission_catalog as permission),
        '[]'::jsonb
      )
      else coalesce(
        (select jsonb_agg(role_permission.permission_key order by role_permission.permission_key)
         from public.role_permissions as role_permission
         where role_permission.role_id = role.id),
        '[]'::jsonb
      )
    end,
    'createdAt', role.created_at,
    'updatedAt', role.updated_at
  )
  from public.roles as role
  where role.id = p_role_id;
$$;

create function public.admin_roles_page(
  p_name text,
  p_code text,
  p_status text,
  p_page integer,
  p_page_size integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  total_count integer;
begin
  if not app_private.has_permission('administration.roles.read') then
    raise exception using errcode = '42501', message = 'Role read permission is required';
  end if;
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not between 1 and 100
     or coalesce(p_status, 'all') not in ('all', 'active', 'inactive')
     or length(coalesce(p_name, '')) > 128 or length(coalesce(p_code, '')) > 64 then
    raise exception using errcode = '22023', message = 'Role page request is invalid';
  end if;

  select count(*)::integer into total_count
  from public.roles as role
  where (nullif(trim(p_name), '') is null or position(lower(trim(p_name)) in lower(role.name)) > 0)
    and (nullif(trim(p_code), '') is null or position(lower(trim(p_code)) in lower(role.code)) > 0)
    and (coalesce(p_status, 'all') = 'all'
      or role.is_active = (coalesce(p_status, 'all') = 'active'));

  return jsonb_build_object(
    'roles', coalesce(
      (select jsonb_agg(app_private.role_read_model(page_role.id) order by page_role.name, page_role.code)
       from (
         select role.id, role.name, role.code
         from public.roles as role
         where (nullif(trim(p_name), '') is null or position(lower(trim(p_name)) in lower(role.name)) > 0)
           and (nullif(trim(p_code), '') is null or position(lower(trim(p_code)) in lower(role.code)) > 0)
           and (coalesce(p_status, 'all') = 'all'
             or role.is_active = (coalesce(p_status, 'all') = 'active'))
         order by role.name, role.code
         offset (p_page - 1) * p_page_size
         limit p_page_size
       ) as page_role),
      '[]'::jsonb
    ),
    'permissions', coalesce(
      (select jsonb_agg(jsonb_build_object('key', permission.permission_key, 'description', permission.description)
                        order by permission.permission_key)
       from public.permission_catalog as permission),
      '[]'::jsonb
    ),
    'menus', coalesce(
      (select jsonb_agg(jsonb_build_object(
          'id', menu.id::text,
          'parentId', menu.parent_id::text,
          'kind', menu.kind,
          'routeKey', menu.route_key,
          'path', menu.path,
          'title', menu.title,
          'icon', menu.icon,
          'sortOrder', menu.sort_order,
          'isVisible', menu.is_visible,
          'isActive', menu.is_active,
          'requiredPermissionKey', menu.required_permission_key,
          'createdAt', menu.created_at,
          'updatedAt', menu.updated_at
        ) order by menu.parent_id nulls first, menu.sort_order, menu.title, menu.id)
       from public.menus as menu),
      '[]'::jsonb
    ),
    'total', total_count,
    'page', p_page,
    'pageSize', p_page_size
  );
end;
$$;

create function public.admin_role_members(p_role_id bigint, p_page integer, p_page_size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  total_count integer;
begin
  if not app_private.has_permission('administration.roles.read') then
    raise exception using errcode = '42501', message = 'Role read permission is required';
  end if;
  if p_role_id is null or p_page is null or p_page < 1
     or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Role member page request is invalid';
  end if;
  if not exists (select 1 from public.roles where id = p_role_id) then
    raise exception using errcode = 'P0002', message = 'Role was not found';
  end if;

  select count(*)::integer into total_count
  from public.user_roles as user_role
  join public.profiles as profile on profile.id = user_role.user_id
  where user_role.role_id = p_role_id and profile.deleted_at is null;

  return jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(jsonb_build_object(
          'id', page_profile.id::text,
          'userCode', page_profile.user_code,
          'loginName', page_profile.login_name,
          'displayName', page_profile.display_name,
          'isActive', page_profile.is_active
        ) order by page_profile.display_name, page_profile.login_name, page_profile.id)
       from (
         select profile.id, profile.user_code, profile.login_name, profile.display_name, profile.is_active
         from public.user_roles as user_role
         join public.profiles as profile on profile.id = user_role.user_id
         where user_role.role_id = p_role_id and profile.deleted_at is null
         order by profile.display_name, profile.login_name, profile.id
         offset (p_page - 1) * p_page_size
         limit p_page_size
       ) as page_profile),
      '[]'::jsonb
    ),
    'total', total_count,
    'page', p_page,
    'pageSize', p_page_size
  );
end;
$$;

create function public.replace_role_authorization(
  p_role_id bigint,
  p_menu_permission_keys text[],
  p_action_permission_keys text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role public.roles%rowtype;
  menu_permission_keys text[];
begin
  if not app_private.has_permission('administration.roles.assign_permissions') then
    raise exception using errcode = '42501', message = 'Role permission assignment is required';
  end if;
  if p_role_id is null or p_menu_permission_keys is null or p_action_permission_keys is null
     or cardinality(p_menu_permission_keys) > 100
     or cardinality(p_action_permission_keys) > 500
     or (select count(distinct key)::integer from unnest(p_menu_permission_keys) as item(key)) <> cardinality(p_menu_permission_keys)
     or (select count(distinct key)::integer from unnest(p_action_permission_keys) as item(key)) <> cardinality(p_action_permission_keys)
     or p_menu_permission_keys && p_action_permission_keys then
    raise exception using errcode = '22023', message = 'Role authorization keys are invalid';
  end if;

  select * into target_role from public.roles where id = p_role_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Role was not found'; end if;
  if target_role.code = 'SUPER_ADMIN' then
    raise exception using errcode = '23514', message = 'SUPER_ADMIN authorization is granted by the system';
  end if;

  select coalesce(array_agg(distinct menu.required_permission_key order by menu.required_permission_key), array[]::text[])
  into menu_permission_keys
  from public.menus as menu
  where menu.kind = 'route';

  if exists (
    select 1 from unnest(p_menu_permission_keys) as requested(key)
    where not (requested.key = any(menu_permission_keys))
  ) or exists (
    select 1 from unnest(p_action_permission_keys) as requested(key)
    left join public.permission_catalog as permission on permission.permission_key = requested.key
    where permission.permission_key is null or requested.key = any(menu_permission_keys)
  ) then
    raise exception using errcode = '23503', message = 'A role authorization key is not registered for this authorization type';
  end if;

  delete from public.role_permissions where role_id = p_role_id;
  insert into public.role_permissions (role_id, permission_key)
  select p_role_id, requested.key
  from unnest(p_menu_permission_keys || p_action_permission_keys) as requested(key);
end;
$$;

create function public.menu_role_catalog(p_menu_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_key text;
  shared_menu_count integer;
begin
  if not app_private.has_permission('administration.roles.read') then
    raise exception using errcode = '42501', message = 'Role read permission is required';
  end if;
  if p_menu_id is null then raise exception using errcode = '22023', message = 'Menu ID is required'; end if;

  select required_permission_key into target_key
  from public.menus
  where id = p_menu_id and kind = 'route';
  if target_key is null then raise exception using errcode = '22023', message = 'Only route menus can be authorized'; end if;
  select count(*)::integer into shared_menu_count
  from public.menus as menu
  where menu.kind = 'route' and menu.required_permission_key = target_key;

  return jsonb_build_object(
    'permissionKey', target_key,
    'sharedMenuCount', shared_menu_count,
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', role.id::text,
        'code', role.code,
        'name', role.name,
        'isActive', role.is_active,
        'isSystem', role.is_system,
        'authorized', role.code = 'SUPER_ADMIN' or exists (
          select 1 from public.role_permissions as role_permission
          where role_permission.role_id = role.id and role_permission.permission_key = target_key
        )
      ) order by role.name, role.code)
      from public.roles as role
    ), '[]'::jsonb)
  );
end;
$$;

create function public.replace_menu_role_authorization(p_menu_id bigint, p_role_ids bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_key text;
begin
  if not app_private.has_permission('administration.roles.assign_permissions') then
    raise exception using errcode = '42501', message = 'Role permission assignment is required';
  end if;
  if p_menu_id is null or p_role_ids is null or cardinality(p_role_ids) > 500
     or (select count(distinct role_id)::integer from unnest(p_role_ids) as item(role_id)) <> cardinality(p_role_ids) then
    raise exception using errcode = '22023', message = 'Menu role selection is invalid';
  end if;

  select required_permission_key into target_key
  from public.menus
  where id = p_menu_id and kind = 'route'
  for share;
  if target_key is null then raise exception using errcode = '22023', message = 'Only route menus can be authorized'; end if;

  if exists (
    select 1 from unnest(p_role_ids) as requested(role_id)
    left join public.roles as role on role.id = requested.role_id
    where role.id is null or role.code = 'SUPER_ADMIN'
  ) then
    raise exception using errcode = '23514', message = 'Selected roles must be active non-system roles';
  end if;

  perform role.id
  from public.roles as role
  where role.id = any(p_role_ids)
  order by role.id
  for update;

  delete from public.role_permissions as role_permission
  using public.roles as role
  where role_permission.role_id = role.id
    and role_permission.permission_key = target_key
    and role.code <> 'SUPER_ADMIN'
    and not (role.id = any(p_role_ids));

  insert into public.role_permissions (role_id, permission_key)
  select role.id, target_key
  from public.roles as role
  where role.id = any(p_role_ids)
    and role.code <> 'SUPER_ADMIN'
  on conflict (role_id, permission_key) do nothing;
end;
$$;

revoke all on function public.admin_roles_page(text, text, text, integer, integer) from public, anon;
revoke all on function public.admin_role_members(bigint, integer, integer) from public, anon;
revoke all on function public.replace_role_authorization(bigint, text[], text[]) from public, anon;
revoke all on function public.menu_role_catalog(bigint) from public, anon;
revoke all on function public.replace_menu_role_authorization(bigint, bigint[]) from public, anon;
grant execute on function public.admin_roles_page(text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_role_members(bigint, integer, integer) to authenticated;
grant execute on function public.replace_role_authorization(bigint, text[], text[]) to authenticated;
grant execute on function public.menu_role_catalog(bigint) to authenticated;
grant execute on function public.replace_menu_role_authorization(bigint, bigint[]) to authenticated;

create function public.admin_menu_permission_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.has_permission('administration.menus.read') then
    raise exception using errcode = '42501', message = 'Menu read permission is required';
  end if;
  return coalesce(
    (select jsonb_agg(jsonb_build_object(
        'key', permission.permission_key,
        'description', permission.description
      ) order by permission.permission_key)
     from public.permission_catalog as permission),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.admin_menu_permission_catalog() from public, anon;
grant execute on function public.admin_menu_permission_catalog() to authenticated;
