begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select ok(
  has_function_privilege('service_role', 'public.import_legacy_dict_types(jsonb,boolean)', 'execute')
  and has_function_privilege('service_role', 'public.import_legacy_dict_items(jsonb,text[],boolean)', 'execute')
  and has_function_privilege('service_role', 'public.import_legacy_system_configs(jsonb,boolean)', 'execute'),
  'trusted service_role can execute all legacy dictionary/config import RPCs'
);
select ok(
  not has_function_privilege('anon', 'public.import_legacy_dict_types(jsonb,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.import_legacy_dict_types(jsonb,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.import_legacy_dict_items(jsonb,text[],boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.import_legacy_dict_items(jsonb,text[],boolean)', 'execute')
  and not has_function_privilege('anon', 'public.import_legacy_system_configs(jsonb,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.import_legacy_system_configs(jsonb,boolean)', 'execute'),
  'browser roles cannot execute server-only legacy import RPCs'
);

select ok(
  not exists (select 1 from public.dict_types where id in (9007199254741001, 9007199254741002))
  and not exists (select 1 from public.dict_items where id in (9007199254741011, 9007199254741012, 9007199254741013))
  and not exists (select 1 from public.system_configs where id in (9007199254741021, 9007199254741022)),
  'reserved high-ID importer fixtures are unused'
);

create temporary table legacy_dictionary_configuration_import_fixture (
  entity text primary key,
  rows jsonb not null,
  source_type_ids text[]
) on commit drop;

insert into legacy_dictionary_configuration_import_fixture (entity, rows, source_type_ids)
values
(
  'types',
  jsonb_build_array(
    jsonb_build_object(
      'id', '9007199254741001',
      'dict_code', 'IMPORT_STATUS',
      'dict_name', '导入状态',
      'status', 1,
      'description', 'source row',
      'created_by', null,
      'created_at', '2026-10-01T03:00:00.000Z',
      'updated_by', null,
      'updated_at', '2026-10-01T04:00:00.000Z',
      'deleted', 0
    ),
    jsonb_build_object(
      'id', '9007199254741002',
      'dict_code', 'IMPORT_DELETED_TYPE',
      'dict_name', '已删除类型',
      'status', 0,
      'description', null,
      'created_by', null,
      'created_at', '2026-10-01T03:00:00.000Z',
      'updated_by', null,
      'updated_at', '2026-10-01T05:00:00.000Z',
      'deleted', 1
    )
  ),
  null
),
(
  'items',
  jsonb_build_array(
    jsonb_build_object(
      'id', '9007199254741011',
      'dict_type_id', '9007199254741001',
      'item_value', 'A',
      'item_label', 'Active A',
      'sort_order', -7,
      'status', 1,
      'description', null,
      'created_by', null,
      'created_at', '2026-10-01T03:00:00.000Z',
      'updated_by', null,
      'updated_at', '2026-10-01T04:00:00.000Z',
      'deleted', 0
    ),
    jsonb_build_object(
      'id', '9007199254741012',
      'dict_type_id', '9007199254741001',
      'item_value', 'a',
      'item_label', 'Deleted a',
      'sort_order', 3,
      'status', 0,
      'description', 'soft deleted source row',
      'created_by', null,
      'created_at', '2026-10-01T03:00:00.000Z',
      'updated_by', null,
      'updated_at', '2026-10-01T06:00:00.000Z',
      'deleted', 1
    ),
    jsonb_build_object(
      'id', '9007199254741013',
      'dict_type_id', '9007199254741002',
      'item_value', 'B',
      'item_label', 'Deleted parent item',
      'sort_order', 0,
      'status', 1,
      'description', null,
      'created_by', null,
      'created_at', '2026-10-01T03:00:00.000Z',
      'updated_by', null,
      'updated_at', '2026-10-01T06:00:00.000Z',
      'deleted', 1
    )
  ),
  array['9007199254741001', '9007199254741002']::text[]
),
(
  'configs',
  jsonb_build_array(
    jsonb_build_object(
      'id', '9007199254741021',
      'config_code', 'IMPORT_CONFIG',
      'config_name', '导入配置',
      'config_value', 'source value',
      'value_type', 'STRING',
      'status', 1,
      'description', null,
      'created_by', null,
      'created_at', '2026-10-01T03:00:00.000Z',
      'updated_by', null,
      'updated_at', '2026-10-01T04:00:00.000Z',
      'deleted', 0
    ),
    jsonb_build_object(
      'id', '9007199254741022',
      'config_code', 'IMPORT_DELETED_CONFIG',
      'config_name', '已删除配置',
      'config_value', 'retained value',
      'value_type', 'BOOLEAN',
      'status', 0,
      'description', 'soft deleted source row',
      'created_by', null,
      'created_at', '2026-10-01T03:00:00.000Z',
      'updated_by', null,
      'updated_at', '2026-10-01T05:00:00.000Z',
      'deleted', 1
    )
  ),
  null
);

