-- Expose only the caller's active, visible menu paths. Menu rows are
-- navigation metadata; data authorization remains in feature RLS/RPCs.
create function app_private.can_read_menu(p_menu_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive menu_chain(
    id,
    parent_id,
    is_active,
    is_visible,
    required_permission_key,
    visited
  ) as (
    select
      menu.id,
      menu.parent_id,
      menu.is_active,
      menu.is_visible,
      menu.required_permission_key,
      array[menu.id]::bigint[]
    from public.menus as menu
    where menu.id = p_menu_id
    union all
    select
      parent.id,
      parent.parent_id,
      parent.is_active,
      parent.is_visible,
      parent.required_permission_key,
      menu_chain.visited || parent.id
    from public.menus as parent
    join menu_chain on parent.id = menu_chain.parent_id
    where not parent.id = any(menu_chain.visited)
  )
  select
    (select app_private.is_password_authenticated())
    and exists (
      select 1
      from public.profiles as profile
      where profile.auth_user_id = (select auth.uid())
        and profile.is_active
        and profile.deleted_at is null
    )
    and exists (select 1 from menu_chain where id = p_menu_id)
    and not exists (
      select 1
      from menu_chain
      where not is_active
        or not is_visible
        or (
          required_permission_key is not null
          and not app_private.has_permission(required_permission_key)
        )
    );
$$;

revoke all on function app_private.can_read_menu(bigint) from public, anon;
grant execute on function app_private.can_read_menu(bigint) to authenticated;

create policy menus_read_navigation
on public.menus for select to authenticated
using ((select app_private.can_read_menu(id)));

create function public.current_navigation()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive accessible_menus as (
    select *
    from public.menu_management_read_model as menu
    where menu.is_active and menu.is_visible
  ),
  route_ancestors(id, parent_id) as (
    select menu.id, menu.parent_id
    from accessible_menus as menu
    where menu.kind = 'route'
    union all
    select parent.id, parent.parent_id
    from accessible_menus as parent
    join route_ancestors as child on parent.id = child.parent_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', menu.id,
        'parentId', menu.parent_id,
        'kind', menu.kind,
        'routeKey', menu.route_key,
        'path', menu.path,
        'title', menu.title,
        'icon', menu.icon,
        'sortOrder', menu.sort_order,
        'requiredPermissionKey', menu.required_permission_key
      ) order by menu.parent_id nulls first, menu.sort_order, menu.title, menu.id
    ),
    '[]'::jsonb
  )
  from accessible_menus as menu
  where menu.kind = 'route'
     or exists (select 1 from route_ancestors where route_ancestors.id = menu.id);
$$;

revoke all on function public.current_navigation() from public, anon;
grant execute on function public.current_navigation() to authenticated;
comment on function public.current_navigation() is
  'Returns the authenticated caller navigation through an invoker view and per-row RLS.';

-- Default navigation is permission-derived. Ordinary users receive only the
-- personal profile and message-center branches; operators also receive their
-- authorized dashboard/attachment modules.
delete from public.role_permissions as role_permission
using public.roles as role
where role.id = role_permission.role_id
  and role.code = 'COMMON_USER'
  and role_permission.permission_key = 'dashboard.overview.read';

insert into public.role_permissions (role_id, permission_key)
select role.id, permission.permission_key
from public.roles as role
join public.permission_catalog as permission
  on permission.permission_key in (
    'identity.profile.read',
    'identity.profile.update'
  )
where role.code = 'OPERATOR'
on conflict (role_id, permission_key) do nothing;

