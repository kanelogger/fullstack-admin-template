-- Trusted, chunked, idempotent import APIs for legacy dictionary/config rows.
-- The importer passes BIGINT and actor IDs as decimal strings and explicit
-- timezone-offset timestamps. Preview mode performs no writes or sequence changes.

create function app_private.assert_legacy_import_batch(p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  row_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Legacy import rows must be a JSON array';
  end if;
  row_count := jsonb_array_length(p_rows);
  if row_count > 100 then
    raise exception using errcode = '22023', message = 'Legacy import batches cannot exceed 100 rows';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) as source(row)
    where jsonb_typeof(source.row) is distinct from 'object'
  ) then
    raise exception using errcode = '22023', message = 'Legacy import rows must be JSON objects';
  end if;
  return row_count;
end;
$$;

create function app_private.parse_legacy_import_timestamp(p_value text, p_column text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception using errcode = '22023', message = 'Legacy timestamp must include an explicit timezone offset';
  end if;
  return p_value::timestamptz;
exception
  when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22007', message = 'Legacy timestamp is invalid in ' || p_column;
end;
$$;

create function app_private.resolve_legacy_actor_id(p_actor_id text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result bigint;
begin
  if p_actor_id is null then return null; end if;
  if p_actor_id !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'Legacy actor ID must be a decimal BIGINT string';
  end if;
  if p_actor_id::numeric > 9223372036854775807 then
    raise exception using errcode = '22003', message = 'Legacy actor ID exceeds PostgreSQL BIGINT';
  end if;
  result := p_actor_id::bigint;
  if not exists (select 1 from public.profiles as profile where profile.id = result) then
    raise exception using errcode = '23503', message = 'Legacy actor profile must be imported before configuration data';
  end if;
  return result;
end;
$$;

revoke all on function app_private.assert_legacy_import_batch(jsonb),
  app_private.parse_legacy_import_timestamp(text, text),
  app_private.resolve_legacy_actor_id(text)
  from public, anon, authenticated, service_role;

create function public.import_legacy_dict_types(p_rows jsonb, p_apply boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_count integer;
  already_count integer := 0;
  rows_to_insert integer := 0;
  inserted_count integer := 0;
  source_row record;
  existing_row public.dict_types%rowtype;
  source_created_at timestamptz;
  source_updated_at timestamptz;
  source_created_by bigint;
  source_updated_by bigint;
  maximum_id bigint;
begin
  if p_apply is null then
    raise exception using errcode = '22023', message = 'Apply mode must be explicit';
  end if;
  source_count := app_private.assert_legacy_import_batch(p_rows);
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as source(row)
    where not (source.row ?& array[
      'id', 'dict_code', 'dict_name', 'status', 'description', 'created_by',
      'created_at', 'updated_by', 'updated_at', 'deleted'
    ])
      or jsonb_typeof(source.row->'id') is distinct from 'string'
      or jsonb_typeof(source.row->'dict_code') is distinct from 'string'
      or jsonb_typeof(source.row->'dict_name') is distinct from 'string'
      or jsonb_typeof(source.row->'status') is distinct from 'number'
      or jsonb_typeof(source.row->'description') not in ('string', 'null')
      or jsonb_typeof(source.row->'created_by') not in ('string', 'null')
      or jsonb_typeof(source.row->'created_at') is distinct from 'string'
      or jsonb_typeof(source.row->'updated_by') not in ('string', 'null')
      or jsonb_typeof(source.row->'updated_at') is distinct from 'string'
      or jsonb_typeof(source.row->'deleted') is distinct from 'number'
  ) then
    raise exception using errcode = '22023', message = 'Legacy dictionary type row fields are invalid';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text, dict_code text, dict_name text, status smallint, description text,
      created_by text, created_at text, updated_by text, updated_at text, deleted smallint
    )
    where coalesce(source.id, '') !~ '^[1-9][0-9]*$'
      or case when source.id ~ '^[1-9][0-9]*$'
        then source.id::numeric > 9223372036854775807 else false end
      or nullif(trim(source.dict_code), '') is null or length(source.dict_code) > 64
      or nullif(trim(source.dict_name), '') is null or length(source.dict_name) > 128
      or source.status not in (0, 1)
      or coalesce(length(source.description), 0) > 255
      or source.deleted not in (0, 1)
  ) then
    raise exception using errcode = '22023', message = 'Legacy dictionary type fields exceed target constraints';
  end if;

  if (select count(distinct source.id)::integer
      from jsonb_to_recordset(p_rows) as source(id text)) <> source_count then
    raise exception using errcode = '22023', message = 'Legacy dictionary type batch contains duplicate IDs';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(dict_code text)
    group by source.dict_code collate app_private.legacy_utf8mb4_unicode_ci
    having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'Legacy dictionary type batch contains a collation conflict';
  end if;

  for source_row in
    select * from jsonb_to_recordset(p_rows) as source(
      id text, dict_code text, dict_name text, status smallint, description text,
      created_by text, created_at text, updated_by text, updated_at text, deleted smallint
    )
  loop
    source_created_at := app_private.parse_legacy_import_timestamp(source_row.created_at, 'created_at');
    source_updated_at := app_private.parse_legacy_import_timestamp(source_row.updated_at, 'updated_at');
    source_created_by := app_private.resolve_legacy_actor_id(source_row.created_by);
    source_updated_by := app_private.resolve_legacy_actor_id(source_row.updated_by);

    select * into existing_row
    from public.dict_types as target
    where target.id = source_row.id::bigint;
    if found then
      if existing_row.dict_code is distinct from source_row.dict_code
        or existing_row.dict_name is distinct from source_row.dict_name
        or existing_row.status is distinct from source_row.status
        or existing_row.description is distinct from source_row.description
        or existing_row.created_by is distinct from source_created_by
        or existing_row.created_at is distinct from source_created_at
        or existing_row.updated_by is distinct from source_updated_by
        or existing_row.updated_at is distinct from source_updated_at
        or existing_row.deleted_at is distinct from (
          case when source_row.deleted = 1 then source_updated_at else null::timestamptz end
        ) then
        raise exception using errcode = '23505', message = 'Legacy dictionary type ID conflicts with existing content';
      end if;
      already_count := already_count + 1;
      continue;
    end if;

    if exists (
      select 1 from public.dict_types as target
      where target.dict_code collate app_private.legacy_utf8mb4_unicode_ci
        = source_row.dict_code collate app_private.legacy_utf8mb4_unicode_ci
    ) then
      raise exception using errcode = '23505', message = 'Legacy dictionary type code conflicts under target collation';
    end if;

    rows_to_insert := rows_to_insert + 1;
    if p_apply then
      insert into public.dict_types (
        id, dict_code, dict_name, status, description, created_by, created_at,
        updated_by, updated_at, deleted_at
      ) values (
        source_row.id::bigint, source_row.dict_code, source_row.dict_name, source_row.status,
        source_row.description, source_created_by, source_created_at,
        source_updated_by, source_updated_at,
        case when source_row.deleted = 1 then source_updated_at else null::timestamptz end
      );
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  if p_apply then
    select max(id) into maximum_id from public.dict_types;
    perform pg_catalog.setval(
      pg_catalog.pg_get_serial_sequence('public.dict_types', 'id'),
      coalesce(maximum_id, 1),
      maximum_id is not null
    );
  end if;
  return jsonb_build_object(
    'sourceCount', source_count,
    'alreadyPresentCount', already_count,
    'rowsToInsert', rows_to_insert,
    'insertedCount', inserted_count
  );
