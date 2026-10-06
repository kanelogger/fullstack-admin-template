


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "app_private";


ALTER SCHEMA "app_private" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE COLLATION "app_private"."legacy_utf8mb4_unicode_ci" (provider = icu, deterministic = false, locale = 'und-u-ks-level1');


ALTER COLLATION "app_private"."legacy_utf8mb4_unicode_ci" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."can_cleanup_unregistered_attachment_upload"("p_storage_path" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select (select auth.uid()) is not null
    and (select app_private.is_password_authenticated())
    and (select app_private.has_permission('files.attachments.upload'))
    and exists (
      select 1
      from storage.objects as object
      where object.bucket_id = 'admin-attachments'
        and object.name = p_storage_path
        and object.owner_id = (select auth.uid()::text)
        and cardinality(storage.foldername(object.name)) = 1
        and (storage.foldername(object.name))[1] = (select public.current_business_user_id())
    )
    and not exists (
      select 1
      from public.attachments as attachment
      where attachment.storage_path = p_storage_path
    );
$$;


ALTER FUNCTION "app_private"."can_cleanup_unregistered_attachment_upload"("p_storage_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."can_delete_attachment_path"("p_storage_path" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select (select auth.uid()) is not null
    and (select app_private.is_password_authenticated())
    and (select app_private.has_permission('files.attachments.delete'))
    and exists (
      select 1
      from public.attachments as attachment
      where attachment.storage_path = p_storage_path
    );
$$;


ALTER FUNCTION "app_private"."can_delete_attachment_path"("p_storage_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."can_read_menu"("p_menu_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "app_private"."can_read_menu"("p_menu_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."can_read_role"("p_role_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select (select app_private.is_password_authenticated())
    and exists (
      select 1
      from public.user_roles as user_role
      join public.profiles as profile on profile.id = user_role.user_id
      join public.roles as role on role.id = user_role.role_id
      where user_role.role_id = p_role_id
        and profile.auth_user_id = (select auth.uid())
        and profile.is_active
        and profile.deleted_at is null
        and role.is_active
    );
$$;


ALTER FUNCTION "app_private"."can_read_role"("p_role_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."dictionary_item_read_model"("p_id" bigint) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'id', dictionary_item.id::text,
    'dictTypeId', dictionary_item.dict_type_id::text,
    'itemValue', dictionary_item.item_value,
    'itemLabel', dictionary_item.item_label,
    'sortOrder', dictionary_item.sort_order,
    'status', dictionary_item.status,
    'description', dictionary_item.description,
    'createdAt', dictionary_item.created_at,
    'updatedAt', dictionary_item.updated_at
  )
  from public.dict_items as dictionary_item
  where dictionary_item.id = p_id
    and dictionary_item.deleted_at is null;
$$;


ALTER FUNCTION "app_private"."dictionary_item_read_model"("p_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."dictionary_type_read_model"("p_id" bigint) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'id', dictionary_type.id::text,
    'dictCode', dictionary_type.dict_code,
    'dictName', dictionary_type.dict_name,
    'status', dictionary_type.status,
    'description', dictionary_type.description,
    'createdAt', dictionary_type.created_at,
    'updatedAt', dictionary_type.updated_at
  )
  from public.dict_types as dictionary_type
  where dictionary_type.id = p_id
    and dictionary_type.deleted_at is null;
$$;


ALTER FUNCTION "app_private"."dictionary_type_read_model"("p_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."guard_profile_organization_assignments"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_role text := auth.jwt()->>'role';
begin
  if caller_role = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.department_id is not null then
      perform 1 from public.departments as department
      where department.id = new.department_id and not department.deleted
      for key share;
      if not found then
        raise exception using errcode = '23503', message = 'Department is missing or soft-deleted';
      end if;
    end if;
    if new.post_id is not null then
      perform 1 from public.posts as post
      where post.id = new.post_id and not post.deleted
      for key share;
      if not found then
        raise exception using errcode = '23503', message = 'Post is missing or soft-deleted';
      end if;
    end if;
  else
    if new.department_id is distinct from old.department_id and new.department_id is not null then
      perform 1 from public.departments as department
      where department.id = new.department_id and not department.deleted
      for key share;
      if not found then
        raise exception using errcode = '23503', message = 'Department is missing or soft-deleted';
      end if;
    end if;
    if new.post_id is distinct from old.post_id and new.post_id is not null then
      perform 1 from public.posts as post
      where post.id = new.post_id and not post.deleted
      for key share;
      if not found then
        raise exception using errcode = '23503', message = 'Post is missing or soft-deleted';
      end if;
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app_private"."guard_profile_organization_assignments"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."has_permission"("p_permission_key" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select (select app_private.is_password_authenticated())
    and exists (
      select 1
      from public.profiles as profile
      join public.user_roles as user_role on user_role.user_id = profile.id
      join public.roles as role on role.id = user_role.role_id
      where profile.auth_user_id = (select auth.uid())
        and profile.is_active
        and profile.deleted_at is null
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


ALTER FUNCTION "app_private"."has_permission"("p_permission_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."is_current_profile"("p_profile_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select (select app_private.is_password_authenticated())
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = p_profile_id
        and profile.auth_user_id = (select auth.uid())
        and profile.is_active
        and profile.deleted_at is null
    );
$$;


ALTER FUNCTION "app_private"."is_current_profile"("p_profile_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."is_password_authenticated"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;


ALTER FUNCTION "app_private"."is_password_authenticated"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."is_password_recovery_session"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  -- GoTrue currently labels a verified recovery-link session as `otp`.
  select coalesce((select auth.jwt())->'amr', '[]'::jsonb)
    @> '[{"method":"recovery"}]'::jsonb
    or coalesce((select auth.jwt())->'amr', '[]'::jsonb)
    @> '[{"method":"otp"}]'::jsonb;
$$;


ALTER FUNCTION "app_private"."is_password_recovery_session"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."log_current_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id bigint;
  actor_name text;
  row_data jsonb;
  row_id text;
  module_key text;
  operation_key text;
  method_key text;
begin
  if not (select app_private.is_password_authenticated()) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  actor_id := (select public.current_business_user_id())::bigint;
  if actor_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then
    row_data := to_jsonb(old);
  else
    row_data := to_jsonb(new);
  end if;
  row_id := coalesce(
    row_data ->> 'id',
    nullif(concat_ws(':', row_data ->> 'user_id', row_data ->> 'role_id'), ''),
    'unknown'
  );

  module_key := case tg_table_name
    when 'profiles' then 'USER'
    when 'user_roles' then 'USER_ROLE'
    when 'roles' then 'ROLE'
    when 'role_permissions' then 'ROLE_PERMISSION'
    when 'menus' then 'MENU'
    when 'departments' then 'DEPARTMENT'
    when 'posts' then 'POST'
    when 'dict_types' then 'DICTIONARY_TYPE'
    when 'dict_items' then 'DICTIONARY_ITEM'
    when 'system_configs' then 'SYSTEM_CONFIG'
    when 'messages' then 'MESSAGE'
    when 'attachments' then 'ATTACHMENT'
    else upper(tg_table_name)
  end;
  operation_key := case tg_op
    when 'INSERT' then 'CREATE'
    when 'UPDATE' then 'UPDATE'
    when 'DELETE' then 'DELETE'
  end;
  method_key := case tg_op
    when 'INSERT' then 'POST'
    when 'UPDATE' then 'PATCH'
    when 'DELETE' then 'DELETE'
  end;

  select profile.display_name into actor_name
  from public.profiles as profile
  where profile.id = actor_id;

  insert into public.operation_logs (
    operator_id, operator_name, module_code, operation_type,
    request_method, request_path, request_params, operation_result
  ) values (
    actor_id,
    actor_name,
    module_key,
    operation_key,
    method_key,
    '/rest/v1/' || tg_table_name,
    jsonb_build_object('recordId', row_id),
    1
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;


ALTER FUNCTION "app_private"."log_current_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."require_configuration_permission"("p_permission_key" "text") RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select auth.uid()) is null or not (select app_private.is_password_authenticated()) then
    raise exception using errcode = '42501', message = 'A registered password-authenticated session is required';
  end if;
  if not (select app_private.has_permission(p_permission_key)) then
    raise exception using errcode = '42501', message = 'Configuration permission is required';
  end if;
end;
$$;


ALTER FUNCTION "app_private"."require_configuration_permission"("p_permission_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."role_read_model"("p_role_id" bigint) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "app_private"."role_read_model"("p_role_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."session_context"("p_profile_id" bigint) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "app_private"."session_context"("p_profile_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."system_config_read_model"("p_id" bigint) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'id', config.id::text,
    'configCode', config.config_code,
    'configName', config.config_name,
    'configValue', config.config_value,
    'valueType', config.value_type,
    'status', config.status,
    'description', config.description,
    'createdAt', config.created_at,
    'updatedAt', config.updated_at
  )
  from public.system_configs as config
  where config.id = p_id
    and config.deleted_at is null;
$$;


ALTER FUNCTION "app_private"."system_config_read_model"("p_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "app_private"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_dictionary_items"("p_dict_type_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  target_type_id bigint;
begin
  perform app_private.require_configuration_permission('configuration.dictionaries.read');
  if coalesce(p_dict_type_id, '') !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'Dictionary type ID is invalid';
  end if;
  if p_dict_type_id::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Dictionary type ID is invalid';
  end if;
  target_type_id := p_dict_type_id::bigint;
  if not exists (
    select 1 from public.dict_types as dictionary_type
    where dictionary_type.id = target_type_id and dictionary_type.deleted_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'Dictionary type was not found';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        app_private.dictionary_item_read_model(dictionary_item.id)
        order by dictionary_item.sort_order, dictionary_item.id
      )
      from public.dict_items as dictionary_item
      where dictionary_item.dict_type_id = target_type_id
        and dictionary_item.deleted_at is null
    ),
    '[]'::jsonb
  );
end;
$_$;


ALTER FUNCTION "public"."admin_dictionary_items"("p_dict_type_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_dictionary_types"("p_dict_code" "text", "p_dict_name" "text", "p_status" smallint, "p_page" integer, "p_page_size" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform app_private.require_configuration_permission('configuration.dictionaries.read');
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not between 1 and 100
    or (p_status is not null and p_status not in (0, 1)) then
    raise exception using errcode = '22023', message = 'Dictionary filters are invalid';
  end if;

  return (
    with filtered as materialized (
      select dictionary_type.id
      from public.dict_types as dictionary_type
      where dictionary_type.deleted_at is null
        and (p_dict_code is null or dictionary_type.dict_code ilike '%' || trim(p_dict_code) || '%')
        and (p_dict_name is null or dictionary_type.dict_name ilike '%' || trim(p_dict_name) || '%')
        and (p_status is null or dictionary_type.status = p_status)
    ),
    page_rows as (
      select filtered.id
      from filtered
      order by filtered.id desc
      limit p_page_size
      offset ((p_page::bigint - 1) * p_page_size::bigint)
    )
    select jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(app_private.dictionary_type_read_model(page_rows.id) order by page_rows.id desc)
          from page_rows
        ),
        '[]'::jsonb
      ),
      'total', (select count(*)::integer from filtered),
      'page', p_page,
      'pageSize', p_page_size
    )
  );
end;
$$;


ALTER FUNCTION "public"."admin_dictionary_types"("p_dict_code" "text", "p_dict_name" "text", "p_status" smallint, "p_page" integer, "p_page_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_menu_catalog"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."admin_menu_catalog"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_menu_catalog"() IS 'Returns menu IDs as decimal text through an invoker function; menu rows remain subject to RLS.';



CREATE OR REPLACE FUNCTION "public"."admin_menu_permission_catalog"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."admin_menu_permission_catalog"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_role_catalog"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."admin_role_catalog"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_role_catalog"() IS 'Reads role metadata, effective permissions, and permission descriptions after checking the caller permission.';



CREATE OR REPLACE FUNCTION "public"."admin_role_members"("p_role_id" bigint, "p_page" integer, "p_page_size" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."admin_role_members"("p_role_id" bigint, "p_page" integer, "p_page_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_roles_page"("p_name" "text", "p_code" "text", "p_status" "text", "p_page" integer, "p_page_size" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."admin_roles_page"("p_name" "text", "p_code" "text", "p_status" "text", "p_page" integer, "p_page_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_system_configurations"("p_config_code" "text", "p_config_name" "text", "p_status" smallint, "p_page" integer, "p_page_size" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform app_private.require_configuration_permission('configuration.system.read');
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not between 1 and 100
    or (p_status is not null and p_status not in (0, 1)) then
    raise exception using errcode = '22023', message = 'Configuration filters are invalid';
  end if;

  return (
    with filtered as materialized (
      select config.id
      from public.system_configs as config
      where config.deleted_at is null
        and (p_config_code is null or config.config_code ilike '%' || trim(p_config_code) || '%')
        and (p_config_name is null or config.config_name ilike '%' || trim(p_config_name) || '%')
        and (p_status is null or config.status = p_status)
    ),
    page_rows as (
      select filtered.id
      from filtered
      order by filtered.id desc
      limit p_page_size
      offset ((p_page::bigint - 1) * p_page_size::bigint)
    )
    select jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(app_private.system_config_read_model(page_rows.id) order by page_rows.id desc)
          from page_rows
        ),
        '[]'::jsonb
      ),
      'total', (select count(*)::integer from filtered),
      'page', p_page,
      'pageSize', p_page_size
    )
  );
end;
$$;


ALTER FUNCTION "public"."admin_system_configurations"("p_config_code" "text", "p_config_name" "text", "p_status" smallint, "p_page" integer, "p_page_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."attachment_storage_path_for_delete"("p_attachment_id" bigint) RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  object_path text;
begin
  if (select auth.uid()) is null
     or not (select app_private.is_password_authenticated())
     or not (select app_private.has_permission('files.attachments.delete')) then
    raise exception using errcode = '42501', message = 'Attachment delete permission is required';
  end if;

  select attachment.storage_path into object_path
  from public.attachments as attachment
  where attachment.id = p_attachment_id
    and attachment.deleted_at is null;

  if object_path is null then
    raise exception using errcode = 'P0002', message = 'Attachment does not exist';
  end if;
  return object_path;
end;
$$;


ALTER FUNCTION "public"."attachment_storage_path_for_delete"("p_attachment_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."attachment_storage_path_for_delete"("p_attachment_id" bigint) IS 'Returns the private object path only after checking the caller session and delete permission.';



CREATE OR REPLACE FUNCTION "public"."bootstrap_first_admin_profile"("p_auth_user_id" "uuid", "p_login_name" "text", "p_display_name" "text", "p_email" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."bootstrap_first_admin_profile"("p_auth_user_id" "uuid", "p_login_name" "text", "p_display_name" "text", "p_email" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bootstrap_first_admin_profile"("p_auth_user_id" "uuid", "p_login_name" "text", "p_display_name" "text", "p_email" "text") IS 'One-time transactional first-administrator bootstrap; callable only with the service role.';



CREATE OR REPLACE FUNCTION "public"."complete_password_reset"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."complete_password_reset"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_attachment_metadata"("p_original_name" "text", "p_storage_path" "text", "p_mime_type" "text", "p_file_ext" "text", "p_file_size" bigint, "p_business_module" "text", "p_business_record_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor_id bigint;
  created_attachment public.attachments;
  normalized_module text := nullif(trim(p_business_module), '');
  normalized_mime text := lower(trim(coalesce(p_mime_type, '')));
  normalized_ext text := lower(trim(coalesce(p_file_ext, '')));
begin
  if (select auth.uid()) is null
     or not (select app_private.is_password_authenticated()) then
    raise exception using errcode = '42501', message = 'A registered password session is required';
  end if;
  if not (select app_private.has_permission('files.attachments.upload')) then
    raise exception using errcode = '42501', message = 'Attachment upload permission is required';
  end if;

  actor_id := (select public.current_business_user_id())::bigint;
  if actor_id is null
     or nullif(trim(p_original_name), '') is null
     or length(p_original_name) > 255
     or p_original_name ~ '[[:cntrl:]]'
     or p_storage_path is null
     or length(normalized_mime) = 0
     or length(normalized_mime) > 128
     or normalized_ext !~ '^[a-z0-9]{1,32}$'
     or p_file_size is null
     or p_file_size not between 0 and 20971520
     or (p_business_module is not null and normalized_module is null)
     or ((normalized_module is null) <> (p_business_record_id is null))
     or (p_business_record_id is not null and p_business_record_id <= 0)
     or p_storage_path !~ ('^' || actor_id::text || '/[0-9a-f-]{36}\.[a-z0-9]{1,32}$')
     or not (
       (normalized_ext in ('jpg', 'jpeg') and normalized_mime = 'image/jpeg')
       or (normalized_ext = 'png' and normalized_mime = 'image/png')
       or (normalized_ext = 'gif' and normalized_mime = 'image/gif')
       or (normalized_ext = 'webp' and normalized_mime = 'image/webp')
       or (normalized_ext = 'pdf' and normalized_mime = 'application/pdf')
       or (normalized_ext = 'txt' and normalized_mime = 'text/plain')
       or (normalized_ext = 'csv' and normalized_mime = 'text/csv')
       or (normalized_ext = 'docx' and normalized_mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
       or (normalized_ext = 'xlsx' and normalized_mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
       or (normalized_ext = 'zip' and normalized_mime = 'application/zip')
     ) then
    raise exception using errcode = '22023', message = 'Attachment metadata or format is invalid';
  end if;

  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'admin-attachments'
      and object.name = p_storage_path
      and object.owner_id = (select auth.uid()::text)
  ) then
    raise exception using errcode = '23503', message = 'Uploaded storage object is missing';
  end if;

  insert into public.attachments (
    original_name,
    storage_path,
    mime_type,
    file_ext,
    file_size,
    business_module,
    business_record_id,
    reference_status,
    upload_user_id,
    created_by,
    updated_by
  ) values (
    trim(p_original_name),
    p_storage_path,
    normalized_mime,
    normalized_ext,
    p_file_size,
    normalized_module,
    p_business_record_id,
    case when normalized_module is null then 0 else 1 end,
    actor_id,
    actor_id,
    actor_id
  ) returning * into created_attachment;

  return jsonb_build_object(
    'id', created_attachment.id::text,
    'original_name', created_attachment.original_name,
    'storage_path', created_attachment.storage_path,
    'mime_type', created_attachment.mime_type,
    'file_ext', created_attachment.file_ext,
    'file_size', created_attachment.file_size,
    'business_module', created_attachment.business_module,
    'business_record_id', created_attachment.business_record_id::text,
    'reference_status', created_attachment.reference_status,
    'upload_user_id', created_attachment.upload_user_id::text,
    'uploaded_at', created_attachment.uploaded_at
  );
end;
$_$;


ALTER FUNCTION "public"."create_attachment_metadata"("p_original_name" "text", "p_storage_path" "text", "p_mime_type" "text", "p_file_ext" "text", "p_file_size" bigint, "p_business_module" "text", "p_business_record_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_attachment_metadata"("p_original_name" "text", "p_storage_path" "text", "p_mime_type" "text", "p_file_ext" "text", "p_file_size" bigint, "p_business_module" "text", "p_business_record_id" bigint) IS 'Creates an attachment and returns BIGINT identifiers as decimal text.';



CREATE OR REPLACE FUNCTION "public"."create_managed_user_profile"("p_auth_user_id" "uuid", "p_user_code" "text", "p_login_name" "text", "p_display_name" "text", "p_email" "text", "p_phone" "text", "p_department_id" bigint, "p_post_id" bigint, "p_role_ids" bigint[]) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."create_managed_user_profile"("p_auth_user_id" "uuid", "p_user_code" "text", "p_login_name" "text", "p_display_name" "text", "p_email" "text", "p_phone" "text", "p_department_id" bigint, "p_post_id" bigint, "p_role_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_business_user_id"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select profile.id::text
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.is_active
    and (select app_private.is_password_authenticated())
  limit 1;
$$;


ALTER FUNCTION "public"."current_business_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_navigation"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."current_navigation"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_navigation"() IS 'Returns the authenticated caller navigation through an invoker view and per-row RLS.';



CREATE OR REPLACE FUNCTION "public"."current_profile"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select app_private.session_context(profile.id)
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.is_active
    and (select app_private.is_password_authenticated())
  limit 1;
$$;


ALTER FUNCTION "public"."current_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dashboard_overview"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id bigint;
  can_read_users boolean;
  can_read_roles boolean;
  can_read_menus boolean;
  can_read_audit boolean;
  can_read_messages boolean;
  unread_count integer := 0;
  stats jsonb;
begin
  if (select auth.uid()) is null
     or not (select app_private.is_password_authenticated()) then
    raise exception using errcode = '42501', message = 'A registered password session is required';
  end if;
  if not (select app_private.has_permission('dashboard.overview.read')) then
    raise exception using errcode = '42501', message = 'Dashboard read permission is required';
  end if;

  actor_id := (select public.current_business_user_id())::bigint;
  if actor_id is null then
    raise exception using errcode = '42501', message = 'A business profile is required';
  end if;

  can_read_users := (select app_private.has_permission('administration.users.read'));
  can_read_roles := (select app_private.has_permission('administration.roles.read'));
  can_read_menus := (select app_private.has_permission('administration.menus.read'));
  can_read_audit := (select app_private.has_permission('audit.logs.read'));
  can_read_messages := (select app_private.has_permission('communication.messages.read'));

  if can_read_messages then
    select count(*)::integer
    into unread_count
    from public.messages as message
    where message.receiver_id = actor_id
      and not message.read_status
      and not message.deleted;
  end if;

  if can_read_users or can_read_roles or can_read_menus or can_read_audit then
    stats := jsonb_build_object(
      'userCount', case when can_read_users then (
        select count(*)::integer from public.profiles as profile
        where profile.is_active and profile.deleted_at is null
      ) else null end,
      'roleCount', case when can_read_roles then (
        select count(*)::integer from public.roles as role where role.is_active
      ) else null end,
      'menuCount', case when can_read_menus then (
        select count(*)::integer from public.menus as menu where menu.is_active
      ) else null end,
      'todayLoginCount', case when can_read_audit then (
        select count(*)::integer from public.login_logs as log
        where log.logged_at >= date_trunc('day', now()) and log.login_result = 1
      ) else null end,
      'apiErrorCount', case when can_read_audit then (
        select count(*)::integer from public.exception_logs as log
        where log.occurred_at >= date_trunc('day', now())
      ) else null end
    );
  end if;

  return jsonb_build_object(
    'todoCount', unread_count,
    'unreadMessageCount', unread_count,
    'todoMessages', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', todo.id::text,
            'title', todo.title,
            'summary', todo.summary,
            'messageType', todo.message_type,
            'readStatus', todo.read_status,
            'sentAt', todo.sent_at
          ) order by todo.sent_at desc, todo.id desc
        )
        from (
          select message.id, message.title, message.summary, message.message_type,
                 message.read_status, message.sent_at
          from public.messages as message
          where can_read_messages
            and message.receiver_id = actor_id
            and not message.read_status
            and not message.deleted
          order by message.sent_at desc, message.id desc
          limit 5
        ) as todo
      ),
      '[]'::jsonb
    ),
    'recentOperations', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', recent.id::text,
            'operatorName', recent.operator_name,
            'moduleCode', recent.module_code,
            'operationType', recent.operation_type,
            'requestParams', recent.request_params,
            'operationResult', recent.operation_result,
            'operatedAt', recent.operated_at
          ) order by recent.operated_at desc, recent.id desc
        )
        from (
          select log.id, log.operator_name, log.module_code, log.operation_type,
                 log.request_params, log.operation_result, log.operated_at
          from public.operation_logs as log
          where can_read_audit or log.operator_id = actor_id
          order by log.operated_at desc, log.id desc
          limit 5
        ) as recent
      ),
      '[]'::jsonb
    ),
    'recentMessages', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', recent.id::text,
            'title', recent.title,
            'summary', recent.summary,
            'messageType', recent.message_type,
            'readStatus', recent.read_status,
            'sentAt', recent.sent_at
          ) order by recent.sent_at desc, recent.id desc
        )
        from (
          select message.id, message.title, message.summary, message.message_type,
                 message.read_status, message.sent_at
          from public.messages as message
          where can_read_messages
            and message.receiver_id = actor_id
            and not message.deleted
          order by message.sent_at desc, message.id desc
          limit 5
        ) as recent
      ),
      '[]'::jsonb
    ),
    'adminStats', stats
  );
end;
$$;


ALTER FUNCTION "public"."dashboard_overview"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."dashboard_overview"() IS 'Returns caller-scoped unread-message tasks and activity; every aggregate requires its module permission.';



CREATE OR REPLACE FUNCTION "public"."delete_admin_menu"("p_menu_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."delete_admin_menu"("p_menu_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_admin_role"("p_role_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."delete_admin_role"("p_role_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_attachment_metadata"("p_attachment_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id bigint;
begin
  if (select auth.uid()) is null
     or not (select app_private.is_password_authenticated())
     or not (select app_private.has_permission('files.attachments.delete')) then
    raise exception using errcode = '42501', message = 'Attachment delete permission is required';
  end if;

  actor_id := (select public.current_business_user_id())::bigint;
  update public.attachments as attachment
  set deleted_at = now(),
      reference_status = 0,
      updated_by = actor_id
  where attachment.id = p_attachment_id
    and attachment.deleted_at is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'Attachment does not exist';
  end if;
  return true;
end;
$$;


ALTER FUNCTION "public"."delete_attachment_metadata"("p_attachment_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_attachment_metadata"("p_attachment_id" bigint) IS 'Soft-deletes attachment metadata after the authenticated client removes the private object.';



CREATE OR REPLACE FUNCTION "public"."delete_department"("p_department_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  target_id bigint;
begin
  if not app_private.is_password_authenticated()
    or not app_private.has_permission('organization.departments.delete') then
    raise exception using errcode = '42501', message = 'Department delete permission is required';
  end if;
  if p_department_id is null or p_department_id !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'Department ID is invalid';
  end if;
  if p_department_id::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Department ID exceeds PostgreSQL BIGINT range';
  end if;

  target_id := p_department_id::bigint;
  perform 1 from public.departments
  where id = target_id and not deleted
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Department was not found';
  end if;
  if exists (
    select 1 from public.profiles as profile
    where profile.department_id = target_id
  ) then
    raise exception using errcode = '23503', message = 'Department is referenced by profiles';
  end if;

  update public.departments
  set deleted = true
  where id = target_id and not deleted;
  return true;
end;
$_$;


ALTER FUNCTION "public"."delete_department"("p_department_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_post"("p_post_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  target_id bigint;
begin
  if not app_private.is_password_authenticated()
    or not app_private.has_permission('organization.posts.delete') then
    raise exception using errcode = '42501', message = 'Post delete permission is required';
  end if;
  if p_post_id is null or p_post_id !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'Post ID is invalid';
  end if;
  if p_post_id::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Post ID exceeds PostgreSQL BIGINT range';
  end if;

  target_id := p_post_id::bigint;
  perform 1 from public.posts
  where id = target_id and not deleted
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Post was not found';
  end if;
  if exists (
    select 1 from public.profiles as profile
    where profile.post_id = target_id
  ) then
    raise exception using errcode = '23503', message = 'Post is referenced by profiles';
  end if;

  update public.posts
  set deleted = true
  where id = target_id and not deleted;
  return true;
end;
$_$;


ALTER FUNCTION "public"."delete_post"("p_post_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dictionary_options"("p_dict_code" "text", "p_enabled_only" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform app_private.require_configuration_permission('configuration.dictionaries.read');
  if nullif(trim(p_dict_code), '') is null or p_enabled_only is null then
    raise exception using errcode = '22023', message = 'Dictionary option query is invalid';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', dictionary_item.id::text,
          'label', dictionary_item.item_label,
          'value', dictionary_item.item_value,
          'status', dictionary_item.status
        ) order by dictionary_item.sort_order, dictionary_item.id
      )
      from public.dict_types as dictionary_type
      join public.dict_items as dictionary_item
        on dictionary_item.dict_type_id = dictionary_type.id
      where dictionary_type.dict_code collate app_private.legacy_utf8mb4_unicode_ci
          = trim(p_dict_code) collate app_private.legacy_utf8mb4_unicode_ci
        and dictionary_type.deleted_at is null
        and dictionary_item.deleted_at is null
        and (
          not p_enabled_only
          or (dictionary_type.status = 1 and dictionary_item.status = 1)
        )
    ),
    '[]'::jsonb
  );
end;
$$;


ALTER FUNCTION "public"."dictionary_options"("p_dict_code" "text", "p_enabled_only" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_password_reset_requested"("p_auth_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."mark_password_reset_requested"("p_auth_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mark_password_reset_requested"("p_auth_user_id" "uuid") IS 'Server-only reset request marker used to require a subsequent Auth password update.';



CREATE OR REPLACE FUNCTION "public"."menu_role_catalog"("p_menu_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."menu_role_catalog"("p_menu_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_exception_event"("p_request_path" "text", "p_request_method" "text", "p_error_type" "text", "p_error_message" "text", "p_stack_summary" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  exception_id bigint;
begin
  if nullif(trim(p_request_path), '') is null
     or length(p_request_path) > 255
     or nullif(trim(p_request_method), '') is null
     or length(p_request_method) > 16
     or nullif(trim(p_error_type), '') is null
     or length(p_error_type) > 128
     or nullif(trim(p_error_message), '') is null then
    raise exception using errcode = '22023', message = 'Exception audit event is invalid';
  end if;

  insert into public.exception_logs (
    request_path, request_method, error_type, error_message, stack_summary
  ) values (
    left(p_request_path, 255), left(p_request_method, 16), left(p_error_type, 128),
    left(p_error_message, 3000), left(p_stack_summary, 3000)
  ) returning id into exception_id;
  return exception_id::text;
end;
$$;


ALTER FUNCTION "public"."record_exception_event"("p_request_path" "text", "p_request_method" "text", "p_error_type" "text", "p_error_message" "text", "p_stack_summary" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_exception_event"("p_request_path" "text", "p_request_method" "text", "p_error_type" "text", "p_error_message" "text", "p_stack_summary" "text") IS 'Service-role-only writer for sanitized server exceptions.';



CREATE OR REPLACE FUNCTION "public"."record_login_attempt"("p_login_name" "text", "p_user_id" bigint, "p_login_ip" "text", "p_user_agent" "text", "p_login_result" smallint, "p_failure_reason" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if nullif(trim(p_login_name), '') is null
     or length(p_login_name) > 64
     or (p_login_ip is not null and length(p_login_ip) > 64)
     or (p_user_agent is not null and length(p_user_agent) > 512)
     or p_login_result not in (0, 1)
     or (p_failure_reason is not null and length(p_failure_reason) > 255)
     or (p_login_result = 1 and p_user_id is null) then
    raise exception using errcode = '22023', message = 'Login audit event is invalid';
  end if;
  if p_user_id is not null and not exists (
    select 1 from public.profiles as profile where profile.id = p_user_id
  ) then
    raise exception using errcode = '23503', message = 'Login audit user does not exist';
  end if;

  insert into public.login_logs (
    user_id, login_name, login_ip, user_agent, login_result, failure_reason
  ) values (
    p_user_id, trim(p_login_name), p_login_ip, p_user_agent, p_login_result,
    case when p_login_result = 1 then null else left(p_failure_reason, 255) end
  );
  return true;
end;
$$;


ALTER FUNCTION "public"."record_login_attempt"("p_login_name" "text", "p_user_id" bigint, "p_login_ip" "text", "p_user_agent" "text", "p_login_result" smallint, "p_failure_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_login_attempt"("p_login_name" "text", "p_user_id" bigint, "p_login_ip" "text", "p_user_agent" "text", "p_login_result" smallint, "p_failure_reason" "text") IS 'Service-role-only writer for account/password login outcomes; no credentials or tokens are accepted.';



CREATE OR REPLACE FUNCTION "public"."record_operation_event"("p_operator_id" bigint, "p_module_code" "text", "p_operation_type" "text", "p_request_method" "text", "p_request_path" "text", "p_request_params" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  operator_name_snapshot text;
begin
  if p_operator_id is null
     or nullif(trim(p_module_code), '') is null
     or length(p_module_code) > 64
     or nullif(trim(p_operation_type), '') is null
     or length(p_operation_type) > 32
     or nullif(trim(p_request_method), '') is null
     or length(p_request_method) > 16
     or nullif(trim(p_request_path), '') is null
     or length(p_request_path) > 255
     or (p_request_params is not null and (
       jsonb_typeof(p_request_params) <> 'object'
       or pg_column_size(p_request_params) > 3000
     )) then
    raise exception using errcode = '22023', message = 'Operation audit event is invalid';
  end if;

  select profile.display_name into operator_name_snapshot
  from public.profiles as profile
  where profile.id = p_operator_id;
  if not found then
    raise exception using errcode = '23503', message = 'Operation audit actor does not exist';
  end if;

  insert into public.operation_logs (
    operator_id, operator_name, module_code, operation_type,
    request_method, request_path, request_params, operation_result
  ) values (
    p_operator_id, operator_name_snapshot, trim(p_module_code), trim(p_operation_type),
    upper(trim(p_request_method)), trim(p_request_path), p_request_params, 1
  );
  return true;
end;
$$;


ALTER FUNCTION "public"."record_operation_event"("p_operator_id" bigint, "p_module_code" "text", "p_operation_type" "text", "p_request_method" "text", "p_request_path" "text", "p_request_params" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_operation_event"("p_operator_id" bigint, "p_module_code" "text", "p_operation_type" "text", "p_request_method" "text", "p_request_path" "text", "p_request_params" "jsonb") IS 'Service-role-only writer for minimal, redacted operations performed by trusted Edge Functions.';



CREATE OR REPLACE FUNCTION "public"."register_account_password_session"("p_session_id" "uuid", "p_auth_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."register_account_password_session"("p_session_id" "uuid", "p_auth_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_dictionary_item_order"("p_dict_type_id" "text", "p_items" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  target_type_id bigint;
  actor_id bigint;
  requested_count integer;
begin
  perform app_private.require_configuration_permission('configuration.dictionaries.update');
  if coalesce(p_dict_type_id, '') !~ '^[1-9][0-9]*$'
    or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Dictionary item order input is invalid';
  end if;
  if p_dict_type_id::numeric > 9223372036854775807
    or jsonb_array_length(p_items) > 500 then
    raise exception using errcode = '22023', message = 'Dictionary item order input is invalid';
  end if;
  target_type_id := p_dict_type_id::bigint;
  perform dictionary_type.id
  from public.dict_types as dictionary_type
  where dictionary_type.id = target_type_id and dictionary_type.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Dictionary type was not found';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as requested(id text, "sortOrder" integer)
    where coalesce(requested.id, '') !~ '^[1-9][0-9]*$'
      or case
        when requested.id ~ '^[1-9][0-9]*$'
          then requested.id::numeric > 9223372036854775807
        else false
      end
      or requested."sortOrder" is null or requested."sortOrder" < 0
  ) or (
    select count(distinct requested.id)::integer
    from jsonb_to_recordset(p_items) as requested(id text, "sortOrder" integer)
  ) <> jsonb_array_length(p_items) then
    raise exception using errcode = '22023', message = 'Dictionary item order rows are invalid or duplicated';
  end if;

  select count(*)::integer into requested_count
  from jsonb_to_recordset(p_items) as requested(id text, "sortOrder" integer);
  if requested_count <> (
    select count(*)::integer from public.dict_items as dictionary_item
    where dictionary_item.dict_type_id = target_type_id and dictionary_item.deleted_at is null
  ) or exists (
    select 1
    from jsonb_to_recordset(p_items) as requested(id text, "sortOrder" integer)
    left join public.dict_items as dictionary_item
      on dictionary_item.id = requested.id::bigint
     and dictionary_item.dict_type_id = target_type_id
     and dictionary_item.deleted_at is null
    where dictionary_item.id is null
  ) then
    raise exception using errcode = '23514', message = 'Order replacement must include every active dictionary item of this type';
  end if;

  select profile.id into actor_id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.is_active
    and profile.deleted_at is null;
  update public.dict_items as dictionary_item
  set sort_order = requested."sortOrder",
      updated_by = actor_id
  from jsonb_to_recordset(p_items) as requested(id text, "sortOrder" integer)
  where dictionary_item.id = requested.id::bigint
    and dictionary_item.dict_type_id = target_type_id
    and dictionary_item.deleted_at is null;
end;
$_$;


ALTER FUNCTION "public"."replace_dictionary_item_order"("p_dict_type_id" "text", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_menu_role_authorization"("p_menu_id" bigint, "p_role_ids" bigint[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."replace_menu_role_authorization"("p_menu_id" bigint, "p_role_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_role_authorization"("p_role_id" bigint, "p_menu_permission_keys" "text"[], "p_action_permission_keys" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."replace_role_authorization"("p_role_id" bigint, "p_menu_permission_keys" "text"[], "p_action_permission_keys" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_role_permissions"("p_role_id" bigint, "p_permission_keys" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."replace_role_permissions"("p_role_id" bigint, "p_permission_keys" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_login_identity"("p_login_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."resolve_login_identity"("p_login_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_login_identity"("p_login_name" "text") IS 'Server-only mapping for Supabase Edge Auth flows; returns only verified, active profiles.';



CREATE OR REPLACE FUNCTION "public"."revoke_account_password_session"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;


ALTER FUNCTION "public"."revoke_account_password_session"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rollback_managed_user_create"("p_auth_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.profiles as profile
  where profile.auth_user_id = p_auth_user_id;
  return found;
end;
$$;


ALTER FUNCTION "public"."rollback_managed_user_create"("p_auth_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_admin_menu"("p_menu_id" "text", "p_parent_id" "text", "p_kind" "text", "p_route_key" "text", "p_path" "text", "p_title" "text", "p_icon" "text", "p_sort_order" integer, "p_is_visible" boolean, "p_is_active" boolean, "p_required_permission_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;


ALTER FUNCTION "public"."save_admin_menu"("p_menu_id" "text", "p_parent_id" "text", "p_kind" "text", "p_route_key" "text", "p_path" "text", "p_title" "text", "p_icon" "text", "p_sort_order" integer, "p_is_visible" boolean, "p_is_active" boolean, "p_required_permission_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_admin_role"("p_role_id" "text", "p_code" "text", "p_name" "text", "p_description" "text", "p_is_active" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;


ALTER FUNCTION "public"."save_admin_role"("p_role_id" "text", "p_code" "text", "p_name" "text", "p_description" "text", "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_dictionary_item"("p_id" "text", "p_dict_type_id" "text", "p_item_value" "text", "p_item_label" "text", "p_sort_order" integer, "p_status" smallint, "p_description" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  target_id bigint;
  target_type_id bigint;
  existing_type_id bigint;
  actor_id bigint;
begin
  if coalesce(p_dict_type_id, '') !~ '^[1-9][0-9]*$'
    or nullif(trim(p_item_value), '') is null or length(trim(p_item_value)) > 64
    or nullif(trim(p_item_label), '') is null or length(trim(p_item_label)) > 128
    or p_sort_order is null or p_sort_order < -2147483648
    or p_status is null or p_status not in (0, 1)
    or coalesce(length(trim(p_description)), 0) > 255 then
    raise exception using errcode = '22023', message = 'Dictionary item fields are invalid';
  end if;
  if p_dict_type_id::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Dictionary type ID is invalid';
  end if;
  target_type_id := p_dict_type_id::bigint;
  perform dictionary_type.id
  from public.dict_types as dictionary_type
  where dictionary_type.id = target_type_id and dictionary_type.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Dictionary type was not found';
  end if;

  if p_id is null then
    perform app_private.require_configuration_permission('configuration.dictionaries.create');
  else
    perform app_private.require_configuration_permission('configuration.dictionaries.update');
    if p_id !~ '^[1-9][0-9]*$' then
      raise exception using errcode = '22023', message = 'Dictionary item ID is invalid';
    end if;
    if p_id::numeric > 9223372036854775807 then
      raise exception using errcode = '22023', message = 'Dictionary item ID is invalid';
    end if;
    target_id := p_id::bigint;
    select dictionary_item.dict_type_id into existing_type_id
    from public.dict_items as dictionary_item
    where dictionary_item.id = target_id and dictionary_item.deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Dictionary item was not found';
    end if;
    if existing_type_id <> target_type_id then
      raise exception using errcode = '23514', message = 'Dictionary item cannot move between types';
    end if;
  end if;

  select profile.id into actor_id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.is_active
    and profile.deleted_at is null;

  if p_id is null then
    insert into public.dict_items (
      dict_type_id, item_value, item_label, sort_order, status, description, created_by, updated_by
    ) values (
      target_type_id, trim(p_item_value), trim(p_item_label), p_sort_order, p_status,
      nullif(trim(p_description), ''), actor_id, actor_id
    ) returning id into target_id;
  else
    update public.dict_items as dictionary_item
    set item_value = trim(p_item_value),
        item_label = trim(p_item_label),
        sort_order = p_sort_order,
        status = p_status,
        description = nullif(trim(p_description), ''),
        updated_by = actor_id
    where dictionary_item.id = target_id
      and dictionary_item.dict_type_id = target_type_id
      and dictionary_item.deleted_at is null;
  end if;
  return app_private.dictionary_item_read_model(target_id);
end;
$_$;


ALTER FUNCTION "public"."save_dictionary_item"("p_id" "text", "p_dict_type_id" "text", "p_item_value" "text", "p_item_label" "text", "p_sort_order" integer, "p_status" smallint, "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_dictionary_type"("p_id" "text", "p_dict_code" "text", "p_dict_name" "text", "p_status" smallint, "p_description" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  target_id bigint;
  actor_id bigint;
begin
  if nullif(trim(p_dict_code), '') is null or length(trim(p_dict_code)) > 64
    or nullif(trim(p_dict_name), '') is null or length(trim(p_dict_name)) > 128
    or coalesce(length(trim(p_description)), 0) > 255
    or p_status is null or p_status not in (0, 1) then
    raise exception using errcode = '22023', message = 'Dictionary type fields are invalid';
  end if;
  if p_id is null then
    perform app_private.require_configuration_permission('configuration.dictionaries.create');
  else
    perform app_private.require_configuration_permission('configuration.dictionaries.update');
    if p_id !~ '^[1-9][0-9]*$' then
      raise exception using errcode = '22023', message = 'Dictionary type ID is invalid';
    end if;
    if p_id::numeric > 9223372036854775807 then
      raise exception using errcode = '22023', message = 'Dictionary type ID is invalid';
    end if;
    target_id := p_id::bigint;
    perform dictionary_type.id
    from public.dict_types as dictionary_type
    where dictionary_type.id = target_id and dictionary_type.deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Dictionary type was not found';
    end if;
  end if;
  select profile.id into actor_id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.is_active
    and profile.deleted_at is null;

  if p_id is null then
    insert into public.dict_types (dict_code, dict_name, status, description, created_by, updated_by)
    values (trim(p_dict_code), trim(p_dict_name), p_status, nullif(trim(p_description), ''), actor_id, actor_id)
    returning id into target_id;
  else
    update public.dict_types as dictionary_type
    set dict_code = trim(p_dict_code),
        dict_name = trim(p_dict_name),
        status = p_status,
        description = nullif(trim(p_description), ''),
        updated_by = actor_id
    where dictionary_type.id = target_id and dictionary_type.deleted_at is null;
  end if;
  return app_private.dictionary_type_read_model(target_id);
end;
$_$;


ALTER FUNCTION "public"."save_dictionary_type"("p_id" "text", "p_dict_code" "text", "p_dict_name" "text", "p_status" smallint, "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_system_configuration"("p_id" "text", "p_config_code" "text", "p_config_name" "text", "p_config_value" "text", "p_value_type" "text", "p_status" smallint, "p_description" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  target_id bigint;
  normalized_value_type text;
  actor_id bigint;
begin
  perform app_private.require_configuration_permission('configuration.system.update');
  if nullif(trim(p_config_code), '') is null or length(trim(p_config_code)) > 64
    or nullif(trim(p_config_name), '') is null or length(trim(p_config_name)) > 128
    or nullif(trim(p_config_value), '') is null
    or coalesce(length(trim(p_description)), 0) > 255
    or p_status is null or p_status not in (0, 1) then
    raise exception using errcode = '22023', message = 'Configuration fields are invalid';
  end if;
  normalized_value_type := upper(trim(coalesce(p_value_type, 'STRING')));
  if normalized_value_type not in ('STRING', 'NUMBER', 'BOOLEAN', 'JSON') then
    normalized_value_type := 'STRING';
  end if;

  if p_id is not null then
    if p_id !~ '^[1-9][0-9]*$' then
      raise exception using errcode = '22023', message = 'Configuration ID is invalid';
    end if;
    if p_id::numeric > 9223372036854775807 then
      raise exception using errcode = '22023', message = 'Configuration ID is invalid';
    end if;
    target_id := p_id::bigint;
    perform config.id
    from public.system_configs as config
    where config.id = target_id and config.deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Configuration was not found';
    end if;
  end if;
  select profile.id into actor_id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.is_active
    and profile.deleted_at is null;

  if p_id is null then
    insert into public.system_configs (
      config_code, config_name, config_value, value_type, status, description, created_by, updated_by
    ) values (
      trim(p_config_code), trim(p_config_name), trim(p_config_value), normalized_value_type,
      p_status, nullif(trim(p_description), ''), actor_id, actor_id
    ) returning id into target_id;
  else
    update public.system_configs as config
    set config_code = trim(p_config_code),
        config_name = trim(p_config_name),
        config_value = trim(p_config_value),
        value_type = normalized_value_type,
        status = p_status,
        description = nullif(trim(p_description), ''),
        updated_by = actor_id
    where config.id = target_id and config.deleted_at is null;
  end if;
  return app_private.system_config_read_model(target_id);
end;
$_$;


ALTER FUNCTION "public"."save_system_configuration"("p_id" "text", "p_config_code" "text", "p_config_name" "text", "p_config_value" "text", "p_value_type" "text", "p_status" smallint, "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_managed_user_active"("p_profile_id" bigint, "p_is_active" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."set_managed_user_active"("p_profile_id" bigint, "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."soft_delete_dictionary_item"("p_dict_item_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  target_item_id bigint;
  actor_id bigint;
begin
  perform app_private.require_configuration_permission('configuration.dictionaries.delete');
  if coalesce(p_dict_item_id, '') !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'Dictionary item ID is invalid';
  end if;
  if p_dict_item_id::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Dictionary item ID is invalid';
  end if;
  target_item_id := p_dict_item_id::bigint;
  select profile.id into actor_id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.is_active
    and profile.deleted_at is null;
  update public.dict_items as dictionary_item
  set deleted_at = now(), updated_by = actor_id
  where dictionary_item.id = target_item_id and dictionary_item.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'Dictionary item was not found';
  end if;
end;
$_$;


ALTER FUNCTION "public"."soft_delete_dictionary_item"("p_dict_item_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."soft_delete_dictionary_type"("p_dict_type_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  target_type_id bigint;
  actor_id bigint;
begin
  perform app_private.require_configuration_permission('configuration.dictionaries.delete');
  if coalesce(p_dict_type_id, '') !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'Dictionary type ID is invalid';
  end if;
  if p_dict_type_id::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Dictionary type ID is invalid';
  end if;
  target_type_id := p_dict_type_id::bigint;
  perform dictionary_type.id
  from public.dict_types as dictionary_type
  where dictionary_type.id = target_type_id and dictionary_type.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Dictionary type was not found';
  end if;
  if exists (
    select 1 from public.dict_items as dictionary_item
    where dictionary_item.dict_type_id = target_type_id
      and dictionary_item.status = 1
      and dictionary_item.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'Dictionary type contains active items';
  end if;
  select profile.id into actor_id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.is_active
    and profile.deleted_at is null;
  update public.dict_types as dictionary_type
  set deleted_at = now(), updated_by = actor_id
  where dictionary_type.id = target_type_id and dictionary_type.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'Dictionary type was not found';
  end if;
end;
$_$;


ALTER FUNCTION "public"."soft_delete_dictionary_type"("p_dict_type_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."soft_delete_managed_user"("p_profile_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."soft_delete_managed_user"("p_profile_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."soft_delete_system_configuration"("p_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  target_id bigint;
  actor_id bigint;
begin
  perform app_private.require_configuration_permission('configuration.system.update');
  if coalesce(p_id, '') !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'Configuration ID is invalid';
  end if;
  if p_id::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Configuration ID is invalid';
  end if;
  target_id := p_id::bigint;
  select profile.id into actor_id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.is_active
    and profile.deleted_at is null;
  update public.system_configs as config
  set deleted_at = now(), updated_by = actor_id
  where config.id = target_id and config.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'Configuration was not found';
  end if;
end;
$_$;


ALTER FUNCTION "public"."soft_delete_system_configuration"("p_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."system_configuration_value"("p_config_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  result jsonb;
begin
  perform app_private.require_configuration_permission('configuration.system.read');
  select jsonb_build_object(
    'configCode', config.config_code,
    'configValue', config.config_value,
    'valueType', config.value_type
  ) into result
  from public.system_configs as config
  where config.config_code collate app_private.legacy_utf8mb4_unicode_ci
      = trim(p_config_code) collate app_private.legacy_utf8mb4_unicode_ci
    and config.status = 1
    and config.deleted_at is null;
  if result is null then
    raise exception using errcode = 'P0002', message = 'Configuration was not found or is disabled';
  end if;
  return result;
end;
$$;


ALTER FUNCTION "public"."system_configuration_value"("p_config_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_managed_user_profile"("p_profile_id" bigint, "p_user_code" "text", "p_login_name" "text", "p_display_name" "text", "p_phone" "text", "p_department_id" bigint, "p_post_id" bigint, "p_role_ids" bigint[]) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."update_managed_user_profile"("p_profile_id" bigint, "p_user_code" "text", "p_login_name" "text", "p_display_name" "text", "p_phone" "text", "p_department_id" bigint, "p_post_id" bigint, "p_role_ids" bigint[]) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "app_private"."account_password_sessions" (
    "session_id" "uuid" NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "authorized_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);


ALTER TABLE "app_private"."account_password_sessions" OWNER TO "postgres";


COMMENT ON TABLE "app_private"."account_password_sessions" IS 'Server-only allowlist of Auth sessions created through login_name + password.';



CREATE TABLE IF NOT EXISTS "app_private"."password_reset_requests" (
    "auth_user_id" "uuid" NOT NULL,
    "password_hash_before_request" "text" NOT NULL,
    "requested_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "password_reset_requests_check" CHECK (("expires_at" > "requested_at"))
);


ALTER TABLE "app_private"."password_reset_requests" OWNER TO "postgres";


COMMENT ON TABLE "app_private"."password_reset_requests" IS 'Private one-time reset state. The saved Auth password hash is never exposed to clients.';



CREATE TABLE IF NOT EXISTS "public"."attachments" (
    "id" bigint NOT NULL,
    "original_name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "file_ext" "text" NOT NULL,
    "file_size" bigint NOT NULL,
    "business_module" "text",
    "business_record_id" bigint,
    "reference_status" smallint DEFAULT 0 NOT NULL,
    "upload_user_id" bigint NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" bigint,
    "updated_by" bigint,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "attachments_business_reference_pair" CHECK (((("business_module" IS NULL) AND ("business_record_id" IS NULL)) OR ((NULLIF(TRIM(BOTH FROM "business_module"), ''::"text") IS NOT NULL) AND ("business_record_id" > 0)))),
    CONSTRAINT "attachments_file_ext_check" CHECK ((("length"("file_ext") >= 1) AND ("length"("file_ext") <= 32))),
    CONSTRAINT "attachments_file_size_check" CHECK ((("file_size" >= 0) AND ("file_size" <= 20971520))),
    CONSTRAINT "attachments_mime_type_check" CHECK ((("length"("mime_type") >= 1) AND ("length"("mime_type") <= 128))),
    CONSTRAINT "attachments_original_name_check" CHECK (((("length"(TRIM(BOTH FROM "original_name")) >= 1) AND ("length"(TRIM(BOTH FROM "original_name")) <= 255)) AND ("original_name" !~ '[[:cntrl:]]'::"text"))),
    CONSTRAINT "attachments_reference_status_check" CHECK (("reference_status" = ANY (ARRAY[0, 1]))),
    CONSTRAINT "attachments_reference_status_matches_link" CHECK (("reference_status" =
CASE
    WHEN ("business_module" IS NULL) THEN 0
    ELSE 1
END)),
    CONSTRAINT "attachments_storage_path_check" CHECK (("length"("storage_path") <= 512))
);


ALTER TABLE "public"."attachments" OWNER TO "postgres";


COMMENT ON TABLE "public"."attachments" IS 'Private Storage metadata. All file access is checked by Storage RLS and module permissions.';



COMMENT ON COLUMN "public"."attachments"."storage_path" IS 'Opaque object key inside the private admin-attachments bucket; never a public URL.';



CREATE OR REPLACE VIEW "public"."attachment_read_model" WITH ("security_invoker"='true') AS
 SELECT ("id")::"text" AS "id",
    "original_name",
    "storage_path",
    "mime_type",
    "file_ext",
    "file_size",
    "business_module",
    ("business_record_id")::"text" AS "business_record_id",
    "reference_status",
    ("upload_user_id")::"text" AS "upload_user_id",
    "uploaded_at"
   FROM "public"."attachments"
  WHERE ("deleted_at" IS NULL);


ALTER VIEW "public"."attachment_read_model" OWNER TO "postgres";


ALTER TABLE "public"."attachments" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."attachments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."departments" (
    "id" bigint NOT NULL,
    "dept_code" "text" NOT NULL,
    "dept_name" "text" NOT NULL,
    "status" smallint DEFAULT 1 NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    CONSTRAINT "departments_dept_code_check" CHECK ((("dept_code" = "btrim"("dept_code")) AND (("length"("dept_code") >= 1) AND ("length"("dept_code") <= 64)))),
    CONSTRAINT "departments_dept_name_check" CHECK ((("dept_name" = "btrim"("dept_name")) AND (("length"("dept_name") >= 1) AND ("length"("dept_name") <= 128)))),
    CONSTRAINT "departments_description_check" CHECK ((("description" IS NULL) OR ("length"("description") <= 255))),
    CONSTRAINT "departments_status_check" CHECK (("status" = ANY (ARRAY[0, 1])))
);


ALTER TABLE "public"."departments" OWNER TO "postgres";


COMMENT ON TABLE "public"."departments" IS 'Department directory. BIGINT IDs retain the legacy users.dept_id mapping.';



CREATE OR REPLACE VIEW "public"."department_read_model" WITH ("security_invoker"='true') AS
 SELECT ("id")::"text" AS "id",
    "dept_code",
    "dept_name",
    "status",
    "description",
    "created_at",
    "updated_at"
   FROM "public"."departments" "department"
  WHERE (NOT "deleted");


ALTER VIEW "public"."department_read_model" OWNER TO "postgres";


ALTER TABLE "public"."departments" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."departments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."dict_items" (
    "id" bigint NOT NULL,
    "dict_type_id" bigint NOT NULL,
    "item_value" character varying(64) NOT NULL,
    "item_label" character varying(128) NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "status" smallint DEFAULT 1 NOT NULL,
    "description" character varying(255),
    "created_by" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" bigint,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "dict_items_item_label_check" CHECK ((("length"(TRIM(BOTH FROM "item_label")) >= 1) AND ("length"(TRIM(BOTH FROM "item_label")) <= 128))),
    CONSTRAINT "dict_items_item_value_check" CHECK ((("length"(TRIM(BOTH FROM "item_value")) >= 1) AND ("length"(TRIM(BOTH FROM "item_value")) <= 64))),
    CONSTRAINT "dict_items_status_check" CHECK (("status" = ANY (ARRAY[0, 1])))
);


ALTER TABLE "public"."dict_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."dict_items" IS 'Legacy dictionary values with per-type uniqueness, sortable order, status and soft deletion.';



ALTER TABLE "public"."dict_items" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."dict_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."dict_types" (
    "id" bigint NOT NULL,
    "dict_code" character varying(64) NOT NULL,
    "dict_name" character varying(128) NOT NULL,
    "status" smallint DEFAULT 1 NOT NULL,
    "description" character varying(255),
    "created_by" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" bigint,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "dict_types_code_not_blank" CHECK ((("length"(TRIM(BOTH FROM "dict_code")) >= 1) AND ("length"(TRIM(BOTH FROM "dict_code")) <= 64))),
    CONSTRAINT "dict_types_dict_name_check" CHECK ((("length"(TRIM(BOTH FROM "dict_name")) >= 1) AND ("length"(TRIM(BOTH FROM "dict_name")) <= 128))),
    CONSTRAINT "dict_types_status_check" CHECK (("status" = ANY (ARRAY[0, 1])))
);


ALTER TABLE "public"."dict_types" OWNER TO "postgres";


COMMENT ON TABLE "public"."dict_types" IS 'Legacy data dictionary types; status 0/1 and soft deletion preserve the Fastify module behavior.';



ALTER TABLE "public"."dict_types" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."dict_types_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."exception_logs" (
    "id" bigint NOT NULL,
    "request_path" "text" NOT NULL,
    "request_method" "text" NOT NULL,
    "error_type" "text" NOT NULL,
    "error_message" "text" NOT NULL,
    "stack_summary" "text",
    "handled_status" smallint DEFAULT 0 NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "exception_logs_error_type_check" CHECK ((("length"(TRIM(BOTH FROM "error_type")) >= 1) AND ("length"(TRIM(BOTH FROM "error_type")) <= 128))),
    CONSTRAINT "exception_logs_handled_status_check" CHECK (("handled_status" = ANY (ARRAY[0, 1]))),
    CONSTRAINT "exception_logs_request_method_check" CHECK ((("length"(TRIM(BOTH FROM "request_method")) >= 1) AND ("length"(TRIM(BOTH FROM "request_method")) <= 16))),
    CONSTRAINT "exception_logs_request_path_check" CHECK ((("length"(TRIM(BOTH FROM "request_path")) >= 1) AND ("length"(TRIM(BOTH FROM "request_path")) <= 255)))
);


ALTER TABLE "public"."exception_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."exception_logs" IS 'Sanitized server-side failures; stack summaries must not contain credentials or request secrets.';



CREATE OR REPLACE VIEW "public"."exception_log_read_model" WITH ("security_invoker"='true') AS
 SELECT ("id")::"text" AS "id",
    "request_path",
    "request_method",
    "error_type",
    "error_message",
    "stack_summary",
    "handled_status",
    "occurred_at"
   FROM "public"."exception_logs";


ALTER VIEW "public"."exception_log_read_model" OWNER TO "postgres";


ALTER TABLE "public"."exception_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."exception_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."login_logs" (
    "id" bigint NOT NULL,
    "user_id" bigint,
    "login_name" "text" NOT NULL,
    "login_ip" "text",
    "user_agent" "text",
    "login_result" smallint NOT NULL,
    "failure_reason" "text",
    "logged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "login_logs_failure_reason_check" CHECK ((("failure_reason" IS NULL) OR ("length"("failure_reason") <= 255))),
    CONSTRAINT "login_logs_login_ip_check" CHECK ((("login_ip" IS NULL) OR ("length"("login_ip") <= 64))),
    CONSTRAINT "login_logs_login_name_check" CHECK ((("length"(TRIM(BOTH FROM "login_name")) >= 1) AND ("length"(TRIM(BOTH FROM "login_name")) <= 64))),
    CONSTRAINT "login_logs_login_result_check" CHECK (("login_result" = ANY (ARRAY[0, 1]))),
    CONSTRAINT "login_logs_user_agent_check" CHECK ((("user_agent" IS NULL) OR ("length"("user_agent") <= 512)))
);


ALTER TABLE "public"."login_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."login_logs" IS 'Account/password login attempts; passwords and tokens are never stored.';



CREATE OR REPLACE VIEW "public"."login_log_read_model" WITH ("security_invoker"='true') AS
 SELECT ("id")::"text" AS "id",
    ("user_id")::"text" AS "user_id",
    "login_name",
    "login_ip",
    "user_agent",
    "login_result",
    "failure_reason",
    "logged_at"
   FROM "public"."login_logs";


ALTER VIEW "public"."login_log_read_model" OWNER TO "postgres";


ALTER TABLE "public"."login_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."login_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."menus" (
    "id" bigint NOT NULL,
    "parent_id" bigint,
    "kind" "text" NOT NULL,
    "route_key" "text",
    "path" "text" NOT NULL,
    "title" "text" NOT NULL,
    "icon" "text",
    "sort_order" integer NOT NULL,
    "is_visible" boolean DEFAULT true NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "required_permission_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "menus_icon_check" CHECK ((("icon" IS NULL) OR ("length"("icon") <= 128))),
    CONSTRAINT "menus_kind_check" CHECK (("kind" = ANY (ARRAY['group'::"text", 'route'::"text"]))),
    CONSTRAINT "menus_kind_route_contract" CHECK (((("kind" = 'group'::"text") AND ("route_key" IS NULL) AND ("required_permission_key" IS NULL)) OR (("kind" = 'route'::"text") AND ("route_key" IS NOT NULL) AND ("required_permission_key" IS NOT NULL)))),
    CONSTRAINT "menus_path_check" CHECK ((("path" = '/'::"text") OR ("path" ~ '^(/[A-Za-z0-9_:-]+)+/?$'::"text"))),
    CONSTRAINT "menus_route_key_registry" CHECK ((("route_key" IS NULL) OR ("route_key" = ANY (ARRAY['dashboard.overview'::"text", 'account.profile'::"text", 'account.change-password'::"text", 'communication.messages'::"text", 'operation.attachments'::"text", 'administration.users'::"text", 'administration.roles'::"text", 'administration.menus'::"text", 'administration.departments'::"text", 'administration.posts'::"text", 'administration.dictionaries'::"text", 'administration.configurations'::"text", 'audit.login-logs'::"text", 'audit.operation-logs'::"text", 'audit.exception-logs'::"text"])))),
    CONSTRAINT "menus_sort_order_check" CHECK ((("sort_order" >= 0) AND ("sort_order" <= 100000))),
    CONSTRAINT "menus_title_check" CHECK ((("length"(TRIM(BOTH FROM "title")) >= 1) AND ("length"(TRIM(BOTH FROM "title")) <= 128)))
);


ALTER TABLE "public"."menus" OWNER TO "postgres";


COMMENT ON TABLE "public"."menus" IS 'Navigation metadata referencing only a closed frontend route registry; it never stores executable component paths.';



COMMENT ON COLUMN "public"."menus"."route_key" IS 'Stable key from frontend/src/features/menus/menu-routes.registry.ts; not a server module path.';



CREATE OR REPLACE VIEW "public"."menu_management_read_model" WITH ("security_invoker"='true') AS
 SELECT ("id")::"text" AS "id",
    ("parent_id")::"text" AS "parent_id",
    "kind",
    "route_key",
    "path",
    "title",
    "icon",
    "sort_order",
    "is_visible",
    "is_active",
    "required_permission_key",
    "created_at",
    "updated_at"
   FROM "public"."menus" "menu";


ALTER VIEW "public"."menu_management_read_model" OWNER TO "postgres";


ALTER TABLE "public"."menus" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."menus_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" bigint NOT NULL,
    "receiver_id" bigint NOT NULL,
    "sender_id" bigint,
    "title" "text" NOT NULL,
    "summary" "text",
    "content" "text" NOT NULL,
    "message_type" "text" DEFAULT 'NOTICE'::"text" NOT NULL,
    "read_status" boolean DEFAULT false NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone,
    "created_by" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" bigint,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    CONSTRAINT "messages_message_type_check" CHECK ((("length"(TRIM(BOTH FROM "message_type")) >= 1) AND ("length"(TRIM(BOTH FROM "message_type")) <= 32))),
    CONSTRAINT "messages_summary_check" CHECK ((("summary" IS NULL) OR ("length"("summary") <= 255))),
    CONSTRAINT "messages_title_check" CHECK ((("length"(TRIM(BOTH FROM "title")) >= 1) AND ("length"(TRIM(BOTH FROM "title")) <= 128)))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


COMMENT ON TABLE "public"."messages" IS 'User inbox. Recipients may read their own messages and update only their read state.';



CREATE OR REPLACE VIEW "public"."message_read_model" WITH ("security_invoker"='true') AS
 SELECT ("id")::"text" AS "id",
    ("receiver_id")::"text" AS "receiver_id",
    ("sender_id")::"text" AS "sender_id",
    "title",
    "summary",
    "content",
    "message_type",
    "read_status",
    "sent_at",
    "read_at"
   FROM "public"."messages"
  WHERE (NOT "deleted");


ALTER VIEW "public"."message_read_model" OWNER TO "postgres";


ALTER TABLE "public"."messages" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."messages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."operation_logs" (
    "id" bigint NOT NULL,
    "operator_id" bigint,
    "operator_name" "text",
    "module_code" "text" NOT NULL,
    "operation_type" "text" NOT NULL,
    "request_method" "text" NOT NULL,
    "request_path" "text" NOT NULL,
    "request_params" "jsonb",
    "operation_result" smallint NOT NULL,
    "error_message" "text",
    "operated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "operation_logs_module_code_check" CHECK ((("length"(TRIM(BOTH FROM "module_code")) >= 1) AND ("length"(TRIM(BOTH FROM "module_code")) <= 64))),
    CONSTRAINT "operation_logs_operation_result_check" CHECK (("operation_result" = ANY (ARRAY[0, 1]))),
    CONSTRAINT "operation_logs_operation_type_check" CHECK ((("length"(TRIM(BOTH FROM "operation_type")) >= 1) AND ("length"(TRIM(BOTH FROM "operation_type")) <= 32))),
    CONSTRAINT "operation_logs_operator_name_check" CHECK ((("operator_name" IS NULL) OR ("length"("operator_name") <= 128))),
    CONSTRAINT "operation_logs_request_method_check" CHECK ((("length"(TRIM(BOTH FROM "request_method")) >= 1) AND ("length"(TRIM(BOTH FROM "request_method")) <= 16))),
    CONSTRAINT "operation_logs_request_path_check" CHECK ((("length"(TRIM(BOTH FROM "request_path")) >= 1) AND ("length"(TRIM(BOTH FROM "request_path")) <= 255)))
);


ALTER TABLE "public"."operation_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."operation_logs" IS 'Successful mutations performed by registered password sessions and authorized server actions.';



CREATE OR REPLACE VIEW "public"."operation_log_read_model" WITH ("security_invoker"='true') AS
 SELECT ("id")::"text" AS "id",
    ("operator_id")::"text" AS "operator_id",
    "operator_name",
    "module_code",
    "operation_type",
    "request_method",
    "request_path",
    "request_params",
    "operation_result",
    "error_message",
    "operated_at"
   FROM "public"."operation_logs";


ALTER VIEW "public"."operation_log_read_model" OWNER TO "postgres";


ALTER TABLE "public"."operation_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."operation_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."permission_catalog" (
    "permission_key" "text" NOT NULL,
    "description" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "permission_catalog_permission_key_check" CHECK (("permission_key" ~ '^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$'::"text"))
);


ALTER TABLE "public"."permission_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."posts" (
    "id" bigint NOT NULL,
    "post_code" "text" NOT NULL,
    "post_name" "text" NOT NULL,
    "status" smallint DEFAULT 1 NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    CONSTRAINT "posts_description_check" CHECK ((("description" IS NULL) OR ("length"("description") <= 255))),
    CONSTRAINT "posts_post_code_check" CHECK ((("post_code" = "btrim"("post_code")) AND (("length"("post_code") >= 1) AND ("length"("post_code") <= 64)))),
    CONSTRAINT "posts_post_name_check" CHECK ((("post_name" = "btrim"("post_name")) AND (("length"("post_name") >= 1) AND ("length"("post_name") <= 128)))),
    CONSTRAINT "posts_status_check" CHECK (("status" = ANY (ARRAY[0, 1])))
);


ALTER TABLE "public"."posts" OWNER TO "postgres";


COMMENT ON TABLE "public"."posts" IS 'Post directory. BIGINT IDs retain the legacy users.post_id mapping.';



CREATE OR REPLACE VIEW "public"."post_read_model" WITH ("security_invoker"='true') AS
 SELECT ("id")::"text" AS "id",
    "post_code",
    "post_name",
    "status",
    "description",
    "created_at",
    "updated_at"
   FROM "public"."posts" "post"
  WHERE (NOT "deleted");


ALTER VIEW "public"."post_read_model" OWNER TO "postgres";


ALTER TABLE "public"."posts" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."posts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" bigint NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "login_name" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "avatar_url" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "must_reset_password" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "password_reset_requested_at" timestamp with time zone,
    "user_code" "text",
    "department_id" bigint,
    "post_id" bigint,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "profiles_display_name_check" CHECK ((("length"(TRIM(BOTH FROM "display_name")) >= 1) AND ("length"(TRIM(BOTH FROM "display_name")) <= 128))),
    CONSTRAINT "profiles_email_check" CHECK ((("length"(TRIM(BOTH FROM "email")) >= 3) AND ("length"(TRIM(BOTH FROM "email")) <= 320))),
    CONSTRAINT "profiles_login_name_check" CHECK ((("length"(TRIM(BOTH FROM "login_name")) >= 1) AND ("length"(TRIM(BOTH FROM "login_name")) <= 64)))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'Business identity. id remains BIGINT; auth_user_id maps to Supabase Auth UUID.';



COMMENT ON COLUMN "public"."profiles"."auth_user_id" IS 'Required mapping from the business profile to its Supabase Auth identity.';



COMMENT ON COLUMN "public"."profiles"."password_reset_requested_at" IS 'Server-recorded time of the latest reset request; cleared after its password update is confirmed.';



COMMENT ON COLUMN "public"."profiles"."user_code" IS 'Optional business user code; new template administrators use their login name.';



COMMENT ON COLUMN "public"."profiles"."department_id" IS 'Legacy-compatible department BIGINT; source rows are imported before FK validation.';



COMMENT ON COLUMN "public"."profiles"."post_id" IS 'Legacy-compatible post BIGINT; source rows are imported before FK validation.';



COMMENT ON COLUMN "public"."profiles"."deleted_at" IS 'Soft deletion timestamp for user administration; deleted identities cannot sign in.';



ALTER TABLE "public"."profiles" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."profiles_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "role_id" bigint NOT NULL,
    "permission_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" bigint NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_system" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "roles_code_check" CHECK (("code" ~ '^[A-Z][A-Z0-9_]{1,63}$'::"text")),
    CONSTRAINT "roles_name_check" CHECK ((("length"(TRIM(BOTH FROM "name")) >= 1) AND ("length"(TRIM(BOTH FROM "name")) <= 128)))
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


ALTER TABLE "public"."roles" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."roles_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."system_configs" (
    "id" bigint NOT NULL,
    "config_code" character varying(64) NOT NULL,
    "config_name" character varying(128) NOT NULL,
    "config_value" "text" NOT NULL,
    "value_type" character varying(32) DEFAULT 'STRING'::character varying NOT NULL,
    "status" smallint DEFAULT 1 NOT NULL,
    "description" character varying(255),
    "created_by" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" bigint,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "system_configs_code_not_blank" CHECK ((("length"(TRIM(BOTH FROM "config_code")) >= 1) AND ("length"(TRIM(BOTH FROM "config_code")) <= 64))),
    CONSTRAINT "system_configs_config_name_check" CHECK ((("length"(TRIM(BOTH FROM "config_name")) >= 1) AND ("length"(TRIM(BOTH FROM "config_name")) <= 128))),
    CONSTRAINT "system_configs_status_check" CHECK (("status" = ANY (ARRAY[0, 1]))),
    CONSTRAINT "system_configs_value_type_check" CHECK ((("value_type")::"text" = ANY ((ARRAY['STRING'::character varying, 'NUMBER'::character varying, 'BOOLEAN'::character varying, 'JSON'::character varying])::"text"[])))
);


ALTER TABLE "public"."system_configs" OWNER TO "postgres";


COMMENT ON TABLE "public"."system_configs" IS 'Legacy application settings only. Deployment credentials and Supabase keys belong in local/server secret configuration, not this table.';



ALTER TABLE "public"."system_configs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."system_configs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE OR REPLACE VIEW "public"."user_management_read_model" AS
SELECT
    NULL::"text" AS "id",
    NULL::"uuid" AS "auth_user_id",
    NULL::"text" AS "user_code",
    NULL::"text" AS "login_name",
    NULL::"text" AS "display_name",
    NULL::"text" AS "email",
    NULL::"text" AS "phone",
    NULL::"text" AS "department_id",
    NULL::"text" AS "post_id",
    NULL::boolean AS "is_active",
    NULL::timestamp with time zone AS "deleted_at",
    NULL::timestamp with time zone AS "created_at",
    NULL::timestamp with time zone AS "updated_at",
    NULL::"jsonb" AS "roles";


ALTER VIEW "public"."user_management_read_model" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_management_role_options" WITH ("security_invoker"='true') AS
 SELECT ("id")::"text" AS "id",
    "code",
    "name"
   FROM "public"."roles"
  WHERE "is_active";


ALTER VIEW "public"."user_management_role_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "user_id" bigint NOT NULL,
    "role_id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


ALTER TABLE ONLY "app_private"."account_password_sessions"
    ADD CONSTRAINT "account_password_sessions_pkey" PRIMARY KEY ("session_id");



ALTER TABLE ONLY "app_private"."password_reset_requests"
    ADD CONSTRAINT "password_reset_requests_pkey" PRIMARY KEY ("auth_user_id");



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_storage_path_key" UNIQUE ("storage_path");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dict_items"
    ADD CONSTRAINT "dict_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dict_types"
    ADD CONSTRAINT "dict_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exception_logs"
    ADD CONSTRAINT "exception_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."login_logs"
    ADD CONSTRAINT "login_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menus"
    ADD CONSTRAINT "menus_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."operation_logs"
    ADD CONSTRAINT "operation_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permission_catalog"
    ADD CONSTRAINT "permission_catalog_pkey" PRIMARY KEY ("permission_key");



ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_key");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_configs"
    ADD CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role_id");



CREATE INDEX "account_password_sessions_auth_user_id_idx" ON "app_private"."account_password_sessions" USING "btree" ("auth_user_id");



CREATE INDEX "attachments_active_uploaded_idx" ON "public"."attachments" USING "btree" ("uploaded_at" DESC, "id" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "attachments_business_active_idx" ON "public"."attachments" USING "btree" ("business_module", "business_record_id", "uploaded_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "attachments_uploader_uploaded_idx" ON "public"."attachments" USING "btree" ("upload_user_id", "uploaded_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "departments_dept_code_lower_uidx" ON "public"."departments" USING "btree" ("lower"("dept_code"));



CREATE INDEX "departments_status_deleted_idx" ON "public"."departments" USING "btree" ("status", "deleted", "id");



CREATE UNIQUE INDEX "dict_items_active_type_value_uidx" ON "public"."dict_items" USING "btree" ("dict_type_id", "item_value" COLLATE "app_private"."legacy_utf8mb4_unicode_ci") WHERE ("deleted_at" IS NULL);



CREATE INDEX "dict_items_created_by_idx" ON "public"."dict_items" USING "btree" ("created_by");



CREATE INDEX "dict_items_type_status_sort_idx" ON "public"."dict_items" USING "btree" ("dict_type_id", "status", "sort_order", "id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "dict_items_updated_by_idx" ON "public"."dict_items" USING "btree" ("updated_by");



CREATE UNIQUE INDEX "dict_types_code_legacy_ci_uidx" ON "public"."dict_types" USING "btree" ("dict_code" COLLATE "app_private"."legacy_utf8mb4_unicode_ci");



CREATE INDEX "dict_types_created_by_idx" ON "public"."dict_types" USING "btree" ("created_by");



CREATE INDEX "dict_types_status_deleted_idx" ON "public"."dict_types" USING "btree" ("status", "deleted_at", "id");



CREATE INDEX "dict_types_updated_by_idx" ON "public"."dict_types" USING "btree" ("updated_by");



CREATE INDEX "exception_logs_handled_recent_idx" ON "public"."exception_logs" USING "btree" ("handled_status", "occurred_at" DESC);



CREATE INDEX "exception_logs_recent_idx" ON "public"."exception_logs" USING "btree" ("occurred_at" DESC, "id" DESC);



CREATE INDEX "login_logs_name_recent_idx" ON "public"."login_logs" USING "btree" ("lower"("login_name"), "logged_at" DESC);



CREATE INDEX "login_logs_recent_idx" ON "public"."login_logs" USING "btree" ("logged_at" DESC, "id" DESC);



CREATE INDEX "menus_parent_sort_idx" ON "public"."menus" USING "btree" ("parent_id", "sort_order", "title");



CREATE UNIQUE INDEX "menus_path_lower_uidx" ON "public"."menus" USING "btree" ("lower"("path"));



CREATE INDEX "menus_permission_idx" ON "public"."menus" USING "btree" ("required_permission_key") WHERE ("required_permission_key" IS NOT NULL);



CREATE UNIQUE INDEX "menus_route_key_uidx" ON "public"."menus" USING "btree" ("route_key") WHERE ("route_key" IS NOT NULL);



CREATE INDEX "messages_created_by_idx" ON "public"."messages" USING "btree" ("created_by");



CREATE INDEX "messages_receiver_sent_idx" ON "public"."messages" USING "btree" ("receiver_id", "sent_at" DESC, "id" DESC) WHERE ("deleted" = false);



CREATE INDEX "messages_receiver_unread_sent_idx" ON "public"."messages" USING "btree" ("receiver_id", "sent_at" DESC, "id" DESC) WHERE (("read_status" = false) AND ("deleted" = false));



CREATE INDEX "messages_sender_id_idx" ON "public"."messages" USING "btree" ("sender_id");



CREATE INDEX "messages_updated_by_idx" ON "public"."messages" USING "btree" ("updated_by");



CREATE INDEX "operation_logs_module_recent_idx" ON "public"."operation_logs" USING "btree" ("module_code", "operation_type", "operated_at" DESC);



CREATE INDEX "operation_logs_operator_recent_idx" ON "public"."operation_logs" USING "btree" ("operator_id", "operated_at" DESC);



CREATE INDEX "operation_logs_recent_idx" ON "public"."operation_logs" USING "btree" ("operated_at" DESC, "id" DESC);



CREATE UNIQUE INDEX "posts_post_code_lower_uidx" ON "public"."posts" USING "btree" ("lower"("post_code"));



CREATE INDEX "posts_status_deleted_idx" ON "public"."posts" USING "btree" ("status", "deleted", "id");



CREATE INDEX "profiles_active_deleted_idx" ON "public"."profiles" USING "btree" ("is_active", "deleted_at");



CREATE INDEX "profiles_department_id_idx" ON "public"."profiles" USING "btree" ("department_id");



CREATE UNIQUE INDEX "profiles_email_lower_uidx" ON "public"."profiles" USING "btree" ("lower"("email"));



CREATE UNIQUE INDEX "profiles_login_name_lower_uidx" ON "public"."profiles" USING "btree" ("lower"("login_name"));



CREATE INDEX "profiles_post_id_idx" ON "public"."profiles" USING "btree" ("post_id");



CREATE UNIQUE INDEX "profiles_user_code_lower_uidx" ON "public"."profiles" USING "btree" ("lower"("user_code")) WHERE ("user_code" IS NOT NULL);



CREATE INDEX "role_permissions_permission_key_idx" ON "public"."role_permissions" USING "btree" ("permission_key", "role_id");



CREATE UNIQUE INDEX "system_configs_code_legacy_ci_uidx" ON "public"."system_configs" USING "btree" ("config_code" COLLATE "app_private"."legacy_utf8mb4_unicode_ci");



CREATE INDEX "system_configs_created_by_idx" ON "public"."system_configs" USING "btree" ("created_by");



CREATE INDEX "system_configs_status_deleted_idx" ON "public"."system_configs" USING "btree" ("status", "deleted_at", "id");



CREATE INDEX "system_configs_updated_by_idx" ON "public"."system_configs" USING "btree" ("updated_by");



CREATE INDEX "user_roles_role_id_idx" ON "public"."user_roles" USING "btree" ("role_id", "user_id");



CREATE OR REPLACE VIEW "public"."user_management_read_model" WITH ("security_invoker"='true') AS
 SELECT ("profile"."id")::"text" AS "id",
    "profile"."auth_user_id",
    "profile"."user_code",
    "profile"."login_name",
    "profile"."display_name",
    "profile"."email",
    "profile"."phone",
    ("profile"."department_id")::"text" AS "department_id",
    ("profile"."post_id")::"text" AS "post_id",
    "profile"."is_active",
    "profile"."deleted_at",
    "profile"."created_at",
    "profile"."updated_at",
    COALESCE("jsonb_agg"("jsonb_build_object"('id', ("role"."id")::"text", 'code', "role"."code", 'name', "role"."name", 'isActive', "role"."is_active") ORDER BY "role"."name", "role"."code") FILTER (WHERE ("role"."id" IS NOT NULL)), '[]'::"jsonb") AS "roles"
   FROM (("public"."profiles" "profile"
     LEFT JOIN "public"."user_roles" "user_role" ON (("user_role"."user_id" = "profile"."id")))
     LEFT JOIN "public"."roles" "role" ON (("role"."id" = "user_role"."role_id")))
  GROUP BY "profile"."id";



CREATE OR REPLACE TRIGGER "audit_attachments_mutation" AFTER INSERT OR DELETE OR UPDATE ON "public"."attachments" FOR EACH ROW EXECUTE FUNCTION "app_private"."log_current_mutation"();



CREATE OR REPLACE TRIGGER "audit_departments_mutation" AFTER INSERT OR DELETE OR UPDATE ON "public"."departments" FOR EACH ROW EXECUTE FUNCTION "app_private"."log_current_mutation"();



CREATE OR REPLACE TRIGGER "audit_dict_items_mutation" AFTER INSERT OR DELETE OR UPDATE ON "public"."dict_items" FOR EACH ROW EXECUTE FUNCTION "app_private"."log_current_mutation"();



CREATE OR REPLACE TRIGGER "audit_dict_types_mutation" AFTER INSERT OR DELETE OR UPDATE ON "public"."dict_types" FOR EACH ROW EXECUTE FUNCTION "app_private"."log_current_mutation"();



CREATE OR REPLACE TRIGGER "audit_menus_mutation" AFTER INSERT OR DELETE OR UPDATE ON "public"."menus" FOR EACH ROW EXECUTE FUNCTION "app_private"."log_current_mutation"();



CREATE OR REPLACE TRIGGER "audit_messages_mutation" AFTER INSERT OR DELETE OR UPDATE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "app_private"."log_current_mutation"();



CREATE OR REPLACE TRIGGER "audit_posts_mutation" AFTER INSERT OR DELETE OR UPDATE ON "public"."posts" FOR EACH ROW EXECUTE FUNCTION "app_private"."log_current_mutation"();



CREATE OR REPLACE TRIGGER "audit_profiles_mutation" AFTER INSERT OR DELETE OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "app_private"."log_current_mutation"();



CREATE OR REPLACE TRIGGER "audit_role_permissions_mutation" AFTER INSERT OR DELETE OR UPDATE ON "public"."role_permissions" FOR EACH ROW EXECUTE FUNCTION "app_private"."log_current_mutation"();



CREATE OR REPLACE TRIGGER "audit_roles_mutation" AFTER INSERT OR DELETE OR UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "app_private"."log_current_mutation"();



CREATE OR REPLACE TRIGGER "audit_system_configs_mutation" AFTER INSERT OR DELETE OR UPDATE ON "public"."system_configs" FOR EACH ROW EXECUTE FUNCTION "app_private"."log_current_mutation"();



CREATE OR REPLACE TRIGGER "audit_user_roles_mutation" AFTER INSERT OR DELETE OR UPDATE ON "public"."user_roles" FOR EACH ROW EXECUTE FUNCTION "app_private"."log_current_mutation"();



CREATE OR REPLACE TRIGGER "departments_touch_updated_at" BEFORE UPDATE ON "public"."departments" FOR EACH ROW EXECUTE FUNCTION "app_private"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "dict_items_touch_updated_at" BEFORE UPDATE ON "public"."dict_items" FOR EACH ROW EXECUTE FUNCTION "app_private"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "dict_types_touch_updated_at" BEFORE UPDATE ON "public"."dict_types" FOR EACH ROW EXECUTE FUNCTION "app_private"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "menus_touch_updated_at" BEFORE UPDATE ON "public"."menus" FOR EACH ROW EXECUTE FUNCTION "app_private"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "messages_touch_updated_at" BEFORE UPDATE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "app_private"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "posts_touch_updated_at" BEFORE UPDATE ON "public"."posts" FOR EACH ROW EXECUTE FUNCTION "app_private"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_guard_organization_assignments" BEFORE INSERT OR UPDATE OF "department_id", "post_id" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "app_private"."guard_profile_organization_assignments"();



CREATE OR REPLACE TRIGGER "profiles_touch_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "app_private"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "roles_touch_updated_at" BEFORE UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "app_private"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "system_configs_touch_updated_at" BEFORE UPDATE ON "public"."system_configs" FOR EACH ROW EXECUTE FUNCTION "app_private"."touch_updated_at"();



ALTER TABLE ONLY "app_private"."account_password_sessions"
    ADD CONSTRAINT "account_password_sessions_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "app_private"."password_reset_requests"
    ADD CONSTRAINT "password_reset_requests_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_upload_user_id_fkey" FOREIGN KEY ("upload_user_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."dict_items"
    ADD CONSTRAINT "dict_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dict_items"
    ADD CONSTRAINT "dict_items_dict_type_id_fkey" FOREIGN KEY ("dict_type_id") REFERENCES "public"."dict_types"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."dict_items"
    ADD CONSTRAINT "dict_items_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dict_types"
    ADD CONSTRAINT "dict_types_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dict_types"
    ADD CONSTRAINT "dict_types_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."login_logs"
    ADD CONSTRAINT "login_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."menus"
    ADD CONSTRAINT "menus_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."menus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."menus"
    ADD CONSTRAINT "menus_required_permission_key_fkey" FOREIGN KEY ("required_permission_key") REFERENCES "public"."permission_catalog"("permission_key");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."operation_logs"
    ADD CONSTRAINT "operation_logs_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE RESTRICT NOT VALID;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE RESTRICT NOT VALID;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "public"."permission_catalog"("permission_key");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id");



ALTER TABLE ONLY "public"."system_configs"
    ADD CONSTRAINT "system_configs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."system_configs"
    ADD CONSTRAINT "system_configs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE "app_private"."account_password_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "app_private"."password_reset_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attachments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attachments_read_authorized" ON "public"."attachments" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND ( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('files.attachments.read'::"text") AS "has_permission")));



ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "departments_create" ON "public"."departments" FOR INSERT TO "authenticated" WITH CHECK (((NOT "deleted") AND ( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('organization.departments.create'::"text") AS "has_permission")));



CREATE POLICY "departments_read" ON "public"."departments" FOR SELECT TO "authenticated" USING (((NOT "deleted") AND ( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('organization.departments.read'::"text") AS "has_permission")));



CREATE POLICY "departments_update" ON "public"."departments" FOR UPDATE TO "authenticated" USING (((NOT "deleted") AND ( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('organization.departments.update'::"text") AS "has_permission"))) WITH CHECK (((NOT "deleted") AND ( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('organization.departments.update'::"text") AS "has_permission")));



ALTER TABLE "public"."dict_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dict_items_create_authorized" ON "public"."dict_items" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('configuration.dictionaries.create'::"text") AS "has_permission")));



CREATE POLICY "dict_items_read_authorized" ON "public"."dict_items" FOR SELECT TO "authenticated" USING ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('configuration.dictionaries.read'::"text") AS "has_permission")));



CREATE POLICY "dict_items_update_authorized" ON "public"."dict_items" FOR UPDATE TO "authenticated" USING ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('configuration.dictionaries.update'::"text") AS "has_permission"))) WITH CHECK ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('configuration.dictionaries.update'::"text") AS "has_permission")));



ALTER TABLE "public"."dict_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dict_types_create_authorized" ON "public"."dict_types" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('configuration.dictionaries.create'::"text") AS "has_permission")));



CREATE POLICY "dict_types_read_authorized" ON "public"."dict_types" FOR SELECT TO "authenticated" USING ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('configuration.dictionaries.read'::"text") AS "has_permission")));



CREATE POLICY "dict_types_update_authorized" ON "public"."dict_types" FOR UPDATE TO "authenticated" USING ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('configuration.dictionaries.update'::"text") AS "has_permission"))) WITH CHECK ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('configuration.dictionaries.update'::"text") AS "has_permission")));



ALTER TABLE "public"."exception_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "exception_logs_read_authorized" ON "public"."exception_logs" FOR SELECT TO "authenticated" USING ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('audit.logs.read'::"text") AS "has_permission")));



ALTER TABLE "public"."login_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "login_logs_read_authorized" ON "public"."login_logs" FOR SELECT TO "authenticated" USING ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('audit.logs.read'::"text") AS "has_permission")));



ALTER TABLE "public"."menus" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "menus_read_authorized" ON "public"."menus" FOR SELECT TO "authenticated" USING ((( SELECT "app_private"."has_permission"('administration.menus.read'::"text") AS "has_permission") OR ( SELECT "app_private"."can_read_menu"("menus"."id") AS "can_read_menu")));



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "messages_read_recipient" ON "public"."messages" FOR SELECT TO "authenticated" USING (((NOT "deleted") AND ( SELECT "app_private"."is_current_profile"("messages"."receiver_id") AS "is_current_profile")));



CREATE POLICY "messages_update_read_recipient" ON "public"."messages" FOR UPDATE TO "authenticated" USING (((NOT "deleted") AND ( SELECT "app_private"."is_current_profile"("messages"."receiver_id") AS "is_current_profile"))) WITH CHECK (((NOT "deleted") AND ( SELECT "app_private"."is_current_profile"("messages"."receiver_id") AS "is_current_profile")));



ALTER TABLE "public"."operation_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "operation_logs_read_authorized" ON "public"."operation_logs" FOR SELECT TO "authenticated" USING ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('audit.logs.read'::"text") AS "has_permission")));



ALTER TABLE "public"."permission_catalog" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permission_catalog_read_password_sessions" ON "public"."permission_catalog" FOR SELECT TO "authenticated" USING (( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated"));



ALTER TABLE "public"."posts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "posts_create" ON "public"."posts" FOR INSERT TO "authenticated" WITH CHECK (((NOT "deleted") AND ( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('organization.posts.create'::"text") AS "has_permission")));



CREATE POLICY "posts_read" ON "public"."posts" FOR SELECT TO "authenticated" USING (((NOT "deleted") AND ( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('organization.posts.read'::"text") AS "has_permission")));



CREATE POLICY "posts_update" ON "public"."posts" FOR UPDATE TO "authenticated" USING (((NOT "deleted") AND ( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('organization.posts.update'::"text") AS "has_permission"))) WITH CHECK (((NOT "deleted") AND ( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('organization.posts.update'::"text") AS "has_permission")));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_read_self_or_user_reader" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((( SELECT "app_private"."is_current_profile"("profiles"."id") AS "is_current_profile") OR ( SELECT "app_private"."has_permission"('administration.users.read'::"text") AS "has_permission")));



CREATE POLICY "profiles_update_self_or_user_editor" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((( SELECT "app_private"."is_current_profile"("profiles"."id") AS "is_current_profile") OR ( SELECT "app_private"."has_permission"('administration.users.update'::"text") AS "has_permission"))) WITH CHECK ((( SELECT "app_private"."is_current_profile"("profiles"."id") AS "is_current_profile") OR ( SELECT "app_private"."has_permission"('administration.users.update'::"text") AS "has_permission")));



ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "role_permissions_assign" ON "public"."role_permissions" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "app_private"."has_permission"('administration.roles.assign_permissions'::"text") AS "has_permission"));



CREATE POLICY "role_permissions_read_assigned_or_role_reader" ON "public"."role_permissions" FOR SELECT TO "authenticated" USING ((( SELECT "app_private"."can_read_role"("role_permissions"."role_id") AS "can_read_role") OR ( SELECT "app_private"."has_permission"('administration.roles.read'::"text") AS "has_permission")));



CREATE POLICY "role_permissions_unassign" ON "public"."role_permissions" FOR DELETE TO "authenticated" USING (( SELECT "app_private"."has_permission"('administration.roles.assign_permissions'::"text") AS "has_permission"));



ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roles_create" ON "public"."roles" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "app_private"."has_permission"('administration.roles.create'::"text") AS "has_permission"));



CREATE POLICY "roles_delete" ON "public"."roles" FOR DELETE TO "authenticated" USING (( SELECT "app_private"."has_permission"('administration.roles.delete'::"text") AS "has_permission"));



CREATE POLICY "roles_read_assigned_or_role_reader" ON "public"."roles" FOR SELECT TO "authenticated" USING ((( SELECT "app_private"."can_read_role"("roles"."id") AS "can_read_role") OR ( SELECT "app_private"."has_permission"('administration.roles.read'::"text") AS "has_permission")));



CREATE POLICY "roles_update" ON "public"."roles" FOR UPDATE TO "authenticated" USING (( SELECT "app_private"."has_permission"('administration.roles.update'::"text") AS "has_permission")) WITH CHECK (( SELECT "app_private"."has_permission"('administration.roles.update'::"text") AS "has_permission"));



ALTER TABLE "public"."system_configs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_configs_create_authorized" ON "public"."system_configs" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('configuration.system.update'::"text") AS "has_permission")));



CREATE POLICY "system_configs_read_authorized" ON "public"."system_configs" FOR SELECT TO "authenticated" USING ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('configuration.system.read'::"text") AS "has_permission")));



CREATE POLICY "system_configs_update_authorized" ON "public"."system_configs" FOR UPDATE TO "authenticated" USING ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('configuration.system.update'::"text") AS "has_permission"))) WITH CHECK ((( SELECT "app_private"."is_password_authenticated"() AS "is_password_authenticated") AND ( SELECT "app_private"."has_permission"('configuration.system.update'::"text") AS "has_permission")));



ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_roles_assign" ON "public"."user_roles" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "app_private"."has_permission"('administration.users.assign_roles'::"text") AS "has_permission"));



