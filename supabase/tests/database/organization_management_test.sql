begin;

create extension if not exists pgtap with schema extensions;

select plan(89);

select has_table('public', 'departments', 'department table exists');
select has_table('public', 'posts', 'post table exists');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.departments'::regclass), 'department RLS is enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.posts'::regclass), 'post RLS is enabled');
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_department_id_fkey'
      and confrelid = 'public.departments'::regclass
      and confdeltype = 'r'
  ),
  'profiles retain a restrictive department foreign key before and after backfill'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_post_id_fkey'
      and confrelid = 'public.posts'::regclass
      and confdeltype = 'r'
  ),
  'profiles retain a restrictive post foreign key before and after backfill'
);
select ok(not has_table_privilege('anon', 'public.departments', 'select'), 'anonymous clients cannot read departments');
select ok(not has_table_privilege('anon', 'public.posts', 'select'), 'anonymous clients cannot read posts');
select ok(has_table_privilege('authenticated', 'public.departments', 'select'), 'authenticated department reads are controlled by RLS');
select ok(has_table_privilege('authenticated', 'public.posts', 'select'), 'authenticated post reads are controlled by RLS');
select ok(has_column_privilege('authenticated', 'public.departments', 'dept_code', 'insert'), 'authenticated department creates are controlled by RLS');
select ok(has_column_privilege('authenticated', 'public.departments', 'dept_code', 'update'), 'authenticated department updates are controlled by RLS');
select ok(not has_table_privilege('authenticated', 'public.departments', 'delete'), 'authenticated clients cannot bypass reference checks with hard delete');
select ok(has_column_privilege('authenticated', 'public.posts', 'post_code', 'insert'), 'authenticated post creates are controlled by RLS');
select ok(has_column_privilege('authenticated', 'public.posts', 'post_code', 'update'), 'authenticated post updates are controlled by RLS');
select ok(not has_table_privilege('authenticated', 'public.posts', 'delete'), 'authenticated clients cannot bypass reference checks with hard delete');
select ok(
  (select reloptions @> array['security_invoker=true'] from pg_catalog.pg_class where oid = 'public.department_read_model'::regclass)
  and (select reloptions @> array['security_invoker=true'] from pg_catalog.pg_class where oid = 'public.post_read_model'::regclass),
  'both organization read models invoke underlying table RLS'
);
select ok(has_table_privilege('authenticated', 'public.department_read_model', 'select'), 'authenticated clients can read the department model');
select ok(not has_table_privilege('anon', 'public.department_read_model', 'select'), 'anonymous clients cannot read the department model');
select ok(has_table_privilege('authenticated', 'public.post_read_model', 'select'), 'authenticated clients can read the post model');
select ok(not has_table_privilege('anon', 'public.post_read_model', 'select'), 'anonymous clients cannot read the post model');

select ok(has_function_privilege('authenticated', 'public.delete_department(text)', 'execute'), 'authenticated callers can invoke the permission-checked department delete API');
select ok(not has_function_privilege('anon', 'public.delete_department(text)', 'execute'), 'anonymous callers cannot invoke department delete');
select ok(has_function_privilege('authenticated', 'public.delete_post(text)', 'execute'), 'authenticated callers can invoke the permission-checked post delete API');
select ok(not has_function_privilege('anon', 'public.delete_post(text)', 'execute'), 'anonymous callers cannot invoke post delete');
select ok(has_function_privilege('service_role', 'public.import_legacy_departments(jsonb,boolean)', 'execute'), 'service_role can import legacy departments');
select ok(not has_function_privilege('authenticated', 'public.import_legacy_departments(jsonb,boolean)', 'execute'), 'authenticated users cannot import legacy departments');
select ok(has_function_privilege('service_role', 'public.import_legacy_posts(jsonb,boolean)', 'execute'), 'service_role can import legacy posts');
select ok(not has_function_privilege('authenticated', 'public.import_legacy_posts(jsonb,boolean)', 'execute'), 'authenticated users cannot import legacy posts');
select ok(has_function_privilege('service_role', 'public.assert_legacy_organization_references(text[],text[])', 'execute'), 'service_role can preflight legacy profile references');
select ok(not has_function_privilege('authenticated', 'public.assert_legacy_organization_references(text[],text[])', 'execute'), 'authenticated users cannot run the legacy reference preflight');
select ok(
  (select count(*) = 8 from public.permission_catalog where permission_key in (
    'organization.departments.read',
    'organization.departments.create',
    'organization.departments.update',
    'organization.departments.delete',
    'organization.posts.read',
    'organization.posts.create',
    'organization.posts.update',
    'organization.posts.delete'
  )),
  'all CRUD permissions are registered separately'
);

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
    from public.profiles as profile
    where profile.login_name = '__codex_rls_super'
  ),
  true
);
set local role authenticated;