-- Server-only, idempotent migration from legacy menu component paths to the
-- fixed client RouteKey allowlist. No executable component path is accepted.
create function public.import_legacy_menus(p_rows jsonb, p_apply boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_count integer;
  distinct_id_count integer;
  already_present_count integer;
  inserted_count integer := 0;
  maximum_menu_id bigint;
  item record;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Legacy menu import input must be a JSON array';
  end if;

  source_count := jsonb_array_length(p_rows);
  if source_count > 1000 then
    raise exception 'Legacy menu import batches cannot exceed 1000 rows';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text,
      parent_id text,
      kind text,
      route_key text,
      path text,
      title text,
      icon text,
      sort_order integer,
      is_visible boolean,
      is_active boolean,
      required_permission_key text
    )
    where coalesce(source.id, '') !~ '^[1-9][0-9]*$'
       or (coalesce(source.parent_id, '') <> '' and source.parent_id !~ '^[1-9][0-9]*$')
       or source.kind is null or source.kind not in ('group', 'route')
       or source.path is null
       or not (source.path = '/' or source.path ~ '^(/[A-Za-z0-9_:-]+)+/?$')
       or nullif(trim(source.title), '') is null
       or length(trim(source.title)) > 128
       or (source.icon is not null and length(source.icon) > 128)
       or source.sort_order is null or source.sort_order < 0 or source.sort_order > 100000
       or source.is_visible is null or source.is_active is null
       or (
         source.kind = 'group'
         and (source.route_key is not null or source.required_permission_key is not null)
       )
       or (
         source.kind = 'route'
         and coalesce(source.route_key, '') not in (
           'dashboard.overview', 'account.profile', 'account.change-password',
           'communication.messages', 'operation.attachments', 'administration.users',
           'administration.roles', 'administration.menus', 'administration.departments',
           'administration.posts', 'administration.dictionaries', 'administration.configurations',
           'audit.login-logs', 'audit.operation-logs', 'audit.exception-logs'
         )
       )
  ) then
    raise exception 'Legacy menu import contains invalid or unregistered fields';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) as source(row)
    where (source.row->>'id')::numeric > 9223372036854775807
       or nullif(source.row->>'parent_id', '')::numeric > 9223372036854775807
       or length(trim(source.row->>'path')) > 255
  ) then
    raise exception 'Legacy menu import contains values outside supported ranges';
  end if;

  select count(distinct source.row->>'id')::integer
  into distinct_id_count
  from jsonb_array_elements(p_rows) as source(row);
  if distinct_id_count <> source_count then
    raise exception 'Legacy menu import contains duplicate IDs';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(route_key text)
    where source.route_key is not null
    group by source.route_key
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(path text)
    group by lower(trim(source.path))
    having count(*) > 1
  ) then
    raise exception 'Legacy menu import contains duplicate route keys or paths';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(id text, parent_id text)
    where source.parent_id is not null
      and not exists (
        select 1
        from jsonb_to_recordset(p_rows) as candidate(id text)
        where candidate.id = source.parent_id
      )
      and not exists (
        select 1 from public.menus as parent
        where parent.id = source.parent_id::bigint and parent.kind = 'group'
      )
  ) then
    raise exception 'Legacy menu import references a missing parent';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(parent_id text)
    join jsonb_to_recordset(p_rows) as parent(id text, kind text)
      on parent.id = source.parent_id
    where parent.kind <> 'group'
  ) then
    raise exception 'Legacy menu parent rows must be groups';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(required_permission_key text)
    where source.required_permission_key is not null
      and not exists (
        select 1 from public.permission_catalog as permission
        where permission.permission_key = source.required_permission_key
      )
  ) then
    raise exception 'Legacy menu import references an unregistered permission';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text,
      parent_id text,
      kind text,
      route_key text,
      path text,
      title text,
      icon text,
      sort_order integer,
      is_visible boolean,
      is_active boolean,
      required_permission_key text
    )
    join public.menus as menu on menu.id = source.id::bigint
    where menu.parent_id is distinct from nullif(source.parent_id, '')::bigint
       or menu.kind is distinct from source.kind
       or menu.route_key is distinct from source.route_key
       or menu.path is distinct from trim(source.path)
       or menu.title is distinct from trim(source.title)
       or menu.icon is distinct from nullif(trim(coalesce(source.icon, '')), '')
       or menu.sort_order is distinct from source.sort_order
       or menu.is_visible is distinct from source.is_visible
       or menu.is_active is distinct from source.is_active
       or menu.required_permission_key is distinct from source.required_permission_key
  ) then
    raise exception 'Legacy menu import conflicts with existing menu data';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(id text, route_key text, path text)
    where exists (
      select 1 from public.menus as menu
      where menu.id <> source.id::bigint
        and source.route_key is not null
        and menu.route_key = source.route_key
    ) or exists (
      select 1 from public.menus as menu
      where menu.id <> source.id::bigint
        and lower(menu.path) = lower(trim(source.path))
    )
  ) then
    raise exception 'Legacy menu import conflicts with an existing route key or path';
  end if;

  with recursive source_rows(id, parent_id) as (
    select source.id::bigint, nullif(source.parent_id, '')::bigint
    from jsonb_to_recordset(p_rows) as source(id text, parent_id text)
  ), reachable(id, depth) as (
    select source.id, 0
    from source_rows as source
    where source.parent_id is null
       or exists (select 1 from public.menus as parent where parent.id = source.parent_id)
    union all
    select child.id, reachable.depth + 1
    from source_rows as child
    join reachable on child.parent_id = reachable.id
    where reachable.depth < source_count
  )
  select count(distinct id)::integer into distinct_id_count from reachable;
  if distinct_id_count <> source_count then
    raise exception 'Legacy menu import contains a parent cycle';
  end if;

  select count(*)::integer into already_present_count
  from jsonb_to_recordset(p_rows) as source(id text)
  join public.menus as menu on menu.id = source.id::bigint;

  if p_apply then
    for item in
      with recursive source_rows(id, parent_id, depth) as (
        select source.id::bigint, nullif(source.parent_id, '')::bigint, 0
        from jsonb_to_recordset(p_rows) as source(id text, parent_id text)
        where nullif(source.parent_id, '') is null
           or exists (
             select 1 from public.menus as parent
             where parent.id = nullif(source.parent_id, '')::bigint
           )
        union all
        select child.id::bigint, nullif(child.parent_id, '')::bigint, parent.depth + 1
        from jsonb_to_recordset(p_rows) as child(id text, parent_id text)
        join source_rows as parent on parent.id = nullif(child.parent_id, '')::bigint
        where parent.depth < source_count
      )
      select
        source.id::bigint as id,
        nullif(source.parent_id, '')::bigint as parent_id,
        source.kind,
        source.route_key,
        trim(source.path) as path,
        trim(source.title) as title,
        nullif(trim(coalesce(source.icon, '')), '') as icon,
        source.sort_order,
        source.is_visible,
        source.is_active,
        source.required_permission_key,
        hierarchy.depth
      from jsonb_to_recordset(p_rows) as source(
        id text,
        parent_id text,
        kind text,
        route_key text,
        path text,
        title text,
        icon text,
        sort_order integer,
        is_visible boolean,
        is_active boolean,
        required_permission_key text
      )
      join source_rows as hierarchy on hierarchy.id = source.id::bigint
      order by hierarchy.depth, source.id::bigint
    loop
      insert into public.menus (
        id, parent_id, kind, route_key, path, title, icon, sort_order,
        is_visible, is_active, required_permission_key
      ) values (
        item.id, item.parent_id, item.kind, item.route_key, item.path, item.title,
        item.icon, item.sort_order, item.is_visible, item.is_active,
        item.required_permission_key
      )
      on conflict (id) do nothing;
    end loop;

    select max(id) into maximum_menu_id from public.menus;
    if maximum_menu_id is not null then
      perform setval(pg_get_serial_sequence('public.menus', 'id'), maximum_menu_id, true);
    end if;
    inserted_count := source_count - already_present_count;
  end if;

  return jsonb_build_object(
    'sourceCount', source_count,
    'alreadyPresentCount', already_present_count,
    'rowsToInsert', source_count - already_present_count,
    'insertedCount', inserted_count
  );
end;
$$;

revoke all on function public.import_legacy_menus(jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.import_legacy_menus(jsonb, boolean)
  to service_role;
comment on function public.import_legacy_menus(jsonb, boolean) is
  'Server-only deterministic route-key migration; executable component paths are never imported.';