end;
$$;
create function public.import_legacy_dict_items(
  p_rows jsonb,
  p_source_type_ids text[],
  p_apply boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_count integer;
  already_count integer := 0;
  rows_to_insert integer := 0;
  inserted_count integer := 0;
  source_row record;
  existing_row public.dict_items%rowtype;
  source_created_at timestamptz;
  source_updated_at timestamptz;
  source_created_by bigint;
  source_updated_by bigint;
  source_type_id bigint;
  maximum_id bigint;
begin
  if p_apply is null then
    raise exception using errcode = '22023', message = 'Apply mode must be explicit';
  end if;
  source_count := app_private.assert_legacy_import_batch(p_rows);
  if cardinality(coalesce(p_source_type_ids, array[]::text[])) > 1000 then
    raise exception using errcode = '22023', message = 'Legacy source type ID list cannot exceed 1000 rows';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_source_type_ids, array[]::text[])) as source(type_id)
    where coalesce(source.type_id, '') !~ '^[1-9][0-9]*$'
      or case when source.type_id ~ '^[1-9][0-9]*$'
        then source.type_id::numeric > 9223372036854775807 else false end
  ) or (
    select count(distinct source.type_id)::integer
    from unnest(coalesce(p_source_type_ids, array[]::text[])) as source(type_id)
  ) <> cardinality(coalesce(p_source_type_ids, array[]::text[])) then
    raise exception using errcode = '22023', message = 'Legacy source type IDs must be unique decimal BIGINT strings';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as source(row)
    where not (source.row ?& array[
      'id', 'dict_type_id', 'item_value', 'item_label', 'sort_order', 'status',
      'description', 'created_by', 'created_at', 'updated_by', 'updated_at', 'deleted'
    ])
      or jsonb_typeof(source.row->'id') is distinct from 'string'
      or jsonb_typeof(source.row->'dict_type_id') is distinct from 'string'
      or jsonb_typeof(source.row->'item_value') is distinct from 'string'
      or jsonb_typeof(source.row->'item_label') is distinct from 'string'
      or jsonb_typeof(source.row->'sort_order') is distinct from 'number'
      or jsonb_typeof(source.row->'status') is distinct from 'number'
      or jsonb_typeof(source.row->'description') not in ('string', 'null')
      or jsonb_typeof(source.row->'created_by') not in ('string', 'null')
      or jsonb_typeof(source.row->'created_at') is distinct from 'string'
      or jsonb_typeof(source.row->'updated_by') not in ('string', 'null')
      or jsonb_typeof(source.row->'updated_at') is distinct from 'string'
      or jsonb_typeof(source.row->'deleted') is distinct from 'number'
  ) then
    raise exception using errcode = '22023', message = 'Legacy dictionary item row fields are invalid';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text, dict_type_id text, item_value text, item_label text, sort_order integer,
      status smallint, description text, created_by text, created_at text,
      updated_by text, updated_at text, deleted smallint
    )
    where coalesce(source.id, '') !~ '^[1-9][0-9]*$'
      or case when source.id ~ '^[1-9][0-9]*$'
        then source.id::numeric > 9223372036854775807 else false end
      or coalesce(source.dict_type_id, '') !~ '^[1-9][0-9]*$'
      or case when source.dict_type_id ~ '^[1-9][0-9]*$'
        then source.dict_type_id::numeric > 9223372036854775807 else false end
      or nullif(trim(source.item_value), '') is null or length(source.item_value) > 64
      or nullif(trim(source.item_label), '') is null or length(source.item_label) > 128
      or source.sort_order < -2147483648
      or source.status not in (0, 1)
      or coalesce(length(source.description), 0) > 255
      or source.deleted not in (0, 1)
  ) then
    raise exception using errcode = '22023', message = 'Legacy dictionary item fields exceed target constraints';
  end if;

  if (select count(distinct source.id)::integer
      from jsonb_to_recordset(p_rows) as source(id text)) <> source_count then
    raise exception using errcode = '22023', message = 'Legacy dictionary item batch contains duplicate IDs';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      dict_type_id text, item_value text, deleted smallint
    )
    group by source.dict_type_id::bigint,
      source.item_value collate app_private.legacy_utf8mb4_unicode_ci,
      source.deleted
    having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'Legacy dictionary item batch contains a collation conflict';
  end if;

  for source_row in
    select * from jsonb_to_recordset(p_rows) as source(
      id text, dict_type_id text, item_value text, item_label text, sort_order integer,
      status smallint, description text, created_by text, created_at text,
      updated_by text, updated_at text, deleted smallint
    )
  loop
    source_type_id := source_row.dict_type_id::bigint;
    if not exists (
      select 1 from public.dict_types as dictionary_type
      where dictionary_type.id = source_type_id
    ) and not (source_row.dict_type_id = any(coalesce(p_source_type_ids, array[]::text[]))) then
      raise exception using errcode = '23503', message = 'Legacy dictionary item references an unknown source type ID';
    end if;
    if p_apply and not exists (
      select 1 from public.dict_types as dictionary_type
      where dictionary_type.id = source_type_id
    ) then
      raise exception using errcode = '23503', message = 'Apply dictionary types before importing dictionary items';
    end if;

    source_created_at := app_private.parse_legacy_import_timestamp(source_row.created_at, 'created_at');
    source_updated_at := app_private.parse_legacy_import_timestamp(source_row.updated_at, 'updated_at');
    source_created_by := app_private.resolve_legacy_actor_id(source_row.created_by);
    source_updated_by := app_private.resolve_legacy_actor_id(source_row.updated_by);

    select * into existing_row
    from public.dict_items as target
    where target.id = source_row.id::bigint;
    if found then
      if existing_row.dict_type_id is distinct from source_type_id
        or existing_row.item_value is distinct from source_row.item_value
        or existing_row.item_label is distinct from source_row.item_label
        or existing_row.sort_order is distinct from source_row.sort_order
        or existing_row.status is distinct from source_row.status
        or existing_row.description is distinct from source_row.description
        or existing_row.created_by is distinct from source_created_by
        or existing_row.created_at is distinct from source_created_at
        or existing_row.updated_by is distinct from source_updated_by
        or existing_row.updated_at is distinct from source_updated_at
        or existing_row.deleted_at is distinct from (
          case when source_row.deleted = 1 then source_updated_at else null::timestamptz end
        ) then
        raise exception using errcode = '23505', message = 'Legacy dictionary item ID conflicts with existing content';
      end if;
      if exists (
        select 1 from public.dict_items as target
        where target.id <> source_row.id::bigint
          and target.dict_type_id = source_type_id
          and target.item_value collate app_private.legacy_utf8mb4_unicode_ci
            = source_row.item_value collate app_private.legacy_utf8mb4_unicode_ci
          and (target.deleted_at is not null) = (source_row.deleted = 1)
      ) then
        raise exception using errcode = '23505', message = 'Legacy dictionary item value conflicts under target collation';
      end if;
      already_count := already_count + 1;
      continue;
    end if;

    if exists (
      select 1 from public.dict_items as target
      where target.id <> source_row.id::bigint
        and target.dict_type_id = source_type_id
        and target.item_value collate app_private.legacy_utf8mb4_unicode_ci
          = source_row.item_value collate app_private.legacy_utf8mb4_unicode_ci
        and (target.deleted_at is not null) = (source_row.deleted = 1)
    ) then
      raise exception using errcode = '23505', message = 'Legacy dictionary item value conflicts under target collation';
    end if;

    rows_to_insert := rows_to_insert + 1;
    if p_apply then
      insert into public.dict_items (
        id, dict_type_id, item_value, item_label, sort_order, status, description,
        created_by, created_at, updated_by, updated_at, deleted_at
      ) values (
        source_row.id::bigint, source_type_id, source_row.item_value, source_row.item_label,
        source_row.sort_order, source_row.status, source_row.description, source_created_by,
        source_created_at, source_updated_by, source_updated_at,
        case when source_row.deleted = 1 then source_updated_at else null::timestamptz end
      );
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  if p_apply then
    select max(id) into maximum_id from public.dict_items;
    perform pg_catalog.setval(
      pg_catalog.pg_get_serial_sequence('public.dict_items', 'id'),
      coalesce(maximum_id, 1),
      maximum_id is not null
    );
  end if;
  return jsonb_build_object(
    'sourceCount', source_count,
    'alreadyPresentCount', already_count,
    'rowsToInsert', rows_to_insert,
    'insertedCount', inserted_count
  );
