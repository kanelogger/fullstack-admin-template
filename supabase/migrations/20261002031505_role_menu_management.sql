-- Role and menu administration stay behind narrowly scoped database APIs.
-- Menu route keys are stable client-side registry entries; server input never
-- selects a Vue import path or component.
insert into public.permission_catalog (permission_key, description)
values
  ('administration.roles.read', '读取角色和角色权限'),
  ('administration.roles.create', '创建角色'),
  ('administration.roles.update', '更新角色'),
  ('administration.roles.delete', '删除角色'),
  ('administration.roles.assign_permissions', '分配角色权限'),
  ('administration.menus.read', '读取菜单'),
  ('administration.menus.create', '创建菜单'),
  ('administration.menus.update', '更新菜单'),
  ('administration.menus.delete', '删除菜单')
on conflict (permission_key) do update
set description = excluded.description;

create function app_private.role_read_model(p_role_id bigint)
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
        and profile.is_active
        and profile.deleted_at is null
    ),
    'permissionKeys', case
      when role.code = 'SUPER_ADMIN' then coalesce(
        (
          select jsonb_agg(permission.permission_key order by permission.permission_key)
          from public.permission_catalog as permission
        ),
        '[]'::jsonb
      )
      else coalesce(
        (
          select jsonb_agg(role_permission.permission_key order by role_permission.permission_key)
          from public.role_permissions as role_permission
          where role_permission.role_id = role.id
        ),
        '[]'::jsonb
      )
    end,
    'createdAt', role.created_at,
    'updatedAt', role.updated_at
  )
  from public.roles as role
  where role.id = p_role_id;
$$;

revoke all on function app_private.role_read_model(bigint)
  from public, anon, authenticated, service_role;

