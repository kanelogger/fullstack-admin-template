begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_table('public', 'profiles', 'business profiles table exists');
select has_table('public', 'messages', 'user inbox table exists');

select is(
  (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'user_code'),
  'text',
  'profiles retain the unique legacy user code as text'
);
select is(
  (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'department_id'),
  'bigint',
  'profiles retain department IDs as BIGINT until organization migration'
);
select is(
  (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'post_id'),
  'bigint',
  'profiles retain post IDs as BIGINT until organization migration'
);
select is(
  (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'deleted_at'),
  'timestamp with time zone',
  'user deletion is represented by a soft-delete timestamp'
);
select ok(
  exists (select 1 from pg_catalog.pg_class where oid = 'public.user_management_read_model'::regclass and relkind = 'v'),
  'managed-user view exists for the server-side service'
);
select ok(
  not has_table_privilege('authenticated', 'public.user_management_read_model', 'select'),
  'authenticated clients cannot bypass user-management permissions through the read model'
);
select ok(
  has_table_privilege('service_role', 'public.user_management_read_model', 'select'),
  'the trusted Edge Function can query the managed-user read model'
);
select ok(
  has_function_privilege('service_role', 'public.create_managed_user_profile(uuid,text,text,text,text,text,bigint,bigint,bigint[])', 'execute')
    and has_function_privilege('service_role', 'public.update_managed_user_profile(bigint,text,text,text,text,bigint,bigint,bigint[])', 'execute')
    and has_function_privilege('service_role', 'public.set_managed_user_active(bigint,boolean)', 'execute')
    and has_function_privilege('service_role', 'public.soft_delete_managed_user(bigint)', 'execute')
    and has_function_privilege('service_role', 'public.rollback_managed_user_create(uuid)', 'execute'),
  'trusted Edge Functions can execute the transactional user-management RPCs'
);
select ok(
  not has_function_privilege('authenticated', 'public.create_managed_user_profile(uuid,text,text,text,text,text,bigint,bigint,bigint[])', 'execute')
    and not has_function_privilege('authenticated', 'public.update_managed_user_profile(bigint,text,text,text,text,bigint,bigint,bigint[])', 'execute')
    and not has_function_privilege('authenticated', 'public.set_managed_user_active(bigint,boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public.soft_delete_managed_user(bigint)', 'execute')
    and not has_function_privilege('authenticated', 'public.rollback_managed_user_create(uuid)', 'execute'),
  'authenticated clients cannot execute server-only user-management RPCs'
);
select ok(
  exists (select 1 from public.permission_catalog where permission_key = 'administration.users.reset_password'),
  'user password reset has a dedicated permission key'
);

select is(
  (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'id'
  ),
  'bigint',
  'business profile IDs remain BIGINT'
);

select is(
  (
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'auth_user_id'
  ),
  'NO',
  'every business profile is linked to a Supabase Auth identity'
);

select is(
  (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'messages'
      and column_name = 'id'
  ),
  'bigint',
  'message IDs remain BIGINT in PostgreSQL'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.profiles'::regclass),
  'profiles has row-level security enabled'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.roles'::regclass),
  'roles has row-level security enabled'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.user_roles'::regclass),
  'user_roles has row-level security enabled'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.role_permissions'::regclass),
  'role_permissions has row-level security enabled'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.messages'::regclass),
  'messages has row-level security enabled'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'select'),
  'anonymous role has no direct profile read grant'
);

select ok(
  not has_table_privilege('anon', 'public.roles', 'select'),
  'anonymous role has no direct role read grant'
);

select ok(
  has_table_privilege('authenticated', 'public.profiles', 'select'),
  'authenticated profile reads are filtered by RLS'
);