grant select on legacy_dictionary_configuration_import_fixture to service_role;
set local role service_role;

select is(
  public.import_legacy_dict_types(
    (select rows from legacy_dictionary_configuration_import_fixture where entity = 'types'),
    false
  ),
  jsonb_build_object('sourceCount', 2, 'alreadyPresentCount', 0, 'rowsToInsert', 2, 'insertedCount', 0),
  'type preview reports planned rows and performs no insert'
);
select is(
  public.import_legacy_dict_items(
    (select rows from legacy_dictionary_configuration_import_fixture where entity = 'items'),
    (select source_type_ids from legacy_dictionary_configuration_import_fixture where entity = 'items'),
    false
  ),
  jsonb_build_object('sourceCount', 3, 'alreadyPresentCount', 0, 'rowsToInsert', 3, 'insertedCount', 0),
  'item preview accepts parent IDs declared in the source type batch before type apply'
);
select is(
  public.import_legacy_system_configs(
    (select rows from legacy_dictionary_configuration_import_fixture where entity = 'configs'),
    false
  ),
  jsonb_build_object('sourceCount', 2, 'alreadyPresentCount', 0, 'rowsToInsert', 2, 'insertedCount', 0),
  'configuration preview reports rows without writing them'
);
select throws_ok(
  $$select public.import_legacy_dict_items(
    (select rows from legacy_dictionary_configuration_import_fixture where entity = 'items'),
    array[]::text[],
    false
  )$$,
  '23503',
  'Legacy dictionary item references an unknown source type ID',
  'item preview rejects a parent missing from both target and source IDs'
);

reset role;
select ok(
  not exists (select 1 from public.dict_types where id in (9007199254741001, 9007199254741002))
  and not exists (select 1 from public.dict_items where id in (9007199254741011, 9007199254741012, 9007199254741013))
  and not exists (select 1 from public.system_configs where id in (9007199254741021, 9007199254741022)),
  'preview calls left all three target tables unchanged'
);
set local role service_role;

select is(
  public.import_legacy_dict_types(
    (select rows from legacy_dictionary_configuration_import_fixture where entity = 'types'),
    true
  ),
  jsonb_build_object('sourceCount', 2, 'alreadyPresentCount', 0, 'rowsToInsert', 2, 'insertedCount', 2),
  'type apply preserves IDs and reports inserted rows'
);
select is(
  public.import_legacy_dict_items(
    (select rows from legacy_dictionary_configuration_import_fixture where entity = 'items'),
    (select source_type_ids from legacy_dictionary_configuration_import_fixture where entity = 'items'),
    true
  ),
  jsonb_build_object('sourceCount', 3, 'alreadyPresentCount', 0, 'rowsToInsert', 3, 'insertedCount', 3),
  'item apply succeeds after its parent type batch has been applied'
);
select is(
  public.import_legacy_system_configs(
    (select rows from legacy_dictionary_configuration_import_fixture where entity = 'configs'),
    true
  ),
  jsonb_build_object('sourceCount', 2, 'alreadyPresentCount', 0, 'rowsToInsert', 2, 'insertedCount', 2),
  'configuration apply preserves source rows'
);

select is(
  public.import_legacy_dict_types(
    (select rows from legacy_dictionary_configuration_import_fixture where entity = 'types'),
    true
  ),
  jsonb_build_object('sourceCount', 2, 'alreadyPresentCount', 2, 'rowsToInsert', 0, 'insertedCount', 0),
  'type apply is idempotent for identical source rows'
);
select is(
  public.import_legacy_dict_items(
    (select rows from legacy_dictionary_configuration_import_fixture where entity = 'items'),
    (select source_type_ids from legacy_dictionary_configuration_import_fixture where entity = 'items'),
    true
  ),
  jsonb_build_object('sourceCount', 3, 'alreadyPresentCount', 3, 'rowsToInsert', 0, 'insertedCount', 0),
  'item apply is idempotent for identical source rows'
);
select is(
  public.import_legacy_system_configs(
    (select rows from legacy_dictionary_configuration_import_fixture where entity = 'configs'),
    true
  ),
  jsonb_build_object('sourceCount', 2, 'alreadyPresentCount', 2, 'rowsToInsert', 0, 'insertedCount', 0),
  'configuration apply is idempotent for identical source rows'
);