create function public.admin_role_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.has_permission('administration.roles.read') then
    raise exception using errcode = '42501', message = 'Role read permission is required';
  end if;

  return jsonb_build_object(
    'roles', coalesce(
      (
        select jsonb_agg(app_private.role_read_model(role.id) order by role.name, role.code)
        from public.roles as role
      ),
      '[]'::jsonb
    ),
    'permissions', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('key', permission.permission_key, 'description', permission.description)
          order by permission.permission_key
        )
        from public.permission_catalog as permission
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create function public.save_admin_role(
  p_role_id text,
  p_code text,
  p_name text,
  p_description text,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role_id bigint;
  existing_role public.roles%rowtype;
begin
  if nullif(trim(p_code), '') is null
    or length(trim(p_code)) > 64
    or trim(p_code) !~ '^[A-Z][A-Z0-9_]{1,63}$'
    or nullif(trim(p_name), '') is null
    or length(trim(p_name)) > 128
    or coalesce(length(trim(p_description)), 0) > 2000
    or p_is_active is null then
    raise exception using errcode = '22023', message = 'Role fields are invalid';
  end if;

  if p_role_id is null then
    if not app_private.has_permission('administration.roles.create') then
      raise exception using errcode = '42501', message = 'Role create permission is required';
    end if;
    if trim(p_code) in ('SUPER_ADMIN', 'OPERATOR', 'COMMON_USER') then
      raise exception using errcode = '23514', message = 'Reserved role codes cannot be created';
    end if;

    insert into public.roles (code, name, description, is_system, is_active)
    values (trim(p_code), trim(p_name), nullif(trim(p_description), ''), false, p_is_active)
    returning id into target_role_id;
  else
    if p_role_id !~ '^[1-9][0-9]*$'
      or p_role_id::numeric > 9223372036854775807 then
      raise exception using errcode = '22023', message = 'Role ID is invalid';
    end if;
    if not app_private.has_permission('administration.roles.update') then
      raise exception using errcode = '42501', message = 'Role update permission is required';
    end if;

    target_role_id := p_role_id::bigint;
    select * into existing_role
    from public.roles as role
    where role.id = target_role_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Role was not found';
    end if;
    if trim(p_code) is distinct from existing_role.code then
      raise exception using errcode = '23514', message = 'Role codes are immutable';
    end if;
    if existing_role.code = 'SUPER_ADMIN' and not p_is_active then
      raise exception using errcode = '23514', message = 'SUPER_ADMIN must remain active';
    end if;

    update public.roles as role
    set name = trim(p_name),
        description = nullif(trim(p_description), ''),
        is_active = p_is_active
    where role.id = target_role_id;
  end if;

  return app_private.role_read_model(target_role_id);
end;
$$;

create function public.replace_role_permissions(
  p_role_id bigint,
  p_permission_keys text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role public.roles%rowtype;
begin
  if p_role_id is null or p_permission_keys is null then
    raise exception using errcode = '22023', message = 'Role permission input is invalid';
  end if;
  if not app_private.has_permission('administration.roles.assign_permissions') then
    raise exception using errcode = '42501', message = 'Role permission assignment is required';
  end if;

  select * into target_role
  from public.roles as role
  where role.id = p_role_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Role was not found';
  end if;
  if target_role.code = 'SUPER_ADMIN' then
    raise exception using errcode = '23514', message = 'SUPER_ADMIN permissions are granted by the system';
  end if;
  if cardinality(p_permission_keys) > 500
    or (select count(distinct key)::integer from unnest(p_permission_keys) as requested(key))
       <> cardinality(p_permission_keys) then
    raise exception using errcode = '22023', message = 'Permission keys must be unique and within the limit';
  end if;
  if exists (
    select 1
    from unnest(p_permission_keys) as requested(key)
    left join public.permission_catalog as permission
      on permission.permission_key = requested.key
    where permission.permission_key is null
  ) then
    raise exception using errcode = '23503', message = 'A permission key is not registered';
  end if;

  delete from public.role_permissions as role_permission
  where role_permission.role_id = p_role_id;

  insert into public.role_permissions (role_id, permission_key)
  select p_role_id, requested.key
  from unnest(p_permission_keys) as requested(key);
end;
$$;

create function public.delete_admin_role(p_role_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role public.roles%rowtype;
begin
  if p_role_id is null then
    raise exception using errcode = '22023', message = 'Role ID is required';
  end if;
  if not app_private.has_permission('administration.roles.delete') then
    raise exception using errcode = '42501', message = 'Role delete permission is required';
  end if;

  select * into target_role
  from public.roles as role
  where role.id = p_role_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Role was not found';
  end if;
  if target_role.is_system then
    raise exception using errcode = '23514', message = 'System roles cannot be deleted';
  end if;
  if exists (select 1 from public.user_roles as user_role where user_role.role_id = p_role_id) then
    raise exception using errcode = '23503', message = 'Role is assigned to users';
  end if;

  delete from public.role_permissions as role_permission
  where role_permission.role_id = p_role_id;
  delete from public.roles as role where role.id = p_role_id;
end;
$$;

create table public.menus (
  id bigint generated by default as identity primary key,
  parent_id bigint references public.menus (id) on delete restrict,
  kind text not null check (kind in ('group', 'route')),
  route_key text,
  path text not null check (path = '/' or path ~ '^(/[A-Za-z0-9_:-]+)+/?$'),
  title text not null check (length(trim(title)) between 1 and 128),
  icon text check (icon is null or length(icon) <= 128),
  sort_order integer not null check (sort_order between 0 and 100000),
  is_visible boolean not null default true,
  is_active boolean not null default true,
  required_permission_key text references public.permission_catalog (permission_key),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menus_kind_route_contract check (
    (kind = 'group' and route_key is null and required_permission_key is null)
    or (kind = 'route' and route_key is not null)
  ),
  constraint menus_route_key_registry check (
    route_key is null or route_key in (
      'dashboard.overview',
      'account.profile',
      'account.change-password',
      'communication.messages',
      'operation.attachments',
      'administration.users',
      'administration.roles',
      'administration.menus',
      'administration.departments',
      'administration.posts',
      'administration.dictionaries',
      'administration.configurations',
      'audit.login-logs',
      'audit.operation-logs',
      'audit.exception-logs'
    )
  )
);

create unique index menus_path_lower_uidx on public.menus (lower(path));
create unique index menus_route_key_uidx on public.menus (route_key) where route_key is not null;
create index menus_parent_sort_idx on public.menus (parent_id, sort_order, title);
create index menus_permission_idx on public.menus (required_permission_key) where required_permission_key is not null;

comment on table public.menus is
  'Navigation metadata referencing only a closed frontend route registry; it never stores executable component paths.';
comment on column public.menus.route_key is
  'Stable key from frontend/src/features/menus/menu-routes.registry.ts; not a server module path.';

alter table public.menus enable row level security;
revoke all on public.menus from public, anon, authenticated;
grant select on public.menus to authenticated;
create policy menus_read_authorized
on public.menus for select to authenticated
using ((select app_private.has_permission('administration.menus.read')));

create trigger menus_touch_updated_at
before update on public.menus
for each row execute function app_private.touch_updated_at();

create view public.menu_management_read_model
with (security_invoker = true)
as
select
  menu.id::text as id,
  menu.parent_id::text as parent_id,
  menu.kind,
  menu.route_key,
  menu.path,
  menu.title,
  menu.icon,
  menu.sort_order,
  menu.is_visible,
  menu.is_active,
  menu.required_permission_key,
  menu.created_at,
  menu.updated_at
from public.menus as menu;

revoke all on public.menu_management_read_model from public, anon, authenticated;
grant select on public.menu_management_read_model to authenticated;

create function public.admin_menu_catalog()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
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
      ) order by menu.parent_id nulls first, menu.sort_order, menu.title, menu.id
    ),
    '[]'::jsonb
  )
  from public.menu_management_read_model as menu;