select ok(
  not has_table_privilege('anon', 'public.messages', 'select'),
  'anonymous role cannot read inbox messages'
);
select ok(
  has_table_privilege('authenticated', 'public.messages', 'select'),
  'authenticated inbox reads are filtered by recipient RLS'
);
select ok(
  has_column_privilege('authenticated', 'public.messages', 'read_status', 'update'),
  'authenticated recipients may update message read status'
);
select ok(
  not has_column_privilege('authenticated', 'public.messages', 'content', 'update'),
  'authenticated recipients cannot edit message content'
);
select ok(
  not has_table_privilege('authenticated', 'public.messages', 'insert'),
  'authenticated recipients cannot create messages'
);
select ok(
  has_table_privilege('service_role', 'public.messages', 'insert'),
  'trusted server-side code can deliver messages'
);
select ok(
  has_function_privilege('service_role', 'public.bootstrap_first_admin_profile(uuid,text,text,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.bootstrap_first_admin_profile(uuid,text,text,text)', 'execute')
    and not has_function_privilege('anon', 'public.bootstrap_first_admin_profile(uuid,text,text,text)', 'execute'),
  'only the trusted local setup command can initialize the first administrator'
);

select ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'update'),
  'authenticated users can update their display name subject to RLS'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'email', 'update'),
  'authenticated users cannot change the Auth email through the profile table'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'must_reset_password', 'update'),
  'authenticated users cannot clear the forced password-reset marker directly'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'password_reset_requested_at', 'update'),
  'authenticated users cannot write the server-recorded reset request time'
);

select ok(
  not has_schema_privilege('anon', 'app_private', 'usage'),
  'anonymous role cannot access the private authorization schema'
);

select ok(
  has_schema_privilege('authenticated', 'app_private', 'usage'),
  'authenticated role can evaluate private RLS helpers'
);

select ok(
  not has_function_privilege('anon', 'app_private.has_permission(text)', 'execute'),
  'anonymous role cannot call the permission helper'
);

select ok(
  has_function_privilege('authenticated', 'app_private.has_permission(text)', 'execute'),
  'authenticated role can evaluate permission checks used by RLS'
);

select ok(
  has_function_privilege('authenticated', 'app_private.is_password_authenticated()', 'execute'),
  'authenticated role can evaluate the required password-login method'
);

select ok(
  has_function_privilege('authenticated', 'app_private.is_password_recovery_session()', 'execute'),
  'authenticated role can evaluate the password-recovery-only RPC guard'
);

select ok(
  has_function_privilege('authenticated', 'public.current_profile()', 'execute'),
  'authenticated users can read their own profile session through the scoped RPC'
);

select ok(
  not has_function_privilege('anon', 'public.current_profile()', 'execute'),
  'anonymous users cannot call the current profile RPC'
);

select ok(
  not has_function_privilege('authenticated', 'public.resolve_login_identity(text)', 'execute'),
  'authenticated users cannot enumerate login-name-to-email mappings'
);

select ok(
  has_function_privilege('service_role', 'public.resolve_login_identity(text)', 'execute'),
  'only the server-side service role can resolve login identities'
);

select ok(
  not has_function_privilege('authenticated', 'public.mark_password_reset_requested(uuid)', 'execute'),
  'authenticated users cannot create their own reset request marker'
);
select ok(
  has_function_privilege('service_role', 'public.mark_password_reset_requested(uuid)', 'execute'),
  'only the server can record a password-reset request'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'app_private.password_reset_requests'::regclass),
  'private password-reset state has row-level security enabled'
);
select ok(
  not has_table_privilege('authenticated', 'app_private.password_reset_requests', 'select'),
  'authenticated users cannot read the saved Auth password hash'
);

select is(
  (select count(*)::integer from public.roles),
  3,
  'local seed contains the three baseline roles'
);

select is(
  (
    select count(*)::integer
    from public.role_permissions as role_permission
    join public.roles as role on role.id = role_permission.role_id
    where role.code = 'OPERATOR'
  ),
  5,
  'operator receives module read permissions and their own profile access'
);

select ok(
  exists (
    select 1
    from public.role_permissions as role_permission
    join public.roles as role on role.id = role_permission.role_id
    where role.code = 'COMMON_USER'
      and role_permission.permission_key = 'communication.messages.read'
  ),
  'common users receive the message-center read permission'
);

