begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(has_function_privilege('authenticated', 'public.dashboard_overview()', 'execute'), 'authenticated callers can invoke the dashboard RPC');
select ok(not has_function_privilege('anon', 'public.dashboard_overview()', 'execute'), 'anonymous callers cannot invoke the dashboard RPC');
select ok(not has_function_privilege('service_role', 'public.dashboard_overview()', 'execute'), 'service role does not use the caller-scoped dashboard RPC');

insert into public.operation_logs (
  operator_id, operator_name, module_code, operation_type, request_method,
  request_path, request_params, operation_result
)
values
  ('910000000000003', 'Audit SUPER', 'TEST', 'SUPER_EVENT', 'PATCH', '/test/super', '{"recordId":"3"}', 1),
  ('910000000000002', 'Audit OPERATOR', 'TEST', 'OPERATOR_EVENT', 'PATCH', '/test/operator', '{"recordId":"2"}', 1);

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
        order by allowed_session.authorized_at desc limit 1
      ),
      'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', 1))
    )::text
    from public.profiles as profile where profile.login_name = '__codex_rls_super'
  ),
  true
);
set local role authenticated;
select is(public.dashboard_overview()->>'todoCount', '0', 'dashboard keeps the existing empty todo count');
select ok((public.dashboard_overview()->>'unreadMessageCount')::integer >= 0, 'dashboard returns only an integer inbox count');
select ok(jsonb_typeof(public.dashboard_overview()->'announcements') = 'array', 'dashboard returns an announcement list');
select ok(jsonb_typeof(public.dashboard_overview()->'recentOperations') = 'array', 'dashboard returns recent activity');
select ok(
  exists (
    select 1 from jsonb_array_elements(public.dashboard_overview()->'recentOperations') as item(value)
    where item.value->>'operationType' = 'SUPER_EVENT'
  )
  and exists (
    select 1 from jsonb_array_elements(public.dashboard_overview()->'recentOperations') as item(value)
    where item.value->>'operationType' = 'OPERATOR_EVENT'
  ),
  'SUPER_ADMIN may view recent activity across authorized modules'
);
select ok(jsonb_typeof(public.dashboard_overview()->'adminStats') = 'object', 'SUPER_ADMIN receives authorized system metrics');
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
        order by allowed_session.authorized_at desc limit 1
      ),
      'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', 1))
    )::text
    from public.profiles as profile where profile.login_name = '__codex_rls_operator'
  ),
  true
);
set local role authenticated;
select is(public.dashboard_overview()->>'todoCount', '0', 'OPERATOR with dashboard permission can load the overview');
select ok(public.dashboard_overview()->'adminStats' = 'null'::jsonb, 'OPERATOR without system or audit permissions receives no admin metrics');
select is(
  jsonb_array_length(public.dashboard_overview()->'recentOperations'),
  1,
  'OPERATOR sees only their own recent operations without audit permission'
);
select is(
  (public.dashboard_overview()->'recentOperations'->0)->>'operationType',
  'OPERATOR_EVENT',
  'dashboard does not leak another operator activity'
);
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
        order by allowed_session.authorized_at desc limit 1
      ),
      'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', 1))
    )::text
    from public.profiles as profile where profile.login_name = '__codex_rls_common'
  ),
  true
);
set local role authenticated;
select throws_ok(
  $$select public.dashboard_overview()$$,
  '42501',
  'Dashboard read permission is required',
  'COMMON_USER cannot invoke an unauthorized dashboard'
);

select * from finish();
rollback;