select ok(app_private.is_password_authenticated(), 'SUPER_ADMIN fixture uses an allowed password session');
select lives_ok(
  $$insert into public.departments (dept_code, dept_name, status, description)
    values ('CODEX_ORG_DEPT', 'Codex Organization Department', 0, 'department test')$$,
  'SUPER_ADMIN can create a department'
);
select lives_ok(
  $$insert into public.posts (post_code, post_name, status, description)
    values ('CODEX_ORG_POST', 'Codex Organization Post', 1, 'post test')$$,
  'SUPER_ADMIN can create a post'
);
select ok(
  (select id ~ '^[1-9][0-9]*$' and jsonb_typeof(to_jsonb(model)->'id') = 'string'
   from public.department_read_model as model where dept_code = 'CODEX_ORG_DEPT'),
  'department read model serializes the BIGINT ID as decimal text'
);
select ok(
  (select id ~ '^[1-9][0-9]*$' and jsonb_typeof(to_jsonb(model)->'id') = 'string'
   from public.post_read_model as model where post_code = 'CODEX_ORG_POST'),
  'post read model serializes the BIGINT ID as decimal text'
);
select throws_ok(
  $$insert into public.departments (dept_code, dept_name) values ('codex_org_dept', 'Duplicate Department')$$,
  '23505',
  null,
  'department codes are case-insensitively unique'
);
select throws_ok(
  $$insert into public.departments (dept_code, dept_name, status) values ('CODEX_BAD_STATUS', 'Invalid Status', 2)$$,
  '23514',
  null,
  'department status is constrained to active or inactive'
);
select throws_ok(
  $$insert into public.posts (post_code, post_name) values ('codex_org_post', 'Duplicate Post')$$,
  '23505',
  null,
  'post codes are case-insensitively unique'
);
select throws_ok(
  $$insert into public.posts (post_code, post_name, status) values ('CODEX_BAD_STATUS', 'Invalid Status', 2)$$,
  '23514',
  null,
  'post status is constrained to active or inactive'
);

reset role;
update public.profiles as profile
set department_id = (select id from public.departments where dept_code = 'CODEX_ORG_DEPT'),
    post_id = (select id from public.posts where post_code = 'CODEX_ORG_POST')
where profile.login_name = '__codex_rls_common';
set local role authenticated;

select throws_ok(
  $$select public.delete_department((select id::text from public.departments where dept_code = 'CODEX_ORG_DEPT'))$$,
  '23503',
  'Department is referenced by profiles',
  'a department assigned to a profile cannot be deleted'
);
select throws_ok(
  $$select public.delete_post((select id::text from public.posts where post_code = 'CODEX_ORG_POST'))$$,
  '23503',
  'Post is referenced by profiles',
  'a post assigned to a profile cannot be deleted'
);

reset role;
update public.profiles as profile
set department_id = null,
    post_id = null
where profile.login_name = '__codex_rls_common';
set local role authenticated;

select lives_ok(
  $$select public.delete_department((select id::text from public.departments where dept_code = 'CODEX_ORG_DEPT'))$$,
  'SUPER_ADMIN can soft-delete an unreferenced department'
);
select lives_ok(
  $$select public.delete_post((select id::text from public.posts where post_code = 'CODEX_ORG_POST'))$$,
  'SUPER_ADMIN can soft-delete an unreferenced post'
);
select ok(not exists (select 1 from public.department_read_model where dept_code = 'CODEX_ORG_DEPT'), 'soft-deleted departments are hidden from the read model');
select ok(not exists (select 1 from public.post_read_model where post_code = 'CODEX_ORG_POST'), 'soft-deleted posts are hidden from the read model');