-- The test runner provisions three isolated Auth users before invoking pgTAP.
-- Set caller claims before switching roles; psql \gset prevents UUIDs from
-- appearing in test output.
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from public.profiles where login_name = '__codex_rls_common'),
  true
) as common_claim \gset
select set_config(
  'request.jwt.claims',
  (
    select jsonb_build_object(
      'sub', auth_user_id::text,
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
    from public.profiles as profile where login_name = '__codex_rls_common'
  ),
  true
) as common_claims \gset
set local role authenticated;

select ok(
  app_private.is_password_authenticated(),
  'password-authenticated session is recognized'
);

select results_eq(
  'select id::text from public.profiles order by id',
  $$values ('910000000000001'::text)$$,
  'common user can see only their own profile'
);
select results_eq(
  'select role.code from public.roles as role join public.user_roles as user_role on user_role.role_id = role.id',
  $$values ('COMMON_USER'::text)$$,
  'common user can see only their own role'
);
select results_eq(
  'select receiver_id::text from public.messages order by receiver_id',
  $$values ('910000000000001'::text)$$,
  'common user can read only messages addressed to their business profile'
);
select lives_ok(
  $$update public.messages set read_status = true, read_at = now() where receiver_id = 910000000000001 and read_status = false$$,
  'common user can mark their own message as read'
);
select results_eq(
  'update public.profiles set display_name = ''not allowed'' where id = 910000000000002 returning id::text',
  'select null::text where false',
  'common user cannot update another profile'
);
select results_eq(
  'update public.messages set read_status = true, read_at = now() where receiver_id = 910000000000002 returning id::text',
  'select null::text where false',
  'common user cannot mark another recipient message as read'
);
select lives_ok(
  $$update public.profiles set display_name = 'Common Updated' where id = 910000000000001$$,
  'common user can update their own allowed profile columns'
);
reset role;

select is(
  (select display_name from public.profiles where id = 910000000000002),
  'RLS Operator',
  'denied cross-profile update leaves the other row unchanged'
);
select ok(
  (select read_status from public.messages where receiver_id = 910000000000001),
  'own message read status is updated'
);
select ok(
  not (select read_status from public.messages where receiver_id = 910000000000002),
  'other recipient message read status remains unchanged'
);

-- A valid Supabase email magic-link session must not gain application access.
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from public.profiles where login_name like '__codex_rls_reset_%'),
  true
) as magiclink_claim \gset
select set_config(
  'request.jwt.claims',
  (
    select jsonb_build_object(
      'sub', auth_user_id::text,
      'role', 'authenticated',
      'amr', jsonb_build_array(jsonb_build_object('method', 'magiclink', 'timestamp', 1))
    )::text
    from public.profiles where login_name like '__codex_rls_reset_%'
  ),
  true
) as magiclink_claims \gset
set local role authenticated;

select ok(
  not app_private.is_password_authenticated(),
  'magic-link session is not treated as password authentication'
);
select is(
  (select count(*)::integer from public.profiles),
  0,
  'magic-link session cannot read business profiles'
);
select is(
  (select count(*)::integer from public.messages),
  0,
  'magic-link session cannot read inbox messages'
);
select is(public.current_profile(), null::jsonb, 'magic-link session cannot call the profile RPC');
select is(
  public.current_business_user_id(),
  null::text,
  'magic-link session cannot exchange a legacy business user ID'
);
select ok(
  not app_private.has_permission('communication.messages.read'),
  'magic-link session has no application permissions'
);
select results_eq(
  'update public.profiles set display_name = ''not allowed'' where login_name like ''__codex_rls_reset_%'' returning id::text',
  'select null::text where false',
  'magic-link session cannot update its business profile'
);
select ok(
  not public.complete_password_reset(),
  'magic-link session cannot complete a password reset'
);
reset role;

