begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

select ok(
  has_function_privilege('authenticated', 'public.current_navigation()', 'execute'),
  'registered authenticated sessions can call the navigation RPC'
);
select ok(
  not has_function_privilege('anon', 'public.current_navigation()', 'execute'),
  'anonymous clients cannot call the navigation RPC'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.menus'::regclass),
  'navigation rows remain protected by menu RLS'
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

select ok(app_private.is_password_authenticated(), 'SUPER_ADMIN has a registered password session');
select is(
  jsonb_array_length(public.current_navigation()),
  (select count(*)::integer from public.menus where is_active and is_visible),
  'SUPER_ADMIN receives every active visible navigation row'
);
select ok(
  jsonb_typeof((public.current_navigation()->0)->'id') = 'string',
  'navigation model preserves BIGINT IDs as decimal text'
);
select ok(
  public.current_navigation() @> '[{"routeKey":"administration.users"}]'::jsonb,
  'SUPER_ADMIN navigation includes system routes'
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

select is(jsonb_array_length(public.current_navigation()), 7, 'OPERATOR sees only its authorized seven menu rows');
select ok(public.current_navigation() @> '[{"routeKey":"dashboard.overview"}]'::jsonb, 'OPERATOR sees its authorized dashboard');
select ok(public.current_navigation() @> '[{"routeKey":"communication.messages"}]'::jsonb, 'OPERATOR sees its authorized message center');
select ok(public.current_navigation() @> '[{"routeKey":"operation.attachments"}]'::jsonb, 'OPERATOR sees its authorized attachments module');
select ok(public.current_navigation() @> '[{"routeKey":"account.profile"}]'::jsonb, 'OPERATOR sees their own profile');
select ok(not public.current_navigation() @> '[{"routeKey":"administration.users"}]'::jsonb, 'OPERATOR cannot see user administration');
select ok(not public.current_navigation() @> '[{"kind":"group","path":"/system"}]'::jsonb, 'empty unauthorized menu groups are omitted');
reset role;

select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from public.profiles where login_name = '__codex_rls_common'),
  true
) as common_claim \gset
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
    from public.profiles as profile where profile.login_name = '__codex_rls_common'
  ),
  true
) as common_claims \gset
set local role authenticated;

select is(jsonb_array_length(public.current_navigation()), 5, 'COMMON_USER sees only profile and message navigation branches');
select ok(public.current_navigation() @> '[{"routeKey":"account.profile"}]'::jsonb, 'COMMON_USER sees personal profile');
select ok(public.current_navigation() @> '[{"routeKey":"account.change-password"}]'::jsonb, 'COMMON_USER sees own password settings');
select ok(public.current_navigation() @> '[{"routeKey":"communication.messages"}]'::jsonb, 'COMMON_USER sees own message center');
select ok(not public.current_navigation() @> '[{"routeKey":"dashboard.overview"}]'::jsonb, 'COMMON_USER cannot see dashboard');
select ok(not public.current_navigation() @> '[{"routeKey":"operation.attachments"}]'::jsonb, 'COMMON_USER cannot see attachments');
select ok(public.current_navigation() @> '[{"kind":"group","path":"/operation"}]'::jsonb, 'message group remains because its permitted route is visible');

select * from finish();
rollback;
