begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_table('public', 'dict_types', 'dictionary type table exists');
select has_table('public', 'dict_items', 'dictionary item table exists');
select has_table('public', 'system_configs', 'system configuration table exists');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.dict_types'::regclass), 'dictionary types enable RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.dict_items'::regclass), 'dictionary items enable RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.system_configs'::regclass), 'system configuration enables RLS');

select ok(
  not has_table_privilege('anon', 'public.dict_types', 'select')
  and not has_table_privilege('anon', 'public.dict_items', 'select')
  and not has_table_privilege('anon', 'public.system_configs', 'select'),
  'anonymous clients cannot read any configuration tables'
);
select ok(
  not has_table_privilege('authenticated', 'public.dict_types', 'select')
  and not has_table_privilege('authenticated', 'public.dict_items', 'select')
  and not has_table_privilege('authenticated', 'public.system_configs', 'select'),
  'clients use permission-checked read RPCs and cannot receive raw BIGINT columns'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_dictionary_types(text,text,smallint,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_dictionary_items(text)', 'execute')
  and has_function_privilege('authenticated', 'public.save_dictionary_type(text,text,text,smallint,text)', 'execute')
  and has_function_privilege('authenticated', 'public.save_dictionary_item(text,text,text,text,integer,smallint,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_system_configurations(text,text,smallint,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.save_system_configuration(text,text,text,text,text,smallint,text)', 'execute'),
  'authenticated clients can invoke the narrowly scoped module RPCs'
);
select ok(
  not has_function_privilege('anon', 'public.admin_dictionary_types(text,text,smallint,integer,integer)', 'execute')
  and not has_function_privilege('anon', 'public.save_dictionary_type(text,text,text,smallint,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_system_configurations(text,text,smallint,integer,integer)', 'execute')
  and not has_function_privilege('anon', 'public.save_system_configuration(text,text,text,text,text,smallint,text)', 'execute'),
  'anonymous clients cannot invoke configuration RPCs'
);
select ok(
  exists (select 1 from public.permission_catalog where permission_key = 'configuration.dictionaries.read')
  and exists (select 1 from public.permission_catalog where permission_key = 'configuration.dictionaries.create')
  and exists (select 1 from public.permission_catalog where permission_key = 'configuration.dictionaries.update')
  and exists (select 1 from public.permission_catalog where permission_key = 'configuration.dictionaries.delete')
  and exists (select 1 from public.permission_catalog where permission_key = 'configuration.system.read')
  and exists (select 1 from public.permission_catalog where permission_key = 'configuration.system.update'),
  'migration registers all dictionary and configuration permission keys idempotently'
);

-- A high-valued fixture proves the JSON boundary never rounds BIGINT IDs.
insert into public.dict_types (id, dict_code, dict_name)
values (9007199254740993, 'Codex_BigInt_Dictionary', 'BIGINT 字典类型');

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
select is(
  (
    select payload->>'id'
    from jsonb_array_elements(public.admin_dictionary_types(null, null, null, 1, 100)->'items') as entry(payload)
    where payload->>'dictCode' = 'Codex_BigInt_Dictionary'
  ),
  '9007199254740993',
  'dictionary type catalog preserves IDs above JavaScript safe integer range'
);
select lives_ok(
  $$select public.save_dictionary_type(null, 'CODEX_DICTIONARY_TEST', 'Codex Dictionary Test', 1::smallint, null)$$,
  'SUPER_ADMIN can create a dictionary type'
);
select throws_ok(
  $$select public.save_dictionary_type(null, 'codex_dictionary_test', 'Duplicate Code', 1::smallint, null)$$,
  '23505',
  'duplicate key value violates unique constraint "dict_types_code_legacy_ci_uidx"',
  'dictionary type codes remain case-insensitive like MySQL utf8mb4_unicode_ci'
);
select lives_ok(
  $$select public.save_dictionary_item(
    null,
    (select payload->>'id' from jsonb_array_elements(public.admin_dictionary_types('CODEX_DICTIONARY_TEST', null, null, 1, 10)->'items') as entry(payload) limit 1),
    'ENABLED', '已启用', 0, 1::smallint, null
  )$$,
  'SUPER_ADMIN can create a dictionary item'
);
select lives_ok(
  $$select public.save_dictionary_item(
    null,
    (select payload->>'id' from jsonb_array_elements(public.admin_dictionary_types('CODEX_DICTIONARY_TEST', null, null, 1, 10)->'items') as entry(payload) limit 1),
    'DISABLED', '已停用', 1, 0::smallint, null
  )$$,
  'dictionary items retain their status flag'
);
select throws_ok(
  $$select public.save_dictionary_item(
    null,
    (select payload->>'id' from jsonb_array_elements(public.admin_dictionary_types('CODEX_DICTIONARY_TEST', null, null, 1, 10)->'items') as entry(payload) limit 1),
    'enabled', '重复值', 2, 1::smallint, null
  )$$,
  '23505',
  'duplicate key value violates unique constraint "dict_items_active_type_value_uidx"',
  'dictionary item values remain case-insensitive within one type'
);
select is(
  jsonb_array_length(public.admin_dictionary_items((select payload->>'id' from jsonb_array_elements(public.admin_dictionary_types('CODEX_DICTIONARY_TEST', null, null, 1, 10)->'items') as entry(payload) limit 1))),
  2,
  'item catalog includes enabled and disabled, non-deleted rows'
);
select ok(
  jsonb_typeof((public.admin_dictionary_items((select payload->>'id' from jsonb_array_elements(public.admin_dictionary_types('CODEX_DICTIONARY_TEST', null, null, 1, 10)->'items') as entry(payload) limit 1))->0)->'id') = 'string',
  'dictionary item read model serializes BIGINT IDs as text'
);
select is(
  jsonb_array_length(public.dictionary_options('codex_dictionary_test', true)),
  1,
  'options preserve case-insensitive type lookup and filter disabled values by default'
);
select is(
  jsonb_array_length(public.dictionary_options('CODEX_DICTIONARY_TEST', false)),
  2,
  'options can include disabled values when explicitly requested'
);
select lives_ok(
  $$select public.replace_dictionary_item_order(
    (select payload->>'id' from jsonb_array_elements(public.admin_dictionary_types('CODEX_DICTIONARY_TEST', null, null, 1, 10)->'items') as entry(payload) limit 1),
    jsonb_build_array(
      jsonb_build_object('id', (
        select item->>'id' from jsonb_array_elements(public.admin_dictionary_items(
          (select payload->>'id' from jsonb_array_elements(public.admin_dictionary_types('CODEX_DICTIONARY_TEST', null, null, 1, 10)->'items') as type_entry(payload) limit 1)
        )) as item_entry(item) where item->>'itemValue' = 'ENABLED'
      ), 'sortOrder', 8),
      jsonb_build_object('id', (
        select item->>'id' from jsonb_array_elements(public.admin_dictionary_items(
          (select payload->>'id' from jsonb_array_elements(public.admin_dictionary_types('CODEX_DICTIONARY_TEST', null, null, 1, 10)->'items') as type_entry(payload) limit 1)
        )) as item_entry(item) where item->>'itemValue' = 'DISABLED'
      ), 'sortOrder', 2)
    )
  )$$,
  'item order replacement is atomic and accepts the complete type item set'
);
select results_eq(
  $$select (payload->>'itemValue') || ':' || (payload->>'sortOrder')
    from jsonb_array_elements(public.admin_dictionary_items(
      (select type_row->>'id' from jsonb_array_elements(public.admin_dictionary_types('CODEX_DICTIONARY_TEST', null, null, 1, 10)->'items') as type_entry(type_row) limit 1)
    )) as entry(payload)
    order by (payload->>'sortOrder')::integer, payload->>'id'$$,
  $$values ('DISABLED:2'::text), ('ENABLED:8'::text)$$,
  'sort order is persisted in deterministic order'
);
select throws_ok(
  $$select public.soft_delete_dictionary_type(
    (select payload->>'id' from jsonb_array_elements(public.admin_dictionary_types('CODEX_DICTIONARY_TEST', null, null, 1, 10)->'items') as entry(payload) limit 1)
  )$$,
  '23503',
  'Dictionary type contains active items',
  'a dictionary type cannot be deleted while it has an enabled item'
);
select lives_ok(
  $$select public.soft_delete_dictionary_item(
    (select item->>'id' from jsonb_array_elements(public.admin_dictionary_items(
      (select type_row->>'id' from jsonb_array_elements(public.admin_dictionary_types('CODEX_DICTIONARY_TEST', null, null, 1, 10)->'items') as type_entry(type_row) limit 1)
    )) as item_entry(item) where item->>'itemValue' = 'ENABLED')
  )$$,
  'dictionary items use soft deletion'
);
select lives_ok(
  $$select public.soft_delete_dictionary_type(
    (select payload->>'id' from jsonb_array_elements(public.admin_dictionary_types('CODEX_DICTIONARY_TEST', null, null, 1, 10)->'items') as entry(payload) limit 1)
  )$$,
  'type deletion succeeds after all enabled items are removed or disabled'
);
select is(
  jsonb_array_length(public.admin_dictionary_types('CODEX_DICTIONARY_TEST', null, null, 1, 10)->'items'),
  0,
  'soft-deleted dictionary types disappear from active query results'
);

select lives_ok(
  $$select public.save_system_configuration(null, 'Codex.Config.Name', 'Codex Name', 'Test Console', 'STRING', 1::smallint, null)$$,
  'SUPER_ADMIN can create a system configuration'
);
select throws_ok(
  $$select public.save_system_configuration(null, 'codex.config.name', 'Duplicate Code', 'value', 'STRING', 1::smallint, null)$$,
  '23505',
  'duplicate key value violates unique constraint "system_configs_code_legacy_ci_uidx"',
  'system configuration codes remain case-insensitive like MySQL utf8mb4_unicode_ci'
);
select is(
  public.system_configuration_value('CODEX.CONFIG.NAME')->>'configValue',
  'Test Console',
  'active system configuration values can be looked up by a case-insensitive code'
);
select is(
  jsonb_typeof((public.admin_system_configurations(null, null, null, 1, 100)->'items'->0)->'id'),
  'string',
  'configuration read model serializes BIGINT IDs as text'
);
select lives_ok(
  $$select public.save_system_configuration(
    (select payload->>'id' from jsonb_array_elements(public.admin_system_configurations('Codex.Config.Name', null, null, 1, 10)->'items') as entry(payload) limit 1),
    'codex.config.name', 'Codex Name Updated', 'Console Updated', 'STRING', 0::smallint, 'Changed'
  )$$,
  'configuration codes may be stored in another case without creating a duplicate'
);
select is(
  jsonb_array_length(public.admin_system_configurations('CODEX.CONFIG.NAME', null, null, 1, 10)->'items'),
  1,
  'case-insensitive configuration code update preserves a single record'
);
select throws_ok(
  $$select public.system_configuration_value('CODEX.CONFIG.NAME')$$,
  'P0002',
  'Configuration was not found or is disabled',
  'disabled configuration values are not returned'
);
select lives_ok(
  $$select public.soft_delete_system_configuration(
    (select payload->>'id' from jsonb_array_elements(public.admin_system_configurations('codex.config.name', null, null, 1, 10)->'items') as entry(payload) limit 1)
  )$$,
  'system configuration uses soft deletion'
);
select is(
  (
    select count(*)::integer from jsonb_array_elements(public.admin_system_configurations('Codex.Config.Name', null, null, 1, 10)->'items')
  ),
  0,
  'soft-deleted configuration rows disappear from active listings'
);

reset role;

insert into public.role_permissions (role_id, permission_key)
select role.id, permission.permission_key
from public.roles as role
join public.permission_catalog as permission
  on permission.permission_key in (
    'configuration.dictionaries.read',
    'configuration.system.read'
  )
where role.code = 'OPERATOR'
on conflict (role_id, permission_key) do nothing;

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

select throws_ok(
  $$select public.save_dictionary_type(null, 'CODEX_OPERATOR_DENIED', 'Denied', 1::smallint, null)$$,
  '42501',
  'Configuration permission is required',
  'OPERATOR with dictionary read access still cannot create without the create key'
);
select is(
  jsonb_typeof(public.admin_dictionary_types(null, null, null, 1, 10)->'items'),
  'array',
  'OPERATOR can read dictionary rows when granted the dictionary read key'
);
select throws_ok(
  $$select public.save_dictionary_item(null, '9007199254740993', 'CODEX_DENIED', 'Denied', 0, 1::smallint, null)$$,
  '42501',
  'Configuration permission is required',
  'OPERATOR cannot create dictionary items without the create key'
);
select throws_ok(
  $$select public.save_system_configuration(null, 'CODEX_DENIED', 'Denied', 'value', 'STRING', 1::smallint, null)$$,
  '42501',
  'Configuration permission is required',
  'OPERATOR with configuration read access still cannot write without the update key'
);
select is(
  jsonb_typeof(public.admin_system_configurations(null, null, null, 1, 10)->'items'),
  'array',
  'OPERATOR can read configuration rows when granted the configuration read key'
);

reset role;
select * from finish();
rollback;
