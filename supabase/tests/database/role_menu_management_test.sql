begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_table('public', 'menus', 'menu management table exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.menus'::regclass),
  'menus have row-level security enabled'
);
select ok(
  has_table_privilege('authenticated', 'public.menus', 'select'),
  'authenticated users can query menus through their RLS policy'
);
select ok(
  not has_table_privilege('anon', 'public.menus', 'select'),
  'anonymous users cannot read menus'
);
select ok(
  has_table_privilege('authenticated', 'public.menu_management_read_model', 'select'),
  'authenticated users can read the invoker menu model'
);
select ok(
  not has_table_privilege('anon', 'public.menu_management_read_model', 'select'),
  'anonymous users cannot read the menu model'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_role_catalog()', 'execute'),
  'authenticated callers can invoke the role catalog API'
);
select ok(
  not has_function_privilege('anon', 'public.admin_role_catalog()', 'execute'),
  'anonymous callers cannot invoke the role catalog API'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_roles_page(text,text,text,integer,integer)', 'execute')
    and has_function_privilege('authenticated', 'public.admin_role_members(bigint,integer,integer)', 'execute')
    and has_function_privilege('authenticated', 'public.replace_role_authorization(bigint,text[],text[])', 'execute')
    and has_function_privilege('authenticated', 'public.menu_role_catalog(bigint)', 'execute')
    and has_function_privilege('authenticated', 'public.replace_menu_role_authorization(bigint,bigint[])', 'execute'),
  'server-paginated role, member, and menu-authorization RPCs are available to authenticated callers'
);
select ok(
  has_function_privilege('authenticated', 'public.save_admin_role(text,text,text,text,boolean)', 'execute'),
  'authenticated callers can invoke the role save API'
);
select ok(
  not has_function_privilege('anon', 'public.save_admin_role(text,text,text,text,boolean)', 'execute'),
  'anonymous callers cannot invoke the role save API'
);

select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from public.profiles where login_name = '__codex_rls_super'),
  true
) as super_claim \gset
select set_config(
  'request.jwt.claims',
  (
    select jsonb_build_object(
      'sub', profile.auth_user_id::text,
      'role', 'authenticated',
      'session_id', (
        select allowed_session.session_id::text
        from app_private.account_password_sessions as allowed_session
        where allowed_session.auth_user_id = profile.auth_user_id
        order by allowed_session.authorized_at desc
        limit 1
      ),
      'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', 1))
    )::text
    from public.profiles as profile where profile.login_name = '__codex_rls_super'
  ),
  true
) as super_claims \gset
set local role authenticated;