reset role;
set local role service_role;
select is(
  public.import_legacy_departments(
    '[
      {"id":"920000000000001","dept_code":"LEGACY_ORG_DEPT","dept_name":"Legacy Department","status":0,"description":"source description","deleted":false,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"},
      {"id":"920000000000002","dept_code":"LEGACY_ORG_REMOVED","dept_name":"Legacy Removed Department","status":1,"description":null,"deleted":true,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"}
    ]'::jsonb,
    false
  )->>'sourceCount',
  '2',
  'department import preview reports its source row count'
);
select is(
  public.import_legacy_departments(
    '[
      {"id":"920000000000001","dept_code":"LEGACY_ORG_DEPT","dept_name":"Legacy Department","status":0,"description":"source description","deleted":false,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"},
      {"id":"920000000000002","dept_code":"LEGACY_ORG_REMOVED","dept_name":"Legacy Removed Department","status":1,"description":null,"deleted":true,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"}
    ]'::jsonb,
    false
  )->>'rowsToInsert',
  '2',
  'department import preview reports rows that would be inserted'
);
select is(
  public.import_legacy_departments(
    '[
      {"id":"920000000000001","dept_code":"LEGACY_ORG_DEPT","dept_name":"Legacy Department","status":0,"description":"source description","deleted":false,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"},
      {"id":"920000000000002","dept_code":"LEGACY_ORG_REMOVED","dept_name":"Legacy Removed Department","status":1,"description":null,"deleted":true,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"}
    ]'::jsonb,
    false
  )->>'insertedCount',
  '0',
  'department import preview does not write rows'
);
select ok(
  not exists (select 1 from public.departments where id in (920000000000001, 920000000000002)),
  'department import preview leaves the source IDs absent'
);
select is(
  public.import_legacy_departments(
    '[
      {"id":"920000000000001","dept_code":"LEGACY_ORG_DEPT","dept_name":"Legacy Department","status":0,"description":"source description","deleted":false,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"},
      {"id":"920000000000002","dept_code":"LEGACY_ORG_REMOVED","dept_name":"Legacy Removed Department","status":1,"description":null,"deleted":true,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"}
    ]'::jsonb,
    true
  )->>'insertedCount',
  '2',
  'department import apply preserves both source IDs'
);
select is(
  public.import_legacy_departments(
    '[
      {"id":"920000000000001","dept_code":"LEGACY_ORG_DEPT","dept_name":"Legacy Department","status":0,"description":"source description","deleted":false,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"},
      {"id":"920000000000002","dept_code":"LEGACY_ORG_REMOVED","dept_name":"Legacy Removed Department","status":1,"description":null,"deleted":true,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"}
    ]'::jsonb,
    true
  )->>'alreadyPresentCount',
  '2',
  'repeating department import treats matching rows as already present'
);
select is(
  public.import_legacy_departments(
    '[
      {"id":"920000000000001","dept_code":"LEGACY_ORG_DEPT","dept_name":"Legacy Department","status":0,"description":"source description","deleted":false,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"},
      {"id":"920000000000002","dept_code":"LEGACY_ORG_REMOVED","dept_name":"Legacy Removed Department","status":1,"description":null,"deleted":true,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"}
    ]'::jsonb,
    true
  )->>'insertedCount',
  '0',
  'repeating department import inserts no duplicate rows'
);
select throws_ok(
  $$select public.import_legacy_departments(
    '[{"id":"920000000000001","dept_code":"LEGACY_ORG_DEPT","dept_name":"Changed Name","status":0,"description":"source description","deleted":false,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"}]'::jsonb,
    true
  )$$,
  '23505',
  'Department import conflicts with an existing ID',
  'department import rejects changed content for an existing ID'
);
select is(
  (select id from public.department_read_model where dept_code = 'LEGACY_ORG_DEPT'),
  '920000000000001',
  'department import read model preserves the exact BIGINT ID string'
);
select ok(
  (select status = 0 and description = 'source description'
    and created_at = '2026-10-01T00:00:00Z'::timestamptz
    and updated_at = '2026-10-02T00:00:00Z'::timestamptz
   from public.departments where id = 920000000000001),
  'department import preserves status, description, and timestamps'
);
select ok(
  (select deleted and status = 1 from public.departments where id = 920000000000002)
  and not exists (select 1 from public.department_read_model where id = '920000000000002'),
  'department import preserves the soft-delete flag'
);
select ok(
  currval('public.departments_id_seq') >= 920000000000002,
  'department import advances the identity sequence beyond imported IDs'
);

select is(
  public.import_legacy_posts(
    '[
      {"id":"930000000000001","post_code":"LEGACY_ORG_POST","post_name":"Legacy Post","status":1,"description":"source description","deleted":false,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"},
      {"id":"930000000000002","post_code":"LEGACY_ORG_REMOVED_POST","post_name":"Legacy Removed Post","status":0,"description":null,"deleted":true,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"}
    ]'::jsonb,
    false
  )->>'rowsToInsert',
  '2',
  'post import preview reports rows that would be inserted'
);
select is(
  public.import_legacy_posts(
    '[
      {"id":"930000000000001","post_code":"LEGACY_ORG_POST","post_name":"Legacy Post","status":1,"description":"source description","deleted":false,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"},
      {"id":"930000000000002","post_code":"LEGACY_ORG_REMOVED_POST","post_name":"Legacy Removed Post","status":0,"description":null,"deleted":true,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"}
    ]'::jsonb,
    false
  )->>'insertedCount',
  '0',
  'post import preview does not write rows'
);
select ok(
  not exists (select 1 from public.posts where id in (930000000000001, 930000000000002)),
  'post import preview leaves the source IDs absent'
);
select is(
  public.import_legacy_posts(
    '[
      {"id":"930000000000001","post_code":"LEGACY_ORG_POST","post_name":"Legacy Post","status":1,"description":"source description","deleted":false,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"},
      {"id":"930000000000002","post_code":"LEGACY_ORG_REMOVED_POST","post_name":"Legacy Removed Post","status":0,"description":null,"deleted":true,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"}
    ]'::jsonb,
    true
  )->>'insertedCount',
  '2',
  'post import apply preserves both source IDs'
);
select is(
  public.import_legacy_posts(
    '[
      {"id":"930000000000001","post_code":"LEGACY_ORG_POST","post_name":"Legacy Post","status":1,"description":"source description","deleted":false,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"},
      {"id":"930000000000002","post_code":"LEGACY_ORG_REMOVED_POST","post_name":"Legacy Removed Post","status":0,"description":null,"deleted":true,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"}
    ]'::jsonb,
    true
  )->>'alreadyPresentCount',
  '2',
  'repeating post import treats matching rows as already present'
);
select is(
  public.import_legacy_posts(
    '[
      {"id":"930000000000001","post_code":"LEGACY_ORG_POST","post_name":"Legacy Post","status":1,"description":"source description","deleted":false,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"},
      {"id":"930000000000002","post_code":"LEGACY_ORG_REMOVED_POST","post_name":"Legacy Removed Post","status":0,"description":null,"deleted":true,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"}
    ]'::jsonb,
    true
  )->>'insertedCount',
  '0',
  'repeating post import inserts no duplicate rows'
);
select throws_ok(
  $$select public.import_legacy_posts(
    '[{"id":"930000000000001","post_code":"LEGACY_ORG_POST","post_name":"Changed Name","status":1,"description":"source description","deleted":false,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"}]'::jsonb,
    true
  )$$,
  '23505',
  'Post import conflicts with an existing ID',
  'post import rejects changed content for an existing ID'
);
select is(
  (select id from public.post_read_model where post_code = 'LEGACY_ORG_POST'),
  '930000000000001',
  'post import read model preserves the exact BIGINT ID string'
);
select ok(
  (select status = 1 and description = 'source description'
    and created_at = '2026-10-01T00:00:00Z'::timestamptz
    and updated_at = '2026-10-02T00:00:00Z'::timestamptz
   from public.posts where id = 930000000000001),
  'post import preserves status, description, and timestamps'
);
select ok(
  (select deleted and status = 0 from public.posts where id = 930000000000002)
  and not exists (select 1 from public.post_read_model where id = '930000000000002'),
  'post import preserves the soft-delete flag'
);
select ok(
  currval('public.posts_id_seq') >= 930000000000002,
  'post import advances the identity sequence beyond imported IDs'
);

select lives_ok(
  $$select public.assert_legacy_organization_references(
    array['920000000000001', '920000000000002']::text[],
    array['930000000000001', '930000000000002']::text[]
  )$$,
  'reference preflight accepts existing IDs including soft-deleted organization rows'
);
select throws_ok(
  $$select public.assert_legacy_organization_references(array['910000000000001']::text[], array[]::text[])$$,
  '23503',
  'A legacy profile references a missing department',
  'reference preflight rejects a missing department ID'
);
select throws_ok(
  $$select public.assert_legacy_organization_references(array[]::text[], array['910000000000002']::text[])$$,
  '23503',
  'A legacy profile references a missing post',
  'reference preflight rejects a missing post ID'
);
select throws_ok(
  $$select public.assert_legacy_organization_references(array['01']::text[], array[]::text[])$$,
  '22023',
  'Department reference ID is invalid',
  'reference preflight rejects non-canonical BIGINT strings'
);
select throws_ok(
  $$select public.assert_legacy_organization_references(array_fill('1'::text, array[101]), array[]::text[])$$,
  '22023',
  'Organization reference batches cannot exceed 100 IDs',
  'reference preflight bounds its input arrays'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $$update public.profiles
    set department_id = 920000000000002, post_id = 930000000000002
    where login_name = '__codex_rls_common'$$,
  'trusted legacy profile imports may preserve references to soft-deleted source rows'
);
select ok(
  (select department_id = 920000000000002 and post_id = 930000000000002
   from public.profiles where login_name = '__codex_rls_common'),
  'legacy profile BIGINT references remain unchanged after organization import'
);
update public.profiles
set department_id = null, post_id = null
where login_name = '__codex_rls_common';

reset role;
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
);
select throws_ok(
  $$update public.profiles set department_id = 920000000000002
    where login_name = '__codex_rls_common'$$,
  '23503',
  'Department is missing or soft-deleted',
  'authenticated profile managers cannot assign a soft-deleted department'
);

reset role;
insert into public.role_permissions (role_id, permission_key)
select role.id, permission.permission_key
from public.roles as role
join public.permission_catalog as permission
  on permission.permission_key in (
    'organization.departments.read',
    'organization.departments.update',
    'organization.posts.read'
  )
where role.code = 'OPERATOR'
on conflict do nothing;

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
    from public.profiles as profile
    where profile.login_name = '__codex_rls_operator'
  ),
  true
);
set local role authenticated;

select ok(not app_private.has_permission('organization.departments.create'), 'OPERATOR lacks department create permission');
select ok(app_private.has_permission('organization.departments.read'), 'OPERATOR receives the granted department read permission');
select ok(not app_private.has_permission('organization.departments.delete'), 'OPERATOR lacks department delete permission');
select ok(not app_private.has_permission('organization.posts.update'), 'OPERATOR lacks post update permission');
select is(
  (select count(*)::integer from public.department_read_model where dept_code = 'LEGACY_ORG_DEPT'),
  1,
  'OPERATOR reads departments when its concrete read permission is granted'
);
select is(
  (select count(*)::integer from public.post_read_model where post_code = 'LEGACY_ORG_POST'),
  1,
  'OPERATOR reads posts when its concrete read permission is granted'
);
select lives_ok(
  $$update public.departments set status = 0 where dept_code = 'LEGACY_ORG_DEPT'$$,
  'OPERATOR can update departments when its concrete update permission is granted'
);
select is(
  (select status::integer from public.department_read_model where dept_code = 'LEGACY_ORG_DEPT'),
  0,
  'department update permission changes the requested row'
);
select results_eq(
  $$with changed as (
      update public.posts set status = 0 where post_code = 'LEGACY_ORG_POST'
      returning id
    )
    select count(*)::integer from changed$$,
  $$values (0::integer)$$,
  'OPERATOR cannot update posts without the post update permission'
);
select throws_ok(
  $$insert into public.departments (dept_code, dept_name) values ('CODEX_OPERATOR_DENIED', 'Denied')$$,
  '42501',
  null,
  'OPERATOR cannot create a department without create permission'
);
select throws_ok(
  $$select public.delete_department((select id::text from public.departments where dept_code = 'LEGACY_ORG_DEPT'))$$,
  '42501',
  'Department delete permission is required',
  'OPERATOR cannot delete a department without delete permission'
);

select * from finish();
rollback;
