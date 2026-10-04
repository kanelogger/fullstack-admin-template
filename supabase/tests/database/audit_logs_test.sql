begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'login_logs', 'login audit table exists');
select has_table('public', 'operation_logs', 'operation audit table exists');
select has_table('public', 'exception_logs', 'exception audit table exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.login_logs'::regclass)
  and (select relrowsecurity from pg_catalog.pg_class where oid = 'public.operation_logs'::regclass)
  and (select relrowsecurity from pg_catalog.pg_class where oid = 'public.exception_logs'::regclass),
  'all audit log tables enable RLS'
);
select ok(not has_table_privilege('anon', 'public.login_logs', 'select'), 'anonymous callers cannot query login logs');
select ok(not has_table_privilege('authenticated', 'public.login_logs', 'insert'), 'browsers cannot forge login log records');
select ok(not has_table_privilege('authenticated', 'public.operation_logs', 'insert'), 'browsers cannot forge operation log records');
select ok(not has_table_privilege('authenticated', 'public.exception_logs', 'insert'), 'browsers cannot forge exception log records');
select ok(has_table_privilege('service_role', 'public.login_logs', 'insert'), 'trusted Edge Functions can record login events');
select ok(has_table_privilege('service_role', 'public.exception_logs', 'insert'), 'trusted Edge Functions can record exception events');
select ok(
  (select reloptions @> array['security_invoker=true'] from pg_catalog.pg_class where oid = 'public.login_log_read_model'::regclass)
  and (select reloptions @> array['security_invoker=true'] from pg_catalog.pg_class where oid = 'public.operation_log_read_model'::regclass)
  and (select reloptions @> array['security_invoker=true'] from pg_catalog.pg_class where oid = 'public.exception_log_read_model'::regclass),
  'audit read models enforce underlying RLS'
);
select ok(has_table_privilege('authenticated', 'public.login_log_read_model', 'select'), 'authenticated callers can query the login read model');
select ok(has_table_privilege('authenticated', 'public.operation_log_read_model', 'select'), 'authenticated callers can query the operation read model');
select ok(has_table_privilege('authenticated', 'public.exception_log_read_model', 'select'), 'authenticated callers can query the exception read model');
select ok(not has_table_privilege('anon', 'public.login_log_read_model', 'select'), 'anonymous callers cannot query audit read models');
select ok(
  exists (select 1 from public.permission_catalog where permission_key = 'audit.logs.read'),
  'audit read permission is registered'
);
select ok(
  has_function_privilege('service_role', 'public.record_login_attempt(text,bigint,text,text,smallint,text)', 'execute'),
  'service role can record login outcomes'
);
select ok(
  not has_function_privilege('authenticated', 'public.record_login_attempt(text,bigint,text,text,smallint,text)', 'execute'),
  'authenticated users cannot call the login audit writer'
);
select ok(
  has_function_privilege('service_role', 'public.record_exception_event(text,text,text,text,text)', 'execute'),
  'service role can record server exceptions'
);
select ok(
  not has_function_privilege('authenticated', 'public.record_exception_event(text,text,text,text,text)', 'execute'),
  'authenticated users cannot call the exception audit writer'
);

select is(
  public.record_login_attempt(
    'codex-audit-failure', null::bigint, '127.0.0.1', 'audit-test',
    0::smallint, 'INVALID_CREDENTIALS'
  ),
  true,
  'service-side login writer accepts a failed account/password attempt without credentials'
);
select is(
  (select login_result from public.login_logs where login_name = 'codex-audit-failure' order by id desc limit 1),
  0::smallint,
  'failed login result is stored as a constrained status'
);
select ok(
  public.record_exception_event('/functions/v1/audit-test', 'POST', 'HttpFailure', 'sanitized failure', null) ~ '^[1-9][0-9]*$',
  'service-side exception writer returns a text BIGINT ID'
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
        order by allowed_session.authorized_at desc limit 1
      ),
      'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', 1))
    )::text
    from public.profiles as profile where profile.login_name = '__codex_rls_super'
  ),
  true
);
set local role authenticated;
select ok(app_private.has_permission('audit.logs.read'), 'SUPER_ADMIN can read audit logs');
select lives_ok(
  $$update public.profiles set display_name = 'RLS Audit Rename' where login_name = '__codex_rls_super'$$,
  'registered password sessions can update their own profile'
);
select ok(
  exists (
    select 1
    from public.operation_log_read_model as log
    where log.operator_id = (select id::text from public.profiles where login_name = '__codex_rls_super')
      and log.module_code = 'USER'
      and log.operation_type = 'UPDATE'
      and log.request_params->>'recordId' = (select id::text from public.profiles where login_name = '__codex_rls_super')
  ),
  'authenticated mutations are written to the audit trail with text IDs and no row contents'
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
    from public.profiles as profile where profile.login_name = '__codex_rls_operator'
  ),
  true
);
set local role authenticated;
select ok(not app_private.has_permission('audit.logs.read'), 'OPERATOR without audit permission cannot read logs');
select is((select count(*)::integer from public.operation_log_read_model), 0, 'RLS hides operation logs from unauthorized OPERATOR');
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
select ok(not app_private.has_permission('audit.logs.read'), 'COMMON_USER cannot read audit logs');
select is((select count(*)::integer from public.login_log_read_model), 0, 'RLS hides login logs from COMMON_USER');

select * from finish();
rollback;