select is(
  (select must_reset_password from public.profiles where login_name like '__codex_rls_reset_%'),
  true,
  'magic-link session cannot clear the forced-reset marker'
);

-- A recovery session can perform only the password-reset completion RPC. It
-- still cannot read a business profile or derive a business user identity.
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from public.profiles where login_name like '__codex_rls_reset_%'),
  true
) as recovery_claim \gset
select set_config(
  'request.jwt.claims',
  (
    select jsonb_build_object(
      'sub', auth_user_id::text,
      'role', 'authenticated',
      'amr', jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', 1))
    )::text
    from public.profiles where login_name like '__codex_rls_reset_%'
  ),
  true
) as recovery_claims \gset
set local role authenticated;

select ok(
  app_private.is_password_recovery_session(),
  'password-recovery session is recognized for the reset-only RPC'
);
select ok(
  not app_private.is_password_authenticated(),
  'password-recovery session is not treated as application login'
);
select is(public.current_profile(), null::jsonb, 'recovery session cannot call the profile RPC');
select is(
  (select count(*)::integer from public.messages),
  0,
  'recovery session cannot read inbox messages'
);
select is(
  public.current_business_user_id(),
  null::text,
  'recovery session cannot exchange a legacy business user ID'
);
select ok(
  not public.complete_password_reset(),
  'OTP recovery session without a server reset request cannot complete a reset'
);
reset role;

set local role service_role;
select public.mark_password_reset_requested(
  (select auth_user_id from public.profiles where login_name like '__codex_rls_reset_%')
) as reset_marker \gset
reset role;

set local role authenticated;
select ok(
  not public.complete_password_reset(),
  'OTP recovery session cannot clear the forced-reset marker before changing the Auth password'
);
reset role;

update auth.users
set encrypted_password = encrypted_password || '_updated_for_test'
where id = (
  select auth_user_id from public.profiles where login_name like '__codex_rls_reset_%'
);
set local role authenticated;
select ok(
  public.complete_password_reset(),
  'recovery session completes after the Auth password hash changes'
);
reset role;

select is(
  (select must_reset_password from public.profiles where login_name like '__codex_rls_reset_%'),
  false,
  'recovery session clears the forced-reset marker only through its scoped RPC'
);

select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from public.profiles where login_name = '__codex_rls_operator'),
  true
) as operator_claim \gset
select set_config(
  'request.jwt.claims',
  (
    select jsonb_build_object(
      'sub', auth_user_id::text,
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
    from public.profiles as profile where login_name = '__codex_rls_operator'
  ),
  true
) as operator_claims \gset
set local role authenticated;

select ok(
  app_private.has_permission('communication.messages.read'),
  'operator can read the explicitly assigned message module'
);
select ok(
  not app_private.has_permission('administration.users.read'),
  'operator cannot read an unassigned administration module'
);
select is(
  (select count(*)::integer from public.profiles),
  1,
  'operator profile query remains owner-scoped without user-read permission'
);
select is(
  (select count(*)::integer from public.messages),
  1,
  'operator inbox query remains limited to its own messages'
);
select ok(
  not app_private.has_permission('administration.users.create'),
  'operator starts without write permissions'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from public.profiles where login_name = '__codex_rls_super'),
  true
) as super_claim \gset
select set_config(
  'request.jwt.claims',
  (
    select jsonb_build_object(
      'sub', auth_user_id::text,
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
    from public.profiles as profile where login_name = '__codex_rls_super'
  ),
  true
) as super_claims \gset
set local role authenticated;

select ok(
  app_private.has_permission('administration.users.delete'),
  'SUPER_ADMIN receives all permission checks'
);
select is(
  (select count(*)::integer from public.profiles where login_name like '__codex_rls_%'),
  4,
  'SUPER_ADMIN can read all four local fixture profiles'
);
select is(
  (select count(*)::integer from public.messages),
  1,
  'SUPER_ADMIN inbox query remains limited to its own messages'
);
reset role;

select * from finish();
rollback;