end;
$$;
create function public.import_legacy_system_configs(p_rows jsonb, p_apply boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_count integer;
  already_count integer := 0;
  rows_to_insert integer := 0;
  inserted_count integer := 0;
  source_row record;
  existing_row public.system_configs%rowtype;
  source_created_at timestamptz;
  source_updated_at timestamptz;
  source_created_by bigint;
  source_updated_by bigint;
  maximum_id bigint;
begin
  if p_apply is null then
    raise exception using errcode = '22023', message = 'Apply mode must be explicit';
  end if;
  source_count := app_private.assert_legacy_import_batch(p_rows);
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as source(row)
    where not (source.row ?& array[
      'id', 'config_code', 'config_name', 'config_value', 'value_type', 'status',
      'description', 'created_by', 'created_at', 'updated_by', 'updated_at', 'deleted'
    ])
      or jsonb_typeof(source.row->'id') is distinct from 'string'
      or jsonb_typeof(source.row->'config_code') is distinct from 'string'
      or jsonb_typeof(source.row->'config_name') is distinct from 'string'
      or jsonb_typeof(source.row->'config_value') is distinct from 'string'
      or jsonb_typeof(source.row->'value_type') is distinct from 'string'
      or jsonb_typeof(source.row->'status') is distinct from 'number'
      or jsonb_typeof(source.row->'description') not in ('string', 'null')
      or jsonb_typeof(source.row->'created_by') not in ('string', 'null')
      or jsonb_typeof(source.row->'created_at') is distinct from 'string'
      or jsonb_typeof(source.row->'updated_by') not in ('string', 'null')
      or jsonb_typeof(source.row->'updated_at') is distinct from 'string'
      or jsonb_typeof(source.row->'deleted') is distinct from 'number'
  ) then
    raise exception using errcode = '22023', message = 'Legacy system configuration row fields are invalid';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text, config_code text, config_name text, config_value text, value_type text,
      status smallint, description text, created_by text, created_at text,
      updated_by text, updated_at text, deleted smallint
    )
    where coalesce(source.id, '') !~ '^[1-9][0-9]*$'
      or case when source.id ~ '^[1-9][0-9]*$'
        then source.id::numeric > 9223372036854775807 else false end
      or nullif(trim(source.config_code), '') is null or length(source.config_code) > 64
      or nullif(trim(source.config_name), '') is null or length(source.config_name) > 128
      or source.value_type not in ('STRING', 'NUMBER', 'BOOLEAN', 'JSON')
      or source.status not in (0, 1)
      or coalesce(length(source.description), 0) > 255
      or source.deleted not in (0, 1)
  ) then
    raise exception using errcode = '22023', message = 'Legacy system configuration fields exceed target constraints';
  end if;

  if (select count(distinct source.id)::integer
      from jsonb_to_recordset(p_rows) as source(id text)) <> source_count then
    raise exception using errcode = '22023', message = 'Legacy system configuration batch contains duplicate IDs';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(config_code text)
    group by source.config_code collate app_private.legacy_utf8mb4_unicode_ci
    having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'Legacy system configuration batch contains a collation conflict';
  end if;

  for source_row in
    select * from jsonb_to_recordset(p_rows) as source(
      id text, config_code text, config_name text, config_value text, value_type text,
      status smallint, description text, created_by text, created_at text,
      updated_by text, updated_at text, deleted smallint
    )
  loop
    source_created_at := app_private.parse_legacy_import_timestamp(source_row.created_at, 'created_at');
    source_updated_at := app_private.parse_legacy_import_timestamp(source_row.updated_at, 'updated_at');
    source_created_by := app_private.resolve_legacy_actor_id(source_row.created_by);
    source_updated_by := app_private.resolve_legacy_actor_id(source_row.updated_by);

    select * into existing_row
    from public.system_configs as target
    where target.id = source_row.id::bigint;
    if found then
      if existing_row.config_code is distinct from source_row.config_code
        or existing_row.config_name is distinct from source_row.config_name
        or existing_row.config_value is distinct from source_row.config_value
        or existing_row.value_type is distinct from source_row.value_type
        or existing_row.status is distinct from source_row.status
        or existing_row.description is distinct from source_row.description
        or existing_row.created_by is distinct from source_created_by
        or existing_row.created_at is distinct from source_created_at
        or existing_row.updated_by is distinct from source_updated_by
        or existing_row.updated_at is distinct from source_updated_at
        or existing_row.deleted_at is distinct from (
          case when source_row.deleted = 1 then source_updated_at else null::timestamptz end
        ) then
        raise exception using errcode = '23505', message = 'Legacy system configuration ID conflicts with existing content';
      end if;
      already_count := already_count + 1;
      continue;
    end if;

    if exists (
      select 1 from public.system_configs as target
      where target.config_code collate app_private.legacy_utf8mb4_unicode_ci
        = source_row.config_code collate app_private.legacy_utf8mb4_unicode_ci
    ) then
      raise exception using errcode = '23505', message = 'Legacy system configuration code conflicts under target collation';
    end if;

    rows_to_insert := rows_to_insert + 1;
    if p_apply then
      insert into public.system_configs (
        id, config_code, config_name, config_value, value_type, status,
        description, created_by, created_at, updated_by, updated_at, deleted_at
      ) values (
        source_row.id::bigint, source_row.config_code, source_row.config_name,
        source_row.config_value, source_row.value_type, source_row.status,
        source_row.description, source_created_by, source_created_at, source_updated_by,
        source_updated_at,
        case when source_row.deleted = 1 then source_updated_at else null::timestamptz end
      );
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  if p_apply then
    select max(id) into maximum_id from public.system_configs;
    perform pg_catalog.setval(
      pg_catalog.pg_get_serial_sequence('public.system_configs', 'id'),
      coalesce(maximum_id, 1),
      maximum_id is not null
    );
  end if;
  return jsonb_build_object(
    'sourceCount', source_count,
    'alreadyPresentCount', already_count,
    'rowsToInsert', rows_to_insert,
    'insertedCount', inserted_count
  );
end;
$$;

revoke all on function public.import_legacy_dict_types(jsonb, boolean),
  public.import_legacy_dict_items(jsonb, text[], boolean),
  public.import_legacy_system_configs(jsonb, boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.import_legacy_dict_types(jsonb, boolean),
  public.import_legacy_dict_items(jsonb, text[], boolean),
  public.import_legacy_system_configs(jsonb, boolean)
  to service_role;