$$;

create function public.save_admin_menu(
  p_menu_id text,
  p_parent_id text,
  p_kind text,
  p_route_key text,
  p_path text,
  p_title text,
  p_icon text,
  p_sort_order integer,
  p_is_visible boolean,
  p_is_active boolean,
  p_required_permission_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_menu_id bigint;
  target_parent_id bigint;
  permission_key text;
  saved_menu public.menus%rowtype;
begin
  if p_kind is null or p_kind not in ('group', 'route')
    or p_path is null
    or not (p_path = '/' or p_path ~ '^(/[A-Za-z0-9_:-]+)+/?$')
    or nullif(trim(p_title), '') is null
    or length(trim(p_title)) > 128
    or (p_icon is not null and length(p_icon) > 128)
    or p_sort_order is null or p_sort_order < 0 or p_sort_order > 100000
    or p_is_visible is null or p_is_active is null then
    raise exception using errcode = '22023', message = 'Menu fields are invalid';
  end if;

  if p_kind = 'group' then
    if p_route_key is not null or p_required_permission_key is not null then
      raise exception using errcode = '23514', message = 'Group menus cannot bind a route or permission';
    end if;
    permission_key := 'administration.menus.create';
  else
    if p_route_key is null or p_route_key not in (
      'dashboard.overview', 'account.profile', 'account.change-password',
      'communication.messages', 'operation.attachments', 'administration.users',
      'administration.roles', 'administration.menus', 'administration.departments',
      'administration.posts', 'administration.dictionaries', 'administration.configurations',
      'audit.login-logs', 'audit.operation-logs', 'audit.exception-logs'
    ) then
      raise exception using errcode = '23514', message = 'Route key is not registered';
    end if;
    permission_key := 'administration.menus.create';
  end if;

  if p_parent_id is not null then
    if p_parent_id !~ '^[1-9][0-9]*$'
      or p_parent_id::numeric > 9223372036854775807 then
      raise exception using errcode = '22023', message = 'Parent menu ID is invalid';
    end if;
    target_parent_id := p_parent_id::bigint;
    if not exists (
      select 1 from public.menus as parent
      where parent.id = target_parent_id and parent.kind = 'group'
    ) then
      raise exception using errcode = '23503', message = 'Parent menu must be an existing group';
    end if;
  end if;

  if p_menu_id is null then
    if not app_private.has_permission(permission_key) then
      raise exception using errcode = '42501', message = 'Menu create permission is required';
    end if;
  else
    if p_menu_id !~ '^[1-9][0-9]*$'
      or p_menu_id::numeric > 9223372036854775807 then
      raise exception using errcode = '22023', message = 'Menu ID is invalid';
    end if;
    target_menu_id := p_menu_id::bigint;
    if not app_private.has_permission('administration.menus.update') then
      raise exception using errcode = '42501', message = 'Menu update permission is required';
    end if;
    if not exists (select 1 from public.menus as menu where menu.id = target_menu_id) then
      raise exception using errcode = 'P0002', message = 'Menu was not found';
    end if;
  end if;

  if p_required_permission_key is not null and not exists (
    select 1 from public.permission_catalog as permission
    where permission.permission_key = p_required_permission_key
  ) then
    raise exception using errcode = '23503', message = 'Required permission is not registered';
  end if;

  if p_menu_id is not null and p_parent_id is not null and exists (
    with recursive ancestors(id, parent_id, visited) as (
      select menu.id, menu.parent_id, array[menu.id]::bigint[]
      from public.menus as menu
      where menu.id = target_parent_id
      union all
      select parent.id, parent.parent_id, ancestors.visited || parent.id
      from public.menus as parent
      join ancestors on parent.id = ancestors.parent_id
      where not parent.id = any(ancestors.visited)
    )
    select 1 from ancestors where id = target_menu_id
  ) then
    raise exception using errcode = '23514', message = 'Menu hierarchy cannot contain a cycle';
  end if;

  if p_kind = 'route' and exists (
    select 1 from public.menus as child where child.parent_id = target_menu_id
  ) then
    raise exception using errcode = '23514', message = 'A menu with children must remain a group';
  end if;

  if p_menu_id is null then
    insert into public.menus (
      parent_id, kind, route_key, path, title, icon, sort_order,
      is_visible, is_active, required_permission_key
    ) values (
      target_parent_id, p_kind, p_route_key, trim(p_path), trim(p_title), nullif(trim(p_icon), ''), p_sort_order,
      p_is_visible, p_is_active, p_required_permission_key
    ) returning * into saved_menu;
  else
    update public.menus as menu
    set parent_id = target_parent_id,
        kind = p_kind,
        route_key = p_route_key,
        path = trim(p_path),
        title = trim(p_title),
        icon = nullif(trim(p_icon), ''),
        sort_order = p_sort_order,
        is_visible = p_is_visible,
        is_active = p_is_active,
        required_permission_key = p_required_permission_key
    where menu.id = target_menu_id
    returning menu.* into saved_menu;
  end if;

  return jsonb_build_object(
    'id', saved_menu.id::text,
    'parentId', saved_menu.parent_id::text,
    'kind', saved_menu.kind,
    'routeKey', saved_menu.route_key,
    'path', saved_menu.path,
    'title', saved_menu.title,
    'icon', saved_menu.icon,
    'sortOrder', saved_menu.sort_order,
    'isVisible', saved_menu.is_visible,
    'isActive', saved_menu.is_active,
    'requiredPermissionKey', saved_menu.required_permission_key,
    'createdAt', saved_menu.created_at,
    'updatedAt', saved_menu.updated_at
  );
end;
$$;

create function public.delete_admin_menu(p_menu_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_menu_id is null then
    raise exception using errcode = '22023', message = 'Menu ID is required';
  end if;
  if not app_private.has_permission('administration.menus.delete') then
    raise exception using errcode = '42501', message = 'Menu delete permission is required';
  end if;
  if not exists (select 1 from public.menus as menu where menu.id = p_menu_id) then
    raise exception using errcode = 'P0002', message = 'Menu was not found';
  end if;
  if exists (select 1 from public.menus as child where child.parent_id = p_menu_id) then
    raise exception using errcode = '23503', message = 'Menu has child entries';
  end if;

  delete from public.menus as menu where menu.id = p_menu_id;
end;
$$;

revoke all on function public.admin_role_catalog() from public, anon;
revoke all on function public.save_admin_role(text, text, text, text, boolean) from public, anon;
revoke all on function public.replace_role_permissions(bigint, text[]) from public, anon;
revoke all on function public.delete_admin_role(bigint) from public, anon;
revoke all on function public.admin_menu_catalog() from public, anon;
revoke all on function public.save_admin_menu(text, text, text, text, text, text, text, integer, boolean, boolean, text)
  from public, anon;
revoke all on function public.delete_admin_menu(bigint) from public, anon;

grant execute on function public.admin_role_catalog() to authenticated;
grant execute on function public.save_admin_role(text, text, text, text, boolean) to authenticated;
grant execute on function public.replace_role_permissions(bigint, text[]) to authenticated;
grant execute on function public.delete_admin_role(bigint) to authenticated;
grant execute on function public.admin_menu_catalog() to authenticated;
grant execute on function public.save_admin_menu(text, text, text, text, text, text, text, integer, boolean, boolean, text)
  to authenticated;
grant execute on function public.delete_admin_menu(bigint) to authenticated;

revoke insert, update, delete on public.roles, public.role_permissions from authenticated;
comment on function public.admin_role_catalog() is
  'Reads role metadata, effective permissions, and permission descriptions after checking the caller permission.';
comment on function public.admin_menu_catalog() is
  'Returns menu IDs as decimal text through an invoker function; menu rows remain subject to RLS.';