CREATE POLICY "user_roles_read_self_or_administrator" ON "public"."user_roles" FOR SELECT TO "authenticated" USING ((( SELECT "app_private"."is_current_profile"("user_roles"."user_id") AS "is_current_profile") OR ( SELECT "app_private"."has_permission"('administration.users.read'::"text") AS "has_permission") OR ( SELECT "app_private"."has_permission"('administration.roles.read'::"text") AS "has_permission")));



CREATE POLICY "user_roles_unassign" ON "public"."user_roles" FOR DELETE TO "authenticated" USING (( SELECT "app_private"."has_permission"('administration.users.assign_roles'::"text") AS "has_permission"));



GRANT USAGE ON SCHEMA "app_private" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "app_private"."can_cleanup_unregistered_attachment_upload"("p_storage_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "app_private"."can_cleanup_unregistered_attachment_upload"("p_storage_path" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "app_private"."can_delete_attachment_path"("p_storage_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "app_private"."can_delete_attachment_path"("p_storage_path" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "app_private"."can_read_menu"("p_menu_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "app_private"."can_read_menu"("p_menu_id" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "app_private"."can_read_role"("p_role_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "app_private"."can_read_role"("p_role_id" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "app_private"."dictionary_item_read_model"("p_id" bigint) FROM PUBLIC;



REVOKE ALL ON FUNCTION "app_private"."dictionary_type_read_model"("p_id" bigint) FROM PUBLIC;



REVOKE ALL ON FUNCTION "app_private"."guard_profile_organization_assignments"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app_private"."has_permission"("p_permission_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "app_private"."has_permission"("p_permission_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "app_private"."is_current_profile"("p_profile_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "app_private"."is_current_profile"("p_profile_id" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "app_private"."is_password_authenticated"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app_private"."is_password_authenticated"() TO "authenticated";



REVOKE ALL ON FUNCTION "app_private"."is_password_recovery_session"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app_private"."is_password_recovery_session"() TO "authenticated";



REVOKE ALL ON FUNCTION "app_private"."log_current_mutation"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app_private"."require_configuration_permission"("p_permission_key" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "app_private"."role_read_model"("p_role_id" bigint) FROM PUBLIC;



REVOKE ALL ON FUNCTION "app_private"."session_context"("p_profile_id" bigint) FROM PUBLIC;



REVOKE ALL ON FUNCTION "app_private"."system_config_read_model"("p_id" bigint) FROM PUBLIC;



REVOKE ALL ON FUNCTION "app_private"."touch_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app_private"."touch_updated_at"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_dictionary_items"("p_dict_type_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_dictionary_items"("p_dict_type_id" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_dictionary_types"("p_dict_code" "text", "p_dict_name" "text", "p_status" smallint, "p_page" integer, "p_page_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_dictionary_types"("p_dict_code" "text", "p_dict_name" "text", "p_status" smallint, "p_page" integer, "p_page_size" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_menu_catalog"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_menu_catalog"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_menu_catalog"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_menu_permission_catalog"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_menu_permission_catalog"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_menu_permission_catalog"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_role_catalog"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_role_catalog"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_role_catalog"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_role_members"("p_role_id" bigint, "p_page" integer, "p_page_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_role_members"("p_role_id" bigint, "p_page" integer, "p_page_size" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_role_members"("p_role_id" bigint, "p_page" integer, "p_page_size" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_roles_page"("p_name" "text", "p_code" "text", "p_status" "text", "p_page" integer, "p_page_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_roles_page"("p_name" "text", "p_code" "text", "p_status" "text", "p_page" integer, "p_page_size" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_roles_page"("p_name" "text", "p_code" "text", "p_status" "text", "p_page" integer, "p_page_size" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_system_configurations"("p_config_code" "text", "p_config_name" "text", "p_status" smallint, "p_page" integer, "p_page_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_system_configurations"("p_config_code" "text", "p_config_name" "text", "p_status" smallint, "p_page" integer, "p_page_size" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."attachment_storage_path_for_delete"("p_attachment_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."attachment_storage_path_for_delete"("p_attachment_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."attachment_storage_path_for_delete"("p_attachment_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."bootstrap_first_admin_profile"("p_auth_user_id" "uuid", "p_login_name" "text", "p_display_name" "text", "p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bootstrap_first_admin_profile"("p_auth_user_id" "uuid", "p_login_name" "text", "p_display_name" "text", "p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_password_reset"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_password_reset"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_password_reset"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_attachment_metadata"("p_original_name" "text", "p_storage_path" "text", "p_mime_type" "text", "p_file_ext" "text", "p_file_size" bigint, "p_business_module" "text", "p_business_record_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_attachment_metadata"("p_original_name" "text", "p_storage_path" "text", "p_mime_type" "text", "p_file_ext" "text", "p_file_size" bigint, "p_business_module" "text", "p_business_record_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_attachment_metadata"("p_original_name" "text", "p_storage_path" "text", "p_mime_type" "text", "p_file_ext" "text", "p_file_size" bigint, "p_business_module" "text", "p_business_record_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_managed_user_profile"("p_auth_user_id" "uuid", "p_user_code" "text", "p_login_name" "text", "p_display_name" "text", "p_email" "text", "p_phone" "text", "p_department_id" bigint, "p_post_id" bigint, "p_role_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_managed_user_profile"("p_auth_user_id" "uuid", "p_user_code" "text", "p_login_name" "text", "p_display_name" "text", "p_email" "text", "p_phone" "text", "p_department_id" bigint, "p_post_id" bigint, "p_role_ids" bigint[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_business_user_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_business_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_business_user_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_navigation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_navigation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_navigation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_profile"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."dashboard_overview"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dashboard_overview"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_admin_menu"("p_menu_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_admin_menu"("p_menu_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_admin_menu"("p_menu_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_admin_role"("p_role_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_admin_role"("p_role_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_admin_role"("p_role_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_attachment_metadata"("p_attachment_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_attachment_metadata"("p_attachment_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_attachment_metadata"("p_attachment_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_department"("p_department_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_department"("p_department_id" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_post"("p_post_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_post"("p_post_id" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."dictionary_options"("p_dict_code" "text", "p_enabled_only" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dictionary_options"("p_dict_code" "text", "p_enabled_only" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."mark_password_reset_requested"("p_auth_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_password_reset_requested"("p_auth_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."menu_role_catalog"("p_menu_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."menu_role_catalog"("p_menu_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."menu_role_catalog"("p_menu_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_exception_event"("p_request_path" "text", "p_request_method" "text", "p_error_type" "text", "p_error_message" "text", "p_stack_summary" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_exception_event"("p_request_path" "text", "p_request_method" "text", "p_error_type" "text", "p_error_message" "text", "p_stack_summary" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_login_attempt"("p_login_name" "text", "p_user_id" bigint, "p_login_ip" "text", "p_user_agent" "text", "p_login_result" smallint, "p_failure_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_login_attempt"("p_login_name" "text", "p_user_id" bigint, "p_login_ip" "text", "p_user_agent" "text", "p_login_result" smallint, "p_failure_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_operation_event"("p_operator_id" bigint, "p_module_code" "text", "p_operation_type" "text", "p_request_method" "text", "p_request_path" "text", "p_request_params" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_operation_event"("p_operator_id" bigint, "p_module_code" "text", "p_operation_type" "text", "p_request_method" "text", "p_request_path" "text", "p_request_params" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_account_password_session"("p_session_id" "uuid", "p_auth_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_account_password_session"("p_session_id" "uuid", "p_auth_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."replace_dictionary_item_order"("p_dict_type_id" "text", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_dictionary_item_order"("p_dict_type_id" "text", "p_items" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."replace_menu_role_authorization"("p_menu_id" bigint, "p_role_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_menu_role_authorization"("p_menu_id" bigint, "p_role_ids" bigint[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_menu_role_authorization"("p_menu_id" bigint, "p_role_ids" bigint[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."replace_role_authorization"("p_role_id" bigint, "p_menu_permission_keys" "text"[], "p_action_permission_keys" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_role_authorization"("p_role_id" bigint, "p_menu_permission_keys" "text"[], "p_action_permission_keys" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_role_authorization"("p_role_id" bigint, "p_menu_permission_keys" "text"[], "p_action_permission_keys" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."replace_role_permissions"("p_role_id" bigint, "p_permission_keys" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_role_permissions"("p_role_id" bigint, "p_permission_keys" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_role_permissions"("p_role_id" bigint, "p_permission_keys" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_login_identity"("p_login_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_login_identity"("p_login_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_account_password_session"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_account_password_session"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."revoke_account_password_session"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rollback_managed_user_create"("p_auth_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rollback_managed_user_create"("p_auth_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_admin_menu"("p_menu_id" "text", "p_parent_id" "text", "p_kind" "text", "p_route_key" "text", "p_path" "text", "p_title" "text", "p_icon" "text", "p_sort_order" integer, "p_is_visible" boolean, "p_is_active" boolean, "p_required_permission_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_admin_menu"("p_menu_id" "text", "p_parent_id" "text", "p_kind" "text", "p_route_key" "text", "p_path" "text", "p_title" "text", "p_icon" "text", "p_sort_order" integer, "p_is_visible" boolean, "p_is_active" boolean, "p_required_permission_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_admin_menu"("p_menu_id" "text", "p_parent_id" "text", "p_kind" "text", "p_route_key" "text", "p_path" "text", "p_title" "text", "p_icon" "text", "p_sort_order" integer, "p_is_visible" boolean, "p_is_active" boolean, "p_required_permission_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_admin_role"("p_role_id" "text", "p_code" "text", "p_name" "text", "p_description" "text", "p_is_active" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_admin_role"("p_role_id" "text", "p_code" "text", "p_name" "text", "p_description" "text", "p_is_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_admin_role"("p_role_id" "text", "p_code" "text", "p_name" "text", "p_description" "text", "p_is_active" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_dictionary_item"("p_id" "text", "p_dict_type_id" "text", "p_item_value" "text", "p_item_label" "text", "p_sort_order" integer, "p_status" smallint, "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_dictionary_item"("p_id" "text", "p_dict_type_id" "text", "p_item_value" "text", "p_item_label" "text", "p_sort_order" integer, "p_status" smallint, "p_description" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_dictionary_type"("p_id" "text", "p_dict_code" "text", "p_dict_name" "text", "p_status" smallint, "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_dictionary_type"("p_id" "text", "p_dict_code" "text", "p_dict_name" "text", "p_status" smallint, "p_description" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_system_configuration"("p_id" "text", "p_config_code" "text", "p_config_name" "text", "p_config_value" "text", "p_value_type" "text", "p_status" smallint, "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_system_configuration"("p_id" "text", "p_config_code" "text", "p_config_name" "text", "p_config_value" "text", "p_value_type" "text", "p_status" smallint, "p_description" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_managed_user_active"("p_profile_id" bigint, "p_is_active" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_managed_user_active"("p_profile_id" bigint, "p_is_active" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."soft_delete_dictionary_item"("p_dict_item_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."soft_delete_dictionary_item"("p_dict_item_id" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."soft_delete_dictionary_type"("p_dict_type_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."soft_delete_dictionary_type"("p_dict_type_id" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."soft_delete_managed_user"("p_profile_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."soft_delete_managed_user"("p_profile_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."soft_delete_system_configuration"("p_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."soft_delete_system_configuration"("p_id" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."system_configuration_value"("p_config_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."system_configuration_value"("p_config_code" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_managed_user_profile"("p_profile_id" bigint, "p_user_code" "text", "p_login_name" "text", "p_display_name" "text", "p_phone" "text", "p_department_id" bigint, "p_post_id" bigint, "p_role_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_managed_user_profile"("p_profile_id" bigint, "p_user_code" "text", "p_login_name" "text", "p_display_name" "text", "p_phone" "text", "p_department_id" bigint, "p_post_id" bigint, "p_role_ids" bigint[]) TO "service_role";



GRANT ALL ON TABLE "public"."attachments" TO "service_role";
GRANT SELECT ON TABLE "public"."attachments" TO "authenticated";



GRANT ALL ON TABLE "public"."attachment_read_model" TO "authenticated";
GRANT ALL ON TABLE "public"."attachment_read_model" TO "service_role";



GRANT ALL ON SEQUENCE "public"."attachments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."attachments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."attachments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."departments" TO "service_role";
GRANT SELECT ON TABLE "public"."departments" TO "authenticated";



GRANT INSERT("dept_code"),UPDATE("dept_code") ON TABLE "public"."departments" TO "authenticated";



GRANT INSERT("dept_name"),UPDATE("dept_name") ON TABLE "public"."departments" TO "authenticated";



GRANT INSERT("status"),UPDATE("status") ON TABLE "public"."departments" TO "authenticated";



GRANT INSERT("description"),UPDATE("description") ON TABLE "public"."departments" TO "authenticated";



GRANT ALL ON TABLE "public"."department_read_model" TO "service_role";
GRANT SELECT ON TABLE "public"."department_read_model" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."departments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."departments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."departments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."exception_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."exception_logs" TO "authenticated";



GRANT ALL ON TABLE "public"."exception_log_read_model" TO "authenticated";
GRANT ALL ON TABLE "public"."exception_log_read_model" TO "service_role";



GRANT ALL ON SEQUENCE "public"."exception_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."exception_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."exception_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."login_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."login_logs" TO "authenticated";



GRANT ALL ON TABLE "public"."login_log_read_model" TO "authenticated";
GRANT ALL ON TABLE "public"."login_log_read_model" TO "service_role";



GRANT ALL ON SEQUENCE "public"."login_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."login_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."login_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."menus" TO "service_role";
GRANT SELECT ON TABLE "public"."menus" TO "authenticated";



GRANT ALL ON TABLE "public"."menu_management_read_model" TO "service_role";
GRANT SELECT ON TABLE "public"."menu_management_read_model" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."menus_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."menus_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."menus_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "service_role";
GRANT SELECT ON TABLE "public"."messages" TO "authenticated";



GRANT UPDATE("read_status") ON TABLE "public"."messages" TO "authenticated";



GRANT UPDATE("read_at") ON TABLE "public"."messages" TO "authenticated";



GRANT SELECT ON TABLE "public"."message_read_model" TO "authenticated";
GRANT SELECT ON TABLE "public"."message_read_model" TO "service_role";



GRANT ALL ON SEQUENCE "public"."messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."messages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."operation_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."operation_logs" TO "authenticated";



GRANT ALL ON TABLE "public"."operation_log_read_model" TO "authenticated";
GRANT ALL ON TABLE "public"."operation_log_read_model" TO "service_role";



GRANT ALL ON SEQUENCE "public"."operation_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."operation_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."operation_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."permission_catalog" TO "service_role";
GRANT SELECT ON TABLE "public"."permission_catalog" TO "authenticated";



GRANT ALL ON TABLE "public"."posts" TO "service_role";
GRANT SELECT ON TABLE "public"."posts" TO "authenticated";



GRANT INSERT("post_code"),UPDATE("post_code") ON TABLE "public"."posts" TO "authenticated";



GRANT INSERT("post_name"),UPDATE("post_name") ON TABLE "public"."posts" TO "authenticated";



GRANT INSERT("status"),UPDATE("status") ON TABLE "public"."posts" TO "authenticated";



GRANT INSERT("description"),UPDATE("description") ON TABLE "public"."posts" TO "authenticated";



GRANT ALL ON TABLE "public"."post_read_model" TO "service_role";
GRANT SELECT ON TABLE "public"."post_read_model" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."posts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."posts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."posts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("display_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("phone") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("avatar_url") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."profiles_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."profiles_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."profiles_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";
GRANT SELECT ON TABLE "public"."role_permissions" TO "authenticated";



GRANT ALL ON TABLE "public"."roles" TO "service_role";
GRANT SELECT ON TABLE "public"."roles" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_management_read_model" TO "service_role";



GRANT ALL ON TABLE "public"."user_management_role_options" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."user_roles" TO "authenticated";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";









-- Supabase-managed Storage schemas are excluded from db dump. Preserve this
-- template's bucket and object policies as part of the new-project baseline.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'admin-attachments',
  'admin-attachments',
  false,
  20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip'
  ]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists admin_attachments_upload_authorized on storage.objects;
create policy admin_attachments_upload_authorized
on storage.objects for insert to authenticated
with check (
  bucket_id = 'admin-attachments'
  and (select app_private.is_password_authenticated())
  and (select app_private.has_permission('files.attachments.upload'))
  and owner_id = (select auth.uid()::text)
  and cardinality(storage.foldername(name)) = 1
  and (storage.foldername(name))[1] = (select public.current_business_user_id())
);

drop policy if exists admin_attachments_read_authorized on storage.objects;
create policy admin_attachments_read_authorized
on storage.objects for select to authenticated
using (
  bucket_id = 'admin-attachments'
  and (select app_private.is_password_authenticated())
  and (select app_private.has_permission('files.attachments.read'))
  and exists (
    select 1
    from public.attachments as attachment
    where attachment.storage_path = storage.objects.name
      and attachment.deleted_at is null
  )
);

drop policy if exists admin_attachments_delete_authorized on storage.objects;
create policy admin_attachments_delete_authorized
on storage.objects for delete to authenticated
using (
  bucket_id = 'admin-attachments'
  and (
    (select app_private.can_delete_attachment_path(storage.objects.name))
    or (select app_private.can_cleanup_unregistered_attachment_upload(storage.objects.name))
  )
);

-- Supabase manages this publication, so pg_dump does not include its table list.
do $baseline_realtime$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end
$baseline_realtime$;

-- Reapply explicit migration ACLs after restoring platform-default ACLs.

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on schema app_private from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant usage on schema app_private to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.is_current_profile(bigint) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.can_read_role(bigint) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.has_permission(text) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.touch_updated_at() from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function app_private.is_current_profile(bigint) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function app_private.can_read_role(bigint) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function app_private.has_permission(text) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function app_private.touch_updated_at() to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on public.profiles, public.roles, public.permission_catalog,
  public.user_roles, public.role_permissions from anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant select on public.profiles, public.roles, public.permission_catalog,
  public.user_roles, public.role_permissions to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant update (display_name, phone, avatar_url) on public.profiles to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant insert (code, name, description), update (name, description, is_active), delete
  on public.roles to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant insert, delete on public.user_roles to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant insert, delete on public.role_permissions to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant usage, select on all sequences in schema public to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on app_private.password_reset_requests from public, anon, authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.mark_password_reset_requested(uuid)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.mark_password_reset_requested(uuid) to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.is_password_authenticated() from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.is_password_recovery_session() from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function app_private.is_password_authenticated() to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function app_private.is_password_recovery_session() to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on public.messages from anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant select on public.messages to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant update (read_status, read_at) on public.messages to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant select, insert, update, delete on public.messages to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant usage, select on sequence public.messages_id_seq to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on public.message_read_model from anon, authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant select on public.message_read_model to authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.import_legacy_messages(jsonb, boolean)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.import_legacy_messages(jsonb, boolean) to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.session_context(bigint)
  from public, anon, authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.resolve_login_identity(text) from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.resolve_login_identity(text) to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.current_profile() from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.current_profile() to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.current_business_user_id() from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.current_business_user_id() to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.complete_password_reset() from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.complete_password_reset() to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on app_private.account_password_sessions
  from public, anon, authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.register_account_password_session(uuid, uuid)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.register_account_password_session(uuid, uuid)
  to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.revoke_account_password_session() from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.revoke_account_password_session() to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.is_password_authenticated() from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function app_private.is_password_authenticated() to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on public.user_management_read_model from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant select on public.user_management_read_model to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on public.user_management_role_options from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant select on public.user_management_role_options to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.create_managed_user_profile(
  uuid, text, text, text, text, text, bigint, bigint, bigint[]
) from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.update_managed_user_profile(
  bigint, text, text, text, text, bigint, bigint, bigint[]
) from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.set_managed_user_active(bigint, boolean)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.soft_delete_managed_user(bigint)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.rollback_managed_user_create(uuid)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.create_managed_user_profile(
  uuid, text, text, text, text, text, bigint, bigint, bigint[]
) to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.update_managed_user_profile(
  bigint, text, text, text, text, bigint, bigint, bigint[]
) to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.set_managed_user_active(bigint, boolean)
  to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.soft_delete_managed_user(bigint)
  to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.rollback_managed_user_create(uuid)
  to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.role_read_model(bigint)
  from public, anon, authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on public.menus from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant select on public.menus to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on public.menu_management_read_model from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant select on public.menu_management_read_model to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.admin_role_catalog() from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.save_admin_role(text, text, text, text, boolean) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.replace_role_permissions(bigint, text[]) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.delete_admin_role(bigint) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.admin_menu_catalog() from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.save_admin_menu(text, text, text, text, text, text, text, integer, boolean, boolean, text)
  from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.delete_admin_menu(bigint) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.admin_role_catalog() to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.save_admin_role(text, text, text, text, boolean) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.replace_role_permissions(bigint, text[]) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.delete_admin_role(bigint) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.admin_menu_catalog() to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.save_admin_menu(text, text, text, text, text, text, text, integer, boolean, boolean, text)
  to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.delete_admin_menu(bigint) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke insert, update, delete on public.roles, public.role_permissions from authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.import_legacy_user_profiles(jsonb, boolean)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.import_legacy_user_profiles(jsonb, boolean)
  to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.can_read_menu(bigint) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function app_private.can_read_menu(bigint) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.current_navigation() from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.current_navigation() to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.import_legacy_menus(jsonb, boolean)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.import_legacy_menus(jsonb, boolean)
  to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on public.dict_types, public.dict_items, public.system_configs
  from public, anon, authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on sequence public.dict_types_id_seq,
  public.dict_items_id_seq,
  public.system_configs_id_seq
  from public, anon, authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.dictionary_type_read_model(bigint),
  app_private.dictionary_item_read_model(bigint),
  app_private.system_config_read_model(bigint),
  app_private.require_configuration_permission(text)
  from public, anon, authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.admin_dictionary_types(text, text, smallint, integer, integer),
  public.admin_dictionary_items(text),
  public.dictionary_options(text, boolean),
  public.save_dictionary_type(text, text, text, smallint, text),
  public.save_dictionary_item(text, text, text, text, integer, smallint, text),
  public.replace_dictionary_item_order(text, jsonb),
  public.soft_delete_dictionary_type(text),
  public.soft_delete_dictionary_item(text),
  public.admin_system_configurations(text, text, smallint, integer, integer),
  public.system_configuration_value(text),
  public.save_system_configuration(text, text, text, text, text, smallint, text),
  public.soft_delete_system_configuration(text)
  from public, anon, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.admin_dictionary_types(text, text, smallint, integer, integer),
  public.admin_dictionary_items(text),
  public.dictionary_options(text, boolean),
  public.save_dictionary_type(text, text, text, smallint, text),
  public.save_dictionary_item(text, text, text, text, integer, smallint, text),
  public.replace_dictionary_item_order(text, jsonb),
  public.soft_delete_dictionary_type(text),
  public.soft_delete_dictionary_item(text),
  public.admin_system_configurations(text, text, smallint, integer, integer),
  public.system_configuration_value(text),
  public.save_system_configuration(text, text, text, text, text, smallint, text),
  public.soft_delete_system_configuration(text)
  to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.guard_profile_organization_assignments()
  from public, anon, authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on public.departments, public.posts,
  public.department_read_model, public.post_read_model
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant select on public.departments, public.posts to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant insert (dept_code, dept_name, status, description)
  on public.departments to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant update (dept_code, dept_name, status, description)
  on public.departments to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant insert (post_code, post_name, status, description)
  on public.posts to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant update (post_code, post_name, status, description)
  on public.posts to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant usage, select on sequence public.departments_id_seq, public.posts_id_seq
  to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant select on public.department_read_model, public.post_read_model
  to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.delete_department(text)
  from public, anon, authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.delete_post(text)
  from public, anon, authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.delete_department(text) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.delete_post(text) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.import_legacy_departments(jsonb, boolean)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.import_legacy_posts(jsonb, boolean)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.import_legacy_departments(jsonb, boolean) to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.import_legacy_posts(jsonb, boolean) to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.assert_legacy_organization_references(text[], text[])
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.assert_legacy_organization_references(text[], text[])
  to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.assert_legacy_import_batch(jsonb),
  app_private.parse_legacy_import_timestamp(text, text),
  app_private.resolve_legacy_actor_id(text)
  from public, anon, authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.import_legacy_dict_types(jsonb, boolean),
  public.import_legacy_dict_items(jsonb, text[], boolean),
  public.import_legacy_system_configs(jsonb, boolean)
  from public, anon, authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.import_legacy_dict_types(jsonb, boolean),
  public.import_legacy_dict_items(jsonb, text[], boolean),
  public.import_legacy_system_configs(jsonb, boolean)
  to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on public.attachments from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant select on public.attachments to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant all on public.attachments to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant usage, select on sequence public.attachments_id_seq to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on public.attachment_read_model from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant select on public.attachment_read_model to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.can_delete_attachment_path(text) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function app_private.can_delete_attachment_path(text) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.can_cleanup_unregistered_attachment_upload(text)
  from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function app_private.can_cleanup_unregistered_attachment_upload(text)
  to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.create_attachment_metadata(text, text, text, text, bigint, text, bigint)
  from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.create_attachment_metadata(text, text, text, text, bigint, text, bigint)
  to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.attachment_storage_path_for_delete(bigint) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.attachment_storage_path_for_delete(bigint) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.delete_attachment_metadata(bigint) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.delete_attachment_metadata(bigint) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.import_legacy_attachments(jsonb, boolean) from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.import_legacy_attachments(jsonb, boolean) to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on public.login_logs, public.operation_logs, public.exception_logs
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant select on public.login_logs, public.operation_logs, public.exception_logs to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant all on public.login_logs, public.operation_logs, public.exception_logs to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant usage, select on sequence public.login_logs_id_seq,
  public.operation_logs_id_seq, public.exception_logs_id_seq to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on public.login_log_read_model, public.operation_log_read_model,
  public.exception_log_read_model from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant select on public.login_log_read_model, public.operation_log_read_model,
  public.exception_log_read_model to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.log_current_mutation() from public, anon, authenticated, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.record_login_attempt(text, bigint, text, text, smallint, text)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.record_login_attempt(text, bigint, text, text, smallint, text)
  to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.record_exception_event(text, text, text, text, text)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.record_exception_event(text, text, text, text, text)
  to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.record_operation_event(bigint, text, text, text, text, jsonb)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.record_operation_event(bigint, text, text, text, text, jsonb)
  to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.create_attachment_metadata(text, text, text, text, bigint, text, bigint)
  from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.create_attachment_metadata(text, text, text, text, bigint, text, bigint)
  to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.import_legacy_login_logs(jsonb, boolean),
  public.import_legacy_operation_logs(jsonb, boolean),
  public.import_legacy_exception_logs(jsonb, boolean)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.import_legacy_login_logs(jsonb, boolean),
  public.import_legacy_operation_logs(jsonb, boolean),
  public.import_legacy_exception_logs(jsonb, boolean)
  to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.dashboard_overview() from public, anon, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.dashboard_overview() to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function app_private.has_permission(text) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function app_private.has_permission(text) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.bootstrap_first_admin_profile(uuid, text, text, text)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.bootstrap_first_admin_profile(uuid, text, text, text)
  to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.create_attachment_metadata(text, text, text, text, bigint, text, bigint)
  from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.create_attachment_metadata(text, text, text, text, bigint, text, bigint)
  to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.dashboard_overview() from public, anon, service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.dashboard_overview() to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.admin_roles_page(text, text, text, integer, integer) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.admin_role_members(bigint, integer, integer) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.replace_role_authorization(bigint, text[], text[]) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.menu_role_catalog(bigint) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.replace_menu_role_authorization(bigint, bigint[]) from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.admin_roles_page(text, text, text, integer, integer) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.admin_role_members(bigint, integer, integer) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.replace_role_authorization(bigint, text[], text[]) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.menu_role_catalog(bigint) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.replace_menu_role_authorization(bigint, bigint[]) to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.admin_menu_permission_catalog() from public, anon;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.admin_menu_permission_catalog() to authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    revoke all on function public.bootstrap_first_admin_profile(uuid, text, text, text)
  from public, anon, authenticated;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

DO $baseline_privileges$
BEGIN
  BEGIN
    grant execute on function public.bootstrap_first_admin_profile(uuid, text, text, text)
  to service_role;
  EXCEPTION
    WHEN undefined_function OR undefined_table OR undefined_object THEN NULL;
  END;
END
$baseline_privileges$;