select throws_ok(
  $$select public.import_legacy_dict_types(
    jsonb_build_array(jsonb_set(
      (select rows->0 from legacy_dictionary_configuration_import_fixture where entity = 'types'),
      '{dict_name}', '"Changed"'
    )),
    false
  )$$,
  '23505',
  'Legacy dictionary type ID conflicts with existing content',
  'same type ID with different data is rejected'
);
select throws_ok(
  $$select public.import_legacy_dict_types(
    jsonb_build_array(jsonb_set(
      (select rows->0 from legacy_dictionary_configuration_import_fixture where entity = 'types'),
      '{id}', '"9007199254741099"'
    )),
    false
  )$$,
  '23505',
  'Legacy dictionary type code conflicts under target collation',
  'case-insensitive type code conflicts are rejected'
);
select throws_ok(
  $$select public.import_legacy_dict_items(
    jsonb_build_array(jsonb_set(
      (select rows->0 from legacy_dictionary_configuration_import_fixture where entity = 'items'),
      '{item_label}', '"Changed"'
    )),
    (select source_type_ids from legacy_dictionary_configuration_import_fixture where entity = 'items'),
    false
  )$$,
  '23505',
  'Legacy dictionary item ID conflicts with existing content',
  'same dictionary item ID with different data is rejected'
);
select throws_ok(
  $$select public.import_legacy_dict_items(
    jsonb_build_array(jsonb_set(
      (select rows->0 from legacy_dictionary_configuration_import_fixture where entity = 'items'),
      '{id}', '"9007199254741098"'
    )),
    (select source_type_ids from legacy_dictionary_configuration_import_fixture where entity = 'items'),
    false
  )$$,
  '23505',
  'Legacy dictionary item value conflicts under target collation',
  'case-insensitive item values conflict only within matching deleted state'
);
select throws_ok(
  $$select public.import_legacy_system_configs(
    jsonb_build_array(jsonb_set(
      (select rows->0 from legacy_dictionary_configuration_import_fixture where entity = 'configs'),
      '{config_value}', '"Changed"'
    )),
    false
  )$$,
  '23505',
  'Legacy system configuration ID conflicts with existing content',
  'same configuration ID with different data is rejected'
);
select throws_ok(
  $$select public.import_legacy_system_configs(
    jsonb_build_array(jsonb_set(
      (select rows->0 from legacy_dictionary_configuration_import_fixture where entity = 'configs'),
      '{id}', '"9007199254741097"'
    )),
    false
  )$$,
  '23505',
  'Legacy system configuration code conflicts under target collation',
  'case-insensitive configuration code conflicts are rejected'
);
select throws_ok(
  $$select public.import_legacy_dict_types(
    (select jsonb_agg(jsonb_build_object(
      'id', '1', 'dict_code', 'code-' || source.id::text, 'dict_name', 'name',
      'status', 1, 'description', null, 'created_by', null, 'created_at', '2026-10-01T00:00:00Z',
      'updated_by', null, 'updated_at', '2026-10-01T00:00:00Z', 'deleted', 0
    )) from generate_series(1, 101) as source(id)),
    false
  )$$,
  '22023',
  'Legacy import batches cannot exceed 100 rows',
  'each source batch is capped at 100 rows'
);

reset role;

select ok(
  (select dict_code from public.dict_types where id = 9007199254741001) = 'IMPORT_STATUS'
  and (select deleted_at = updated_at from public.dict_types where id = 9007199254741002),
  'type IDs and source soft-delete timestamps are preserved'
);
select ok(
  (select dict_type_id = 9007199254741001 and sort_order = -7 from public.dict_items where id = 9007199254741011)
  and (select deleted_at = updated_at from public.dict_items where id = 9007199254741012),
  'item parent IDs, signed sort order and source soft-delete timestamps are preserved'
);
select ok(
  (select config_value = 'source value' from public.system_configs where id = 9007199254741021)
  and (select deleted_at = updated_at from public.system_configs where id = 9007199254741022),
  'configuration values and source soft-delete timestamps are preserved'
);
select ok(
  (select last_value >= 9007199254741002 from public.dict_types_id_seq)
  and (select last_value >= 9007199254741013 from public.dict_items_id_seq)
  and (select last_value >= 9007199254741022 from public.system_configs_id_seq),
  'apply advances all identity sequences beyond imported BIGINT IDs'
);

delete from public.dict_items where id in (9007199254741011, 9007199254741012, 9007199254741013);
delete from public.dict_types where id in (9007199254741001, 9007199254741002);
delete from public.system_configs where id in (9007199254741021, 9007199254741022);
select pg_catalog.setval(pg_catalog.pg_get_serial_sequence('public.dict_types', 'id'),
  coalesce((select max(id) from public.dict_types), 1),
  exists(select 1 from public.dict_types));
select pg_catalog.setval(pg_catalog.pg_get_serial_sequence('public.dict_items', 'id'),
  coalesce((select max(id) from public.dict_items), 1),
  exists(select 1 from public.dict_items));
select pg_catalog.setval(pg_catalog.pg_get_serial_sequence('public.system_configs', 'id'),
  coalesce((select max(id) from public.system_configs), 1),
  exists(select 1 from public.system_configs));

select * from finish();
rollback;