select ok(app_private.is_password_authenticated(), 'SUPER_ADMIN fixture uses a registered password session');
select is(jsonb_typeof(public.admin_role_catalog()->'roles'), 'array', 'role catalog returns a role array');
select is(jsonb_typeof(public.admin_role_catalog()->'permissions'), 'array', 'role catalog returns permission descriptions');
select ok(
  exists (
    select 1
    from jsonb_array_elements(public.admin_role_catalog()->'roles') as item(role)
    where item.role->>'code' = 'SUPER_ADMIN'
      and jsonb_typeof(item.role->'id') = 'string'
  ),
  'role catalog serializes BIGINT identifiers as text'
);
select is(
  (
    select jsonb_array_length(item.role->'permissionKeys')
    from jsonb_array_elements(public.admin_role_catalog()->'roles') as item(role)
    where item.role->>'code' = 'SUPER_ADMIN'
  ),
  (select count(*)::integer from public.permission_catalog),
  'SUPER_ADMIN catalog entry reflects all registered permissions'
);
select ok(
  jsonb_typeof(public.admin_roles_page(null, null, 'all', 1, 2)->'roles') = 'array'
    and (public.admin_roles_page(null, null, 'all', 1, 2)->>'pageSize')::integer = 2
    and (public.admin_roles_page(null, null, 'all', 1, 2)->>'total')::integer = (select count(*)::integer from public.roles),
  'role list filters and paginates on the database server'
);
select ok(
  (public.admin_role_members((select id from public.roles where code = 'SUPER_ADMIN'), 1, 10)->>'total')::integer = 1
    and (public.admin_role_members((select id from public.roles where code = 'SUPER_ADMIN'), 1, 10)->'items'->0->>'loginName') = '__codex_rls_super'
    and not ((public.admin_role_members((select id from public.roles where code = 'SUPER_ADMIN'), 1, 10)->'items'->0) ? 'email'),
  'role member pages include account labels without disclosing email addresses'
);
select lives_ok(
  $$select public.save_admin_role(null, 'CODEX_ROLE_MENU_TEST', 'Codex Role Menu Test', null, true)$$,
  'SUPER_ADMIN can create a role'
);
select ok(
  exists (select 1 from public.roles where code = 'CODEX_ROLE_MENU_TEST' and not is_system),
  'created roles are not marked as system roles'
);
select is(
  (
    select jsonb_typeof(item.role->'id')
    from jsonb_array_elements(public.admin_role_catalog()->'roles') as item(role)
    where item.role->>'code' = 'CODEX_ROLE_MENU_TEST'
  ),
  'string',
  'role save response keeps BIGINT IDs as decimal text'
);
select lives_ok(
  $$select public.replace_role_permissions(
    (select id from public.roles where code = 'CODEX_ROLE_MENU_TEST'),
    array['administration.users.read']::text[]
  )$$,
  'SUPER_ADMIN can replace a role permission set'
);
select results_eq(
  $$select role_permission.permission_key
    from public.role_permissions as role_permission
    join public.roles as role on role.id = role_permission.role_id
    where role.code = 'CODEX_ROLE_MENU_TEST'$$,
  $$values ('administration.users.read'::text)$$,
  'permission replacement is atomic and complete'
);
select lives_ok(
  $$select public.replace_role_authorization(
    (select id from public.roles where code = 'CODEX_ROLE_MENU_TEST'),
    array['administration.roles.read']::text[],
    array['administration.users.create']::text[]
  )$$,
  'role authorization saves menu and action permissions together'
);
select lives_ok(
  $$select public.replace_menu_role_authorization(
    (select id from public.menus where route_key = 'administration.roles'),
    array[(select id from public.roles where code = 'CODEX_ROLE_MENU_TEST')]::bigint[]
  )$$,
  'menu authorization grants its existing permission key'
);
select ok(
  (select bool_and(role_permission.permission_key in ('administration.roles.read', 'administration.users.create'))
   from public.role_permissions as role_permission
   join public.roles as role on role.id = role_permission.role_id
   where role.code = 'CODEX_ROLE_MENU_TEST')
  and exists (
    select 1 from public.role_permissions as role_permission
    join public.roles as role on role.id = role_permission.role_id
    where role.code = 'CODEX_ROLE_MENU_TEST' and role_permission.permission_key = 'administration.users.create'
  ),
  'incremental menu authorization preserves action permissions'
);
select is(
  (public.menu_role_catalog((select id from public.menus where route_key = 'account.profile'))->>'sharedMenuCount')::integer,
  2,
  'menus that share a permission key are reported as linked'
);
select lives_ok(
  $$select public.replace_menu_role_authorization(
    (select id from public.menus where route_key = 'administration.roles'),
    array[]::bigint[]
  )$$,
  'menu role authorization can be removed independently'
);
select ok(
  exists (
    select 1 from public.role_permissions as role_permission
    join public.roles as role on role.id = role_permission.role_id
    where role.code = 'CODEX_ROLE_MENU_TEST' and role_permission.permission_key = 'administration.users.create'
  ) and not exists (
    select 1 from public.role_permissions as role_permission
    join public.roles as role on role.id = role_permission.role_id
    where role.code = 'CODEX_ROLE_MENU_TEST' and role_permission.permission_key = 'administration.roles.read'
  ),
  'removing a menu grant keeps unrelated permissions'
);
select throws_ok(
  $$select public.save_admin_role(
    (select id::text from public.roles where code = 'SUPER_ADMIN'),
    'SUPER_ADMIN', '超级管理员', null, false
  )$$,
  '23514',
  'SUPER_ADMIN must remain active',
  'the last-resort administrator role cannot be disabled'
);
select lives_ok(
  $$select public.save_admin_menu(
    null, null, 'group', null, '/codex-role-menu-test', 'Codex Role Menu Test', null,
    10, true, true, null
  )$$,
  'SUPER_ADMIN can create a menu group'
);
select lives_ok(
  $$select public.save_admin_menu(
    (select id::text from public.menus where route_key = 'administration.roles'),
    (select id::text from public.menus where path = '/codex-role-menu-test'),
    'route', 'administration.roles', '/codex-role-menu-test/roles', '角色管理', null,
    1, true, true, 'administration.roles.read'
  )$$,
  'SUPER_ADMIN can edit and move an existing route using its registered RouteKey'
);
select ok(
  jsonb_array_length(public.admin_menu_catalog()) = (select count(*)::integer from public.menus)
  and jsonb_typeof((public.admin_menu_catalog()->0)->'id') = 'string',
  'SUPER_ADMIN menu catalog is RLS-visible and serializes BIGINT IDs as text'
);
select throws_ok(
  $$select public.save_admin_menu(
    (select id::text from public.menus where path = '/codex-role-menu-test'),
    (select id::text from public.menus where path = '/codex-role-menu-test'),
    'group', null, '/codex-role-menu-test', 'Codex Role Menu Test', null,
    10, true, true, null
  )$$,
  '23514',
  'Menu hierarchy cannot contain a cycle',
  'menu parent updates cannot create cycles'
);
select throws_ok(
  $$select public.delete_admin_menu((select id from public.menus where path = '/codex-role-menu-test'))$$,
  '23503',
  'Menu has child entries',
  'parent menus cannot be deleted while children exist'
);
select lives_ok(
  $$select public.delete_admin_menu((select id from public.menus where path = '/codex-role-menu-test/roles'))$$,
  'SUPER_ADMIN can delete a leaf menu'
);
select lives_ok(
  $$select public.delete_admin_menu((select id from public.menus where path = '/codex-role-menu-test'))$$,
  'SUPER_ADMIN can delete the now-empty menu group'
);
select lives_ok(
  $$select public.delete_admin_role((select id from public.roles where code = 'CODEX_ROLE_MENU_TEST'))$$,
  'SUPER_ADMIN can delete an unassigned non-system role'
);
select is(
  (select count(*)::integer from public.menus where path like '/codex-role-menu-test%'),
  0,
  'temporary menu rows were removed'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from public.profiles where login_name = '__codex_rls_operator'),
  true
) as operator_claim \gset
select set_config(
  'request.jwt.claims',
  (
    select jsonb_build_object(
      'sub', profile.auth_user_id::text,
      'role', 'authenticated',
      'session_id', (
        select allowed_session.session_id::text
        from app_private.account_password_sessions as allowed_session
        where allowed_session.auth_user_id = profile.auth_user_id
        order by allowed_session.authorized_at desc
        limit 1
      ),
      'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', 1))
    )::text
    from public.profiles as profile where profile.login_name = '__codex_rls_operator'
  ),
  true
) as operator_claims \gset
set local role authenticated;

select ok(
  not app_private.has_permission('administration.menus.read'),
  'OPERATOR without menu authorization has no menu read permission'
);
select throws_ok(
  $$select public.admin_role_catalog()$$,
  '42501',
  'Role read permission is required',
  'OPERATOR cannot read role administration data without permission'
);
select ok(
  jsonb_array_length(public.admin_menu_catalog()) > 0
  and not public.admin_menu_catalog() @> '[{"routeKey":"administration.users"}]'::jsonb,
  'OPERATOR can read menu metadata but not an ungranted user-management route'
);
select throws_ok(
  $$select public.save_admin_role(null, 'CODEX_DENIED_ROLE', 'Denied Role', null, true)$$,
  '42501',
  'Role create permission is required',
  'OPERATOR cannot create roles without permission'
);
select throws_ok(
  $$select public.save_admin_menu(
    null, null, 'group', null, '/codex-denied-menu', 'Denied Menu', null,
    1, true, true, null
  )$$,
  '42501',
  'Menu create permission is required',
  'OPERATOR cannot create menus without permission'
);
select ok(not has_table_privilege('authenticated', 'public.menus', 'insert'), 'clients cannot bypass menu RPCs with insert');
select ok(not has_table_privilege('authenticated', 'public.menus', 'update'), 'clients cannot bypass menu RPCs with update');
select ok(not has_table_privilege('authenticated', 'public.menus', 'delete'), 'clients cannot bypass menu RPCs with delete');

select * from finish();
rollback;
